// A MikroORM repository method whose predicate the FilterQuery subset cannot
// spell fails generation as `loom.query-emission-invalid` (mode
// `mikroorm-filter`), the way Dapper's `whereToSql` does.  It used to catch the
// lowering's throw and emit a method that compiles and throws
// `"mikroorm v1: this retrieval's predicate is not yet supported"` on its
// first call — a validated model answering a 500.  Every predicate the IR
// validator admits renders (test/system/predicate-position-census.test.ts
// measures that); this pins what happens when one does not.

import { beforeAll, describe, expect, it } from "vitest";
import { QueryEmissionRefusal } from "../../../src/generator/_expr/target.js";
import { mikroFilterOrRefuse } from "../../../src/generator/typescript/emit/mikroorm-filter.js";
import { mikroRetrievalMethod } from "../../../src/generator/typescript/emit/mikroorm-relational.js";
import { enrichLoomModel } from "../../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../../src/ir/lower/lower.js";
import type { EnrichedAggregateIR, ExprIR, RetrievalIR } from "../../../src/ir/types/loom-ir.js";
import { BOOL_T, INT_T, paramRef, thisPropRef } from "../../_helpers/ir-builders.js";
import { parseString } from "../../_helpers/parse.js";

/** `this.qty > <right>`. */
const gt = (right: ExprIR): ExprIR => ({
  kind: "binary",
  op: ">",
  left: thisPropRef("qty", INT_T),
  right,
  resultType: BOOL_T,
});
/** `this.qty > n` — inside the subset. */
const inSubset = gt(paramRef("n", INT_T));
/** `this.qty > [n]` — a list value has no FilterQuery spelling. */
const outOfSubset = gt({ kind: "list", elements: [paramRef("n", INT_T)] });

const retrieval = (where: ExprIR): RetrievalIR => ({
  name: "findAllByBig",
  params: [{ name: "n", type: INT_T }],
  targetType: { kind: "entity", name: "Item" },
  where,
  sort: [],
  loadPlan: { kind: "whole" },
});
const tail = () => ["    return [];"];

let agg: EnrichedAggregateIR;
beforeAll(async () => {
  const { model, errors } = await parseString(`
    context Shop {
      aggregate Item with crudish { sku: string  qty: int }
      repository Items for Item { }
    }
  `);
  expect(errors).toEqual([]);
  const item = enrichLoomModel(lowerModel(model))
    .contexts.flatMap((c) => c.aggregates)
    .find((a) => a.name === "Item");
  if (!item) throw new Error("no Item aggregate");
  agg = item;
});

describe("mikroorm: an out-of-subset predicate is refused, never stubbed", () => {
  it("renders an in-subset retrieval as a real query", () => {
    const m = mikroRetrievalMethod(agg, retrieval(inSubset), "ItemRow", tail);
    expect(m).toContain("{ qty: { $gt: n } }");
    expect(m).not.toContain("not yet supported");
  });

  it("refuses an out-of-subset retrieval as loom.query-emission-invalid", () => {
    let thrown: unknown;
    try {
      mikroRetrievalMethod(agg, retrieval(outOfSubset), "ItemRow", tail);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(QueryEmissionRefusal);
    expect((thrown as QueryEmissionRefusal).code).toBe("loom.query-emission-invalid");
    expect((thrown as QueryEmissionRefusal).mode).toBe("mikroorm-filter");
  });

  it("names the lowering's reason in the refusal", () => {
    expect(() => mikroFilterOrRefuse(outOfSubset, "currentUser", [])).toThrow(
      /mikroorm-filter: predicate \(mikroorm: unsupported value 'list' in find\)/,
    );
  });
});
