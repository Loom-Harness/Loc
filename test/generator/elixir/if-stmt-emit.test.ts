// M-T6.59 — the `if` STATEMENT on the vanilla Phoenix backend.
//
// Elixir is immutable: an aggregate body threads a REBOUND `record`, and a
// binding made inside an `if` block does NOT escape the block.  The naive
// rendering compiles clean under `--warnings-as-errors` and then silently does
// nothing, which is why `loom.elixir-if-stmt-unsupported` used to refuse the
// statement outright.  Two halves make it real, and this file pins BOTH,
// because either alone still drops the write:
//
//   1. the `if` renders value-producing — every arm ends in `record`, the whole
//      expression rebinds it (`vanilla/if-stmt-emit.ts`);
//   2. every "does this body write a column / mutate a containment" probe
//      deep-walks the branches (`opBodyStmtsDeep`), so the persist tail carries
//      the columns a BRANCH assigned.  Without (2) the emitted body reads
//      perfectly and `Repo.update` writes nothing.
//
// Plus the narrow sub-shapes that stay refused, each with its own `#slug`.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../../src/ir/validate/validate.js";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { parseString } from "../../_helpers/parse.js";

async function diagnose(src: string): Promise<{ code?: string; message: string }[]> {
  const { model, errors } = await parseString(src);
  if (errors.length) throw new Error(`unexpected parse errors:\n${errors.join("\n")}`);
  return validateLoomModel(enrichLoomModel(lowerModel(model))).map((d) => ({
    code: d.code,
    message: d.message,
  }));
}

function sys(body: string, extra = ""): string {
  return `
system Grading {
  subdomain Learning {
    context Tracker {
      aggregate Task with crudish {
        title: string
        score: int = 0
        tier: string = "none"
        attempts: int = 0
        contains notes: Note[]
        entity Note { text: string }
${body}
      }
      repository Tasks for Task { }
${extra}
    }
  }
  api TrackerApi from Learning
  storage primary { type: postgres }
  resource trackerState { for: Tracker, kind: state, use: primary }
  deployable api {
    platform: elixir
    contexts: [Tracker]
    dataSources: [trackerState]
    serves: TrackerApi
    port: 4000
  }
}
`;
}

function bySuffix(f: Map<string, string>, suffix: string): string {
  const key = [...f.keys()].find((k) => k.endsWith(suffix));
  if (!key) throw new Error(`no generated file ending in ${suffix}`);
  return f.get(key)!;
}

const GRADE = `
        operation grade(bonus: int) {
          if score + bonus > 10 {
            tier := "gold"
            score := score + bonus
          } else {
            tier := "bronze"
          }
        }`;

