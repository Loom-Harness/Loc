// ---------------------------------------------------------------------------
// `loom.async-effect-subject-unsupported` — the TARGET-AGNOSTIC `match await`
// subject gate (audit F66, wave C2 packet 2i).
//
// `match await <subject> { … }` lowers to a `variant-match` statement, and every
// frontend renderer resolves the subject the same way: an aggregate INSTANCE
// operation, optionally api-qualified.  None of them renders anything else — and
// before this gate each failed differently, none of them honestly:
//
//   react / vue / svelte / angular  `await Promise.reject(new Error("no remote
//     op for variant-match"))` — a guaranteed unhandled rejection on every
//     invocation, from a `.ddd` reporting `0 error(s), 0 warning(s)`.
//   phoenixLiveView                 `renderVariantMatchStmt` THROWS at codegen.
//   feliz / flutter                 refused honestly — but behind a
//     `dep.platform !== "feliz"` check, which is exactly what made the same
//     model legal on React and illegal on Feliz.
//
// The classifier was already target-neutral (`ir/util/feliz-async-effect.ts`);
// this is the promotion, not a new analysis.  The statement form cannot instead
// reuse `loom.match-non-union-subject`: a `StmtIR.variant-match`'s `subjectType`
// comes from `inferExprType`, whose catch-all is `string`, so an awaited
// api-handle call is indistinguishable from a genuine string there — the defect
// `variant-match-subject-type.test.ts` pins.  This gate is SHAPE-based.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const CODE = "loom.async-effect-subject-unsupported";
const FELIZ_CODE = "loom.feliz-async-effect-unsupported";

const SYS = (platform: string, port: number, actionBody: string, host = "page") => `
system Shop {
  subdomain Sales {
    context Ordering {
      aggregate Order {
        code: string
        operation place() { code := "x" }
      }
      repository Orders for Order { }
    }
  }
  api SalesApi from Sales
  storage primarySql { type: postgres }
  resource orderingState { for: Ordering, kind: state, use: primarySql }
  ui Web {
    api Sales: SalesApi
${
  host === "page"
    ? `    page OrderDetail {
      route: "/orders/:id"
      state { message: string = "" }
      action submit() {
${actionBody}
      }
      body: Stack { Button { "Place", onClick: submit } }
    }`
    : `    component Panel() {
      state { message: string = "" }
      action submit() {
${actionBody}
      }
      body: Stack { Button { "Place", onClick: submit } }
    }
    page OrderDetail {
      route: "/orders/:id"
      body: Stack { Panel { } }
    }`
}
  }
  deployable api { platform: node contexts: [Ordering] dataSources: [orderingState] serves: SalesApi port: 3000 }
  deployable web { platform: ${platform} targets: api ui: Web { Sales: api } port: ${port} }
}`;

async function codes(source: string): Promise<string[]> {
  const { model, errors } = await parseString(source);
  if (errors.length) throw new Error(`unexpected parse errors:\n${errors.join("\n")}`);
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .map((d) => d.code)
    .filter((c): c is string => c !== undefined);
}

const GOOD = `        match await Sales.Order.place() {
          Order o => { message := o.code }
        }`;
const PLAIN_FIELD = `        match await message {
          Order o => { message := o.code }
        }`;

// Every frontend platform that can host a ui, by its deployable spelling.  The
// point of the row is that the answer is the SAME on all of them.
const FRONTENDS = [
  ["static", 3001], // react / vue / svelte / angular all ride the static host
  ["feliz", 3005],
  ["flutter", 3006],
] as const satisfies readonly (readonly [string, number])[];

describe("loom.async-effect-subject-unsupported — one answer on every frontend", () => {
  for (const [platform, port] of FRONTENDS) {
    it(`REFUSES a non-instance-op subject on \`platform: ${platform}\``, async () => {
      const cs = await codes(SYS(platform, port, PLAIN_FIELD));
      expect(cs, platform).toContain(CODE);
    });

    it(`ACCEPTS the supported shape on \`platform: ${platform}\``, async () => {
      const cs = await codes(SYS(platform, port, GOOD));
      expect(cs, platform).not.toContain(CODE);
    });
  }

  it("the react/static arm is the F66 REGRESSION: it used to validate clean", async () => {
    // The exact model the audit ran.  Before the promotion this was
    // `0 error(s), 0 warning(s)` and `order_detail.tsx` carried
    // `await Promise.reject(new Error("no remote op for variant-match"))`.
    const cs = await codes(SYS("static", 3001, PLAIN_FIELD));
    expect(cs.filter((c) => c === CODE)).toHaveLength(1);
  });
});

describe("the Feliz row keeps only its own, genuinely Feliz-specific case", () => {
  it("a COMPONENT-hosted effect with a GOOD subject still raises the Feliz code", async () => {
    const cs = await codes(SYS("feliz", 3005, GOOD, "component"));
    expect(cs).toContain(FELIZ_CODE);
    expect(cs).not.toContain(CODE);
  });

  it("a component-hosted effect with a BAD subject raises the neutral code ONLY", async () => {
    // One statement, one blocker named — the subject is the target-agnostic
    // problem, and reporting the component-host limit too would send the author
    // to fix the wrong thing first.
    const cs = await codes(SYS("feliz", 3005, PLAIN_FIELD, "component"));
    expect(cs).toContain(CODE);
    expect(cs).not.toContain(FELIZ_CODE);
  });

  it("a PAGE-hosted effect with a bad subject no longer raises the Feliz code", async () => {
    const cs = await codes(SYS("feliz", 3005, PLAIN_FIELD));
    expect(cs).toContain(CODE);
    expect(cs).not.toContain(FELIZ_CODE);
  });
});
