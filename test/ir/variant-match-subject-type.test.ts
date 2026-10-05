// `StmtIR.variant-match.subjectType` — audit finding F56, CLOSED by the single
// typing pass (M-T5.44 cutover 3b).
//
// The field's own doc comment calls it "Resolved `or`-union TypeIR of the
// subject — the variant set", and the four type-grounded `match` gates in
// `variant-match-shape.ts` are written against exactly that promise.  It did
// not hold: `lowerMatchStmt` filled it from `inferExprType`, whose catch-all
// was `{ kind: "primitive", name: "string" }`, so an api-handle operation call
// — the ONLY subject shape Stage 2 `match await` is for — silently typed as
// `string`, indistinguishable from a genuine string.
//
// The pass types an operation invoked through the api handle as its declared
// return type, and lowering copies it, so the subject now carries the union.
// What this unblocks — wiring `checkVariantMatchShape` to the three `ActionIR`
// carriers (PageIR / ComponentIR / StoreIR) — is a follow-up, not this file.

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
  it("is the resolved `or`-union for an awaited api-handle operation", async () => {
    expect(await subjectTypeOfFirstAction()).toEqual({
      kind: "union",
      variants: [
        { kind: "entity", name: "Order" },
        { kind: "entity", name: "Failed" },
      ],
    });
  });
});
