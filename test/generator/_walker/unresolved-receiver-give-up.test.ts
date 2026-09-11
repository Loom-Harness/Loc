// `walker-core.ts`'s unresolved-method-call-receiver arm — §18's
// `TODO: method-call … needs hooks {} binding` sentinel.
//
// The arm is a BACKSTOP, not a gap: `loom.method-call-unresolved-receiver`
// (`ui-action-body-checks.ts` F2) rejects an unresolved receiver at phase ⑦,
// so no `.ddd` a user can generate reaches it.  What it carried instead of that
// fact was a bare `TODO` naming a `hooks {}` binding the language does not have
// — a reader of the generated page got a placeholder with nothing to look up.
//
// Two things are asserted, and the pairing is the point:
//
//   1. every BODY POSITION that can hold a method call is refused by the gate
//      BEFORE codegen (so the arm really is unreachable — a claim made in the
//      emitter's comment, checked here rather than trusted), and
//   2. driving the arm directly still produces a coded give-up, not a bare
//      `TODO` — because the api toolkit and the playground can both hand a
//      generator an unvalidated model, which is the only way to arrive.

import { describe, expect, it } from "vitest";
import { GIVE_UP_RE, GIVE_UP_SENTINEL } from "../../../src/generator/_walker/give-up.js";
import { enrichLoomModel } from "../../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../../src/ir/validate/validate.js";
import { generateSystemFilesUnchecked } from "../../_helpers/generate.js";
import { parseString } from "../../_helpers/parse.js";

const CODE = "loom.method-call-unresolved-receiver";

const sys = (uiBody: string) => `
system Probe {
  api A from D
  subdomain D { context C {
    aggregate Order with crudish { code: string }
  } }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  ui App {
    api Shop: A
${uiBody}
  }
  deployable api { platform: node, contexts: [C], dataSources: [st], serves: A, port: 8080 }
  deployable web { platform: react, targets: api, ui: App { Shop: api }, port: 3001 }
}`;

async function errorCodes(source: string): Promise<string[]> {
  const { model, doc } = await parseString(source, { validate: false });
  expect(
    (doc.parseResult.parserErrors ?? []).map((e) => e.message),
    "fixture parses",
  ).toEqual([]);
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.severity === "error")
    .map((d) => d.code ?? "<uncoded>");
}

// Each row is a DIFFERENT body position a method call can sit in.  `ghost` is
// bound nowhere — not a param, not state, not a lambda binding, not an api
// handle — which is exactly the receiver the walker arm keys on.
const POSITIONS: { where: string; ui: string }[] = [
  {
    where: "a page body text slot",
    ui: `    page Home { route: "/" body: Stack { Text { ghost.compute(1) } } }`,
  },
  {
    where: "a page action body",
    ui: `    page Home {
      route: "/"
      state { n: int = 0 }
      action bump() { n := ghost.compute(1) }
      body: Button { "go", onClick: bump }
    }`,
  },
  {
    where: "a `derived` binding",
    ui: `    page Home {
      route: "/"
      derived v: int = ghost.compute(1)
      body: Stack { Text { v } }
    }`,
  },
  {
    where: "a component body",
    ui: `    component Panel() { body: Stack { Text { ghost.compute(1) } } }
    page Home { route: "/" body: Stack { Panel() } }`,
  },
  {
    where: "a render-lambda body",
    ui: `    page Home {
      route: "/"
      body: QueryView { of: Shop.Order.all, then: rows => Text { ghost.compute(1) } }
    }`,
  },
];

describe("the walker's unresolved-receiver arm is unreachable through the validator", () => {
  for (const { where, ui } of POSITIONS) {
    it(`${where}: the phase-⑦ gate refuses it first`, async () => {
      const found = await errorCodes(sys(ui));
      expect(
        found,
        `an unresolved method-call receiver in ${where} reached codegen — the walker arm's ` +
          "claim that F2 precedes it is no longer true; either widen the gate or stop " +
          "calling the arm dead",
      ).toContain(CODE);
    });
  }

  it("admits the same position with a RESOLVED receiver (the control)", async () => {
    const found = await errorCodes(
      sys(`    page Home { route: "/" body: Stack { Text { Shop.Order.all } } }`),
    );
    expect(found).not.toContain(CODE);
  });
});

describe("driving the arm directly still yields a CODED give-up", () => {
  it("emits the sentinel plus loom.method-call-unresolved-receiver, not a bare TODO", async () => {
    const files = await generateSystemFilesUnchecked(
      sys(`    page Home { route: "/" body: Stack { Text { ghost.compute(1) } } }`),
      "the walker's unresolved-receiver BACKSTOP is the subject — it is only reachable " +
        "on a model the IR validator has already rejected",
    );
    const page = [...files.entries()].find(([k]) => k.endsWith("pages/home.tsx"));
    expect(page, "no Home page emitted").toBeDefined();
    const src = page![1];
    expect(src).toContain(GIVE_UP_SENTINEL);
    const m = GIVE_UP_RE.exec(src);
    expect(m?.[1], "the give-up names its code").toBe(CODE);
    expect(m?.[2]).toContain("ghost.compute");
    // The thing this replaced: a placeholder pointing at a `hooks {}` binding
    // that does not exist in the language.
    expect(src).not.toContain("needs hooks {} binding");
  }, 60_000);
});
