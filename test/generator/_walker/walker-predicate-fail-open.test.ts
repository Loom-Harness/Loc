// ---------------------------------------------------------------------------
// The walker's dispatch predicates must not decline a DECLARED element.
//
// Two findings, one shape (F10 and F12 of the 2026-09-03 language-docs audit):
// a predicate answers "no" on a construct it does not recognise and emission
// continues as if nothing had been declared — no output, and no diagnostic to
// say so.  Both are proven here by a CONTROL that renders the same construct,
// so a regression cannot be read as "that shape is simply unsupported".
//
//   F10  `body: match { … }` — the documented wizard pattern
//        (page-metamodel §7/§12).  `isWalkableLayoutBody` admitted only
//        `call` and `ternary`, so REACT and SVELTE — the only two emitters
//        that gate on it — dropped the page entirely: no file, no route, no
//        diagnostic.  VUE renders it, because it walks unconditionally and
//        never consults the predicate.  Vue is therefore the control: it
//        proves the walker's `match` arms were always complete and only the
//        predicate was wrong.
//
//   F12  `KeyValueRow { "Note", x.toUpper() }` — element-position `walk` had
//        no `method-call` arm, so the value slot degraded to
//        `/* unsupported expr: method-call */` while the visually identical
//        `Text { x.toUpper() }` on the SAME PAGE rendered `.toUpperCase()`.
//        The `Text` twin is the control: same expression, same page, so a
//        regression shows up as the two disagreeing.
//
// Neither finding is visible to the `loom:unrendered` sentinel #2774 added:
// both decline UPSTREAM of any `giveUp()` call, which is exactly why a
// sentinel-based matrix could not catch them.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const HOST: Record<string, string> = { react: "static", vue: "static", svelte: "static" };

const sys = (framework: string) => `
system WalkerPredicates {
  subdomain S {
    context Ops {
      aggregate Job { name: string }
      repository Jobs for Job { }
    }
  }
  ui App {
    framework: ${framework}
    page Wizard {
      route: "/wizard"
      state { step: int = 0 }
      body: match {
        step == 0 => Heading { "Step one", level: 2 }
        else      => Heading { "Step two", level: 2 }
      }
    }
    page Kv {
      route: "/kv"
      body: Stack {
        KeyValueRow { "Note", "abc".toUpper() },
        Text { "abc".toUpper() }
      }
    }
  }
  api OpsApi from S
  storage primary { type: postgres }
  resource st { for: Ops, kind: state, use: primary }
  deployable api { platform: node contexts: [Ops] dataSources: [st] serves: OpsApi port: 4400 }
  deployable app { platform: ${HOST[framework]} targets: api ui: App port: 3007 }
}`;

/** Every emitted path, so "was a file produced at all" is answerable. */
async function pathsFor(framework: string): Promise<string[]> {
  return [...(await generateSystemFiles(sys(framework))).keys()];
}

async function sourceMatching(framework: string, re: RegExp): Promise<string> {
  const files = await generateSystemFiles(sys(framework));
  let out = "";
  for (const [p, c] of files) if (re.test(p)) out += `\n${c}`;
  return out;
}

describe("F10 — a bare `match` page body is walkable", () => {
  // react and svelte are the two emitters that gate on isWalkableLayoutBody.
  for (const framework of ["react", "svelte"]) {
    it(`${framework}: emits the page rather than dropping it silently`, async () => {
      const paths = await pathsFor(framework);
      expect(
        paths.filter((p) => /wizard/i.test(p)),
        "the bare-`match` page produced NO file — the predicate declined it and " +
          "emission continued with no diagnostic (F10)",
      ).not.toEqual([]);
    });
  }

  it("react: both arms render, with the state hook the body reads", async () => {
    const src = await sourceMatching("react", /wizard\.tsx$/);
    expect(src).toContain("useState<number>(0)");
    expect(src).toContain("Step one");
    expect(src).toContain("Step two");
  });

  // The control: vue never consulted the predicate, so it rendered this all
  // along.  If vue ever STOPS emitting it, the defect is in the walker's
  // `match` arms and not in the predicate — a different bug from F10.
  it("vue (control): renders it, as it always did", async () => {
    const paths = await pathsFor("vue");
    expect(paths.filter((p) => /wizard/i.test(p))).not.toEqual([]);
  });
});

describe("F12 — a method call in a `KeyValueRow` value slot renders", () => {
  for (const framework of ["react", "svelte", "vue"]) {
    it(`${framework}: the value slot and its \`Text\` twin agree`, async () => {
      const src = await sourceMatching(framework, /kv\.(tsx|vue)$|kv\/\+page\.svelte$/);
      expect(src, "no Kv page was emitted").not.toBe("");
      // The defect: the row degraded while the twin rendered.
      expect(
        src,
        "the KeyValueRow value slot degraded to a placeholder while the " +
          "identical `Text` expression on the same page rendered (F12)",
      ).not.toContain("unsupported expr: method-call");
      // Two occurrences — one per primitive — of the SAME rendered call.
      expect(src.match(/"abc"\.toUpperCase\(\)/g) ?? []).toHaveLength(2);
    });
  }
});
