// Emitter hygiene for the flags the generated Phoenix project's own CI runs.
//
// README §Status says the opt-in suites "build and boot the generated stacks
// against real toolchains (… `mix compile --warnings-as-errors`)", and
// `elixir-vanilla-build.yml` / `corpus-elixir-build.yml` genuinely do.  Two
// shapes reached no fixture in either, so both shipped:
//
//   1. `__dt` / `__s` / `__d` / `__other` — leading-underscore bindings in the
//      `datetime` op-param coercion that are then READ.  Elixir warns on
//      exactly that ("the underscored variable \"__dt\" is used after being
//      set"); six of them fail the build.
//   2. `requires true` → `if not (true) do` — a 1.18 typing violation.
//      Covered by phoenix-find-gate.test.ts; `requires true` appears in 0 of
//      68 corpus fixtures, which is why the strict compile never saw it.
//
// These assertions are SWEEPS over the emitted tree, not line pins, so the
// next instance of either shape fails here rather than in a docker leg.
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// Exercises the datetime op-param coercion (`operation reschedule(when_:
// datetime)`), an `at: datetime` field, and a `requires true` find — the three
// shapes above, in one model.
const SOURCE = `
system Acme {
  user { id: string  role: string }
  subdomain Sales {
    context Tickets {
      aggregate Ticket with crudish {
        subject: string
        at: datetime
        open: bool
        derived display: string = subject
        operation reschedule(when_: datetime) { at := when_ }
      }
      repository Tickets for Ticket {
        find openOnes(): Ticket[] requires true where open == true
      }
    }
  }
  api SalesApi from Sales
  storage primary { type: postgres }
  resource salesState { for: Tickets, kind: state, use: primary }
  deployable api {
    platform: elixir
    contexts: [Tickets]
    dataSources: [salesState]
    serves: SalesApi
    port: 4000
    auth: required
  }
}
`;

/** `_name` / `__name` bindings that are READ somewhere in the same file.
 *  Elixir's convention is that a leading underscore means "deliberately
 *  unused"; using one anyway is a warning, and a warning is a build failure
 *  under `--warnings-as-errors`. */
function underscoredButRead(text: string): string[] {
  const bound = new Set<string>();
  // `<- pattern`, `x = expr`, `%Struct{} = x`, and `case` clause heads (`-> `).
  for (const m of text.matchAll(/(?:^|[\s({[,|])(_{1,2}[a-z][A-Za-z0-9_]*)\s*(?:=|->)/g)) {
    bound.add(m[1]!);
  }
  // `when` guards bind too: `__s when is_binary(__s) ->`
  for (const m of text.matchAll(/(_{1,2}[a-z][A-Za-z0-9_]*)\s+when\s/g)) bound.add(m[1]!);
  const read: string[] = [];
  for (const name of bound) {
    // A read is an occurrence NOT immediately followed by `=`/`->`/`when`, and
    // not part of a longer identifier.
    const re = new RegExp(
      String.raw`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])(?!\s*(?:=[^=]|->|\s+when\s))`,
      "g",
    );
    const uses = [...text.matchAll(re)];
    if (uses.length > 0) read.push(name);
  }
  return read;
}

describe("elixir vanilla — compiles under --warnings-as-errors", () => {
  it("binds no underscored variable that it then reads", async () => {
    const files = await generateSystemFiles(SOURCE);
    const offenders: string[] = [];
    for (const [path, text] of files) {
      if (!path.endsWith(".ex") && !path.endsWith(".exs")) continue;
      for (const name of underscoredButRead(text)) offenders.push(`${path}: ${name}`);
    }
    expect(offenders, `underscored-but-read bindings:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("emits the datetime coercion with plain (non-underscored) clause bindings", async () => {
    const files = await generateSystemFiles(SOURCE);
    const ctx = [...files].find(([p]) => p.endsWith("lib/api/tickets.ex"))?.[1];
    expect(ctx, "context module not emitted").toBeDefined();
    expect(ctx!).toContain("DateTime.from_iso8601");
    expect(ctx!).toMatch(/%DateTime\{\} = dt -> dt/);
    expect(ctx!).not.toContain("__dt");
    expect(ctx!).not.toContain("__other");
  });

  it("emits no dead `if not (true)` guard anywhere", async () => {
    const files = await generateSystemFiles(SOURCE);
    const hits = [...files]
      .filter(([p]) => p.endsWith(".ex"))
      .filter(([, t]) => t.includes("if not (true)"))
      .map(([p]) => p);
    expect(hits, `dead always-false guards in:\n${hits.join("\n")}`).toEqual([]);
  });

  it("the sweeps actually reach the emitted Elixir (non-vacuity)", async () => {
    const files = await generateSystemFiles(SOURCE);
    const ex = [...files.keys()].filter((p) => p.endsWith(".ex"));
    expect(ex.length).toBeGreaterThan(10);
    // The model really does carry the two shapes under test, so an empty
    // offender list means "clean", not "nothing generated".
    const all = [...files.values()].join("\n");
    expect(all).toContain("DateTime.from_iso8601");
    expect(all).toContain("open_ones_ticket");
    // …and the detector finds a planted offender.
    expect(underscoredButRead("x = case v do\n  __s when is_binary(__s) -> __s\nend")).toContain(
      "__s",
    );
  });
});
