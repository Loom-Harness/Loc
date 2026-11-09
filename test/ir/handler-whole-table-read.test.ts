// `loom.workflow-load-array-unsupported` over handler bodies: a bare
// `Repo.all()` read in a `commandHandler` / `queryHandler` body — bound by a
// `let`, returned, or iterated (the last two hoist into a `let`) — reads the
// whole table, and no repository emits an unbounded load for it: the implicit
// relational `all()` is the paged `all(page, pageSize, sort, dir)`.  Every
// backend rendered the read against a method its repository does not declare
// (node `items.findAll()`, TS2339), so the read is refused and the rows come
// from `Repo.all(<Criterion>(…))`, which runs a retrieval every backend emits.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const CODE = "loom.workflow-load-array-unsupported";

async function hits(body: string) {
  const { model, errors } = await parseString(`
    context Shop {
      aggregate Item with crudish { sku: string  qty: int }
      repository Items for Item { }
      criterion Big(n: int) of Item = this.qty > n
      ${body}
    }
  `);
  expect(errors).toEqual([]);
  return validateLoomModel(enrichLoomModel(lowerModel(model))).filter((d) => d.code === CODE);
}

describe(`${CODE} — a whole-table read in a handler body`, () => {
  it.each([
    [
      "a `let`",
      "queryHandler AllItems(): Item[] { let x = Items.all()  return x }",
      "Shop/AllItems",
    ],
    ["a `return`", "queryHandler AllItems(): Item[] { return Items.all() }", "Shop/AllItems"],
    [
      "a `for` iterable",
      "commandHandler Sweep() { for o in Items.all() { o.update(o.sku, 0) } }",
      "Shop/Sweep",
    ],
  ])("refuses %s", async (_label, handler, where) => {
    const found = await hits(handler);
    expect(found).toHaveLength(1);
    expect(found[0]!.source).toBe(where);
    expect(found[0]!.message).toContain("Items.all(<Criterion>(…))");
  });

  it("refuses it in a workflow body the same way", async () => {
    const found = await hits("workflow W { create(n: int) { let xs = Items.all() } }");
    expect(found).toHaveLength(1);
  });

  it("leaves a criterion read alone", async () => {
    expect(
      await hits("queryHandler BigItems(n: int): Item[] { let x = Items.all(Big(n))  return x }"),
    ).toEqual([]);
  });
});
