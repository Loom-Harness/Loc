// `this.<prop>` and the bare `<prop>` are one source meaning; in domain-logic
// bodies (derived / invariant / function / operation) both lower to the same
// `this-prop` / `this-derived` ref.  Query positions (`find` where, criterion)
// keep `member(this, …)` — their consumers root a column path at it.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type { ExprIR } from "../../src/ir/types/loom-ir.js";
import { parseString } from "../_helpers/parse.js";

const SOURCE = `
  system S {
    subdomain D {
      context C {
        aggregate Order {
          total: int
          derived dotted: int = this.total + 1
          derived bare: int = total + 1
          derived chained: int = this.dotted * 2
          invariant this.total >= 0
          operation bump(by: int = this.total) { total := this.total + by }
        }
        criterion Big of Order = this.total > 10
        repository Orders for Order {
          find byTotal(t: int): Order[] where this.total == t
        }
      }
    }
  }
`;

async function lowered() {
  const { model } = await parseString(SOURCE, { validate: false });
  const loom = enrichLoomModel(lowerModel(model));
  const ctx = loom.systems[0]!.subdomains[0]!.contexts[0]!;
  return { ctx, agg: ctx.aggregates[0]! };
}

describe("this.<prop> normalisation", () => {
  it("derived: dotted and bare spellings are the same ref", async () => {
    const { agg } = await lowered();
    const get = (n: string) => agg.derived.find((d) => d.name === n)!.expr;
    const lhs = (e: ExprIR) => (e.kind === "binary" ? e.left : e);
    const dotted = lhs(get("dotted"));
    expect(dotted).toMatchObject({ kind: "ref", refKind: "this-prop", name: "total" });
    const { origin: _a, ...d1 } = dotted as ExprIR & { origin?: unknown };
    const { origin: _b, ...d2 } = lhs(get("bare")) as ExprIR & { origin?: unknown };
    expect(d1).toEqual(d2);
    expect(lhs(get("chained"))).toMatchObject({
      kind: "ref",
      refKind: "this-derived",
      name: "dotted",
    });
  });

  it("invariant and operation body read the ref; a param default keeps member(this)", async () => {
    const { agg } = await lowered();
    const inv = agg.invariants[0]!.expr;
    expect(inv.kind === "binary" && inv.left).toMatchObject({ kind: "ref", refKind: "this-prop" });
    const op = agg.operations.find((o) => o.name === "bump")!;
    expect(op.params[0]!.default).toMatchObject({ kind: "member", receiver: { kind: "this" } });
    const stmt = op.statements[0]!;
    expect(JSON.stringify(stmt)).not.toContain('"receiver":{"kind":"this"}');
  });

  it("query positions keep member(this, …)", async () => {
    const { ctx } = await lowered();
    const crit = ctx.criteria[0]!.body;
    expect(crit.kind === "binary" && crit.left).toMatchObject({
      kind: "member",
      receiver: { kind: "this" },
    });
  });
});
