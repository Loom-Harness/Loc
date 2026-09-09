// `StmtIR.variant-match.subjectType` — audit finding F56.
//
// The field's own doc comment calls it "Resolved `or`-union TypeIR of the
// subject — the variant set", and the four type-grounded `match` gates in
// `variant-match-shape.ts` are written against exactly that promise.  It does
// not hold: `lowerMatchStmt` fills it from `inferExprType`, whose catch-all is
// `{ kind: "primitive", name: "string" }`, so an api-handle operation call —
// the ONLY subject shape Stage 2 `match await` is for — silently types as
// `string`, indistinguishable from a genuine string.
//
// That is why the statement form cannot be gated the way the expression form
// is, and why `match await <plain state field>` reaches the four SPA walkers
// and makes them emit
// `await Promise.reject(new Error("no remote op for variant-match"))`.
//
// This test pins the DEFECT, not the desired behaviour, so it fails loudly the
// day `inferExprType` learns to resolve an api-handle call and the gate becomes
// buildable.  Delete it then, and wire `checkVariantMatchShape` to the three
// `ActionIR` carriers (PageIR / ComponentIR / StoreIR).

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type { StmtIR } from "../../src/ir/types/loom-ir.js";
import { parseString } from "../_helpers/parse.js";

const SOURCE = `
  error Failed { reason: string }
  system Shop {
    api SalesApi from Sales { httpStatus Failed -> 422 }
    subdomain Sales {
      context Ordering {
        aggregate Order {
          code: string
          operation placeOrder(): Order or Failed { return Failed { reason: code } }
        }
        repository Orders for Order { }
      }
    }
    storage primarySql { type: postgres }
    resource orderingState { for: Ordering, kind: state, use: primarySql }
    ui Web {
      api Sales: SalesApi
      page OrderDetail {
        route: "/orders/:id"
        state { message: string = "" }
        action submit() {
          match await Sales.Order.placeOrder() {
            Order o => { message := o.code }
            Failed f => { message := f.reason }
          }
        }
        body: Stack { Button { "Place", onClick: submit } }
      }
    }
    deployable api { platform: node contexts: [Ordering] dataSources: [orderingState] serves: SalesApi port: 3000 }
    deployable web { platform: react targets: api ui: Web { Sales: api } port: 3001 }
  }`;

async function subjectTypeOfFirstAction() {
  const { model } = await parseString(SOURCE, { validate: false });
  const loom = enrichLoomModel(lowerModel(model));
  const page = loom.systems[0]!.uis[0]!.pages[0]!;
  const stmt = page.actions[0]!.body[0] as Extract<StmtIR, { kind: "variant-match" }>;
  expect(stmt.kind).toBe("variant-match");
  return stmt.subjectType;
}

describe("variant-match subjectType (F56)", () => {
  it("is NOT the resolved union for an api-handle op — it is the inferExprType string fallback", async () => {
    const t = await subjectTypeOfFirstAction();
    // What the field's doc comment promises, and what the gates need:
    //   { kind: "union", variants: [Order, Failed] }
    // What lowering actually produces:
    expect(t).toEqual({ kind: "primitive", name: "string" });
  });

  it("so a union-returning subject is indistinguishable from a plain string one", async () => {
    // The exact reason `checkVariantMatchShape` cannot be wired to the
    // statement form yet: this subject and a `state { message: string }` one
    // carry byte-identical `subjectType`, so any type-grounded gate would
    // either miss both or reject both.
    const t = await subjectTypeOfFirstAction();
    expect(t?.kind).not.toBe("union");
  });
});
