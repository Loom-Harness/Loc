// `StmtIR.variant-match.subjectType` — audit finding F56, closed by M-T5.43 V14.
//
// The field's own doc comment calls it "Resolved `or`-union TypeIR of the
// subject — the variant set", and the four type-grounded `match` gates in
// `variant-match-shape.ts` are written against exactly that promise.  It used
// not to hold: `lowerMatchStmt` filled it from `inferExprType`, whose catch-all
// is `{ kind: "primitive", name: "string" }`, so an awaited api-handle operation
// call — the ONLY subject shape Stage 2 `match await` is for — typed as
// `string`, and none of the gates could run on the statement form.
//
// `awaitedOpReturnType` (lower-stmt.ts) now types the subject from the awaited
// aggregate operation's declared return, and `validateVariantMatch` runs the
// unknown / duplicate / non-exhaustive gates over every page / component /
// store action's `variant-match` statement.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type { StmtIR } from "../../src/ir/types/loom-ir.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const CANONICAL_ARMS = `
            Order o => { message := o.code }
            Failed f => { message := f.reason }`;

const source = (arms: string) => `
  error Failed { reason: string }
  error Unrelated { why: string }
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
          match await Sales.Order.placeOrder() {${arms}
          }
        }
        body: Stack { Button { "Place", onClick: submit } }
      }
    }
    deployable api { platform: node contexts: [Ordering] dataSources: [orderingState] serves: SalesApi port: 3000 }
    deployable web { platform: react targets: api ui: Web { Sales: api } port: 3001 }
  }`;

async function lowered(arms: string) {
  const { model } = await parseString(source(arms), { validate: false });
  return enrichLoomModel(lowerModel(model));
}

async function matchDiags(arms: string) {
  return validateLoomModel(await lowered(arms))
    .filter((d) => d.code?.startsWith("loom.match-"))
    .map((d) => ({ code: d.code, severity: d.severity }));
}

describe("variant-match subjectType (F56, M-T5.43 V14)", () => {
  it("is the awaited operation's resolved union, not the inferExprType string fallback", async () => {
    const loom = await lowered(CANONICAL_ARMS);
    const page = loom.systems[0]!.uis[0]!.pages[0]!;
    const stmt = page.actions[0]!.body[0] as Extract<StmtIR, { kind: "variant-match" }>;
    expect(stmt.kind).toBe("variant-match");
    expect(stmt.subjectType).toEqual({
      kind: "union",
      variants: [
        { kind: "entity", name: "Order" },
        { kind: "entity", name: "Failed" },
      ],
    });
  });

  it("raises no match diagnostic on the canonical exhaustive statement", async () => {
    expect(await matchDiags(CANONICAL_ARMS)).toEqual([]);
  });

  it("rejects an arm naming a type outside the union (loom.match-unknown-variant)", async () => {
    expect(await matchDiags(`${CANONICAL_ARMS}\n            Unrelated u => { message := u.why }`)).toEqual(
      [{ code: "loom.match-unknown-variant", severity: "error" }],
    );
  });

  it("rejects a variant matched twice (loom.match-duplicate-variant)", async () => {
    expect(await matchDiags(`${CANONICAL_ARMS}\n            Order p => { message := p.code }`)).toEqual([
      { code: "loom.match-duplicate-variant", severity: "error" },
    ]);
  });

  it("warns on an uncovered variant with no else, and stands down with one", async () => {
    expect(await matchDiags(`\n            Order o => { message := o.code }`)).toEqual([
      { code: "loom.match-non-exhaustive", severity: "warning" },
    ]);
    expect(
      await matchDiags(`\n            Order o => { message := o.code }\n            else => { message := "x" }`),
    ).toEqual([]);
  });
});