describe("phoenix generator — the `if` statement (M-T6.59)", () => {
  it("renders a value-producing `if` that REBINDS the threaded record", async () => {
    const files = await generateSystemFiles(sys(GRADE));
    const ctx = bySuffix(files, "lib/api/tracker.ex");
    expect(ctx).toContain("record = if record.score + bonus > 10 do");
    // Each arm ends in the threaded variable, so the untaken branch is a no-op
    // rebind rather than `nil`.
    expect(ctx).toContain(`record = %{record | tier: "gold"}`);
    expect(ctx).toContain(`record = %{record | tier: "bronze"}`);
    expect(ctx).toMatch(/\n\s+else\n\s+record = %\{record \| tier: "bronze"\}\n\s+record\n\s+end/);
  });

  it("persists the columns a BRANCH assigned — the half a compile gate cannot see", async () => {
    const files = await generateSystemFiles(sys(GRADE));
    const ctx = bySuffix(files, "lib/api/tracker.ex");
    // Before `opBodyStmtsDeep`, `persistPutBodies` scanned `op.statements` one
    // level deep, saw no assign, and emitted `change(%{})` with NO force_change
    // line — the branch computed the new struct and `Repo.update` wrote nothing.
    expect(ctx).toContain("Ecto.Changeset.force_change(:tier, record.tier)");
    expect(ctx).toContain("Ecto.Changeset.force_change(:score, record.score)");
  });

  it("synthesises the `else` arm for an `if` with no else (Elixir's `if` answers nil)", async () => {
    const files = await generateSystemFiles(
      sys(`
        operation bump(delta: int) {
          if delta > 0 {
            attempts := attempts + delta
          }
        }`),
    );
    const ctx = bySuffix(files, "lib/api/tracker.ex");
    expect(ctx).toContain("record = if delta > 0 do");
    // The synthesised arm — without it the false path would null `record`.
    expect(ctx).toMatch(/\n\s+else\n\s+record\n\s+end/);
    expect(ctx).toContain("Ecto.Changeset.force_change(:attempts, record.attempts)");
  });

  it("reaches the containment persist arm from inside a branch", async () => {
    const files = await generateSystemFiles(
      sys(`
        operation collect(text: string) {
          if text.length > 0 {
            notes += Note { text: text }
          }
        }`),
    );
    const ctx = bySuffix(files, "lib/api/tracker.ex");
    expect(ctx).toContain("Ecto.Changeset.put_assoc(:notes, __put_assoc_parts(record.notes))");
  });

  it("renders a TAIL `if` whose branches `return` in a tail-value domainService body", async () => {
    const files = await generateSystemFiles(
      sys(
        "",
        `
      domainService Pricing {
        operation quote(points: int): string {
          if points > 20 {
            return "premium"
          } else {
            return "standard"
          }
        }
      }`,
      ),
    );
    const svc = bySuffix(files, "domain/services/pricing.ex");
    // No thread variable: the `if` expression IS the function's value.
    expect(svc).toContain("    if points > 20 do");
    expect(svc).toContain(`      "premium"`);
    expect(svc).toContain(`      "standard"`);
    expect(svc).not.toContain("record = if");
  });
});

describe("phoenix generator — the `if` sub-shapes that stay refused", () => {
  it("refuses a `return` inside a branch of an OPERATION body (#return-in-branch)", async () => {
    const diags = await diagnose(
      sys(`
        operation promote(bonus: int): Task {
          if bonus > 0 {
            return this
          }
          score := score + bonus
        }`),
    );
    const hit = diags.find((d) => d.code === "loom.elixir-if-stmt-unsupported");
    expect(hit).toBeDefined();
    expect(hit?.message).toContain("EARLY EXIT");
  });

  it("refuses a `precondition` nested in a branch (#guard-in-branch)", async () => {
    const diags = await diagnose(
      sys(`
        operation grade(bonus: int) {
          if bonus > 0 {
            precondition score > 0
            tier := "gold"
          }
        }`),
    );
    const hit = diags.find((d) => d.code === "loom.elixir-if-stmt-unsupported");
    expect(hit).toBeDefined();
    expect(hit?.message).toContain("403 / 422");
  });

  it("refuses an `emit` inside a branch (#branch-statement — the CLOSED vocabulary)", async () => {
    // The sharp case for the closed vocabulary.  The `emit` would RENDER, but
    // `contextEmitsEvent` scans `op.statements` one level deep, so the host
    // module would carry no `require Logger` (a compile error) — and the S5a
    // persist-then-dispatch restructure cannot hoist a CONDITIONAL emit past
    // the commit, so a phantom event would fire on a failed write.
    const diags = await diagnose(`
system Grading {
  subdomain Learning {
    context Tracker {
      event Graded { taskId: string }
      aggregate Task with crudish {
        title: string
        score: int
        operation grade(bonus: int) {
          if score + bonus > 10 {
            score := score + bonus
            emit Graded { taskId: id }
          }
        }
      }
      repository Tasks for Task { }
    }
  }
  api TrackerApi from Learning
  storage primary { type: postgres }
  resource trackerState { for: Tracker, kind: state, use: primary }
  deployable api {
    platform: elixir
    contexts: [Tracker]
    dataSources: [trackerState]
    serves: TrackerApi
    port: 4000
  }
}
`);
    const hit = diags.find((d) => d.code === "loom.elixir-if-stmt-unsupported");
    expect(hit).toBeDefined();
    expect(hit?.message).toContain("CLOSED set");
  });

  it("admits the shapes it renders — no diagnostic for a plain assigning `if`", async () => {
    const diags = await diagnose(sys(GRADE));
    expect(diags.filter((d) => d.code === "loom.elixir-if-stmt-unsupported")).toHaveLength(0);
  });
});
