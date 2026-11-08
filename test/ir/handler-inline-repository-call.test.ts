// IR-validator coverage for `loom.workflow-inline-repository-call` — a
// repository read a workflow / handler body evaluates only on some paths, so
// lowering cannot hoist it into a `let` ahead of its statement
// (`src/ir/lower/hoist-reads.ts`, `src/ir/validate/checks/workflow-checks.ts`).
// The emitted-output half of the hoist is
// `test/generator/handler-expr-repo-read.test.ts`.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const CODE = "loom.workflow-inline-repository-call";

async function hits(handlers: string) {
  const { model, errors } = await parseString(`
    context Shop {
      aggregate Item { sku: string  qty: int  unique (sku) }
      repository Items for Item { }
      criterion Big(n: int) of Item = this.qty > n
      ${handlers}
    }
  `);
  expect(errors).toEqual([]);
  return validateLoomModel(enrichLoomModel(lowerModel(model))).filter((d) => d.code === CODE);
}

describe(CODE, () => {
  it.each([
    [
      "a `&&` right operand",
      "queryHandler Q(n: int): bool { return n > 0 && Items.all(Big(n)).count > 0 }",
    ],
    [
      "a `||` right operand",
      "queryHandler Q(n: int): bool { return n > 0 || Items.all(Big(n)).count > 0 }",
    ],
    ["a `?:` branch", "queryHandler Q(n: int): int { return n > 0 ? Items.all(Big(n)).count : 0 }"],
    [
      "a lambda body",
      "queryHandler Q(skus: string[]): bool { return skus.any(s => Items.getBy(sku: s).qty > 0) }",
    ],
    [
      "a `let` value's `?:` branch",
      "queryHandler Q(n: int): int { let c = n > 0 ? Items.all(Big(n)).count : 0  return c }",
    ],
  ])("fires on a read in %s", async (_label, handler) => {
    const found = await hits(handler);
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("repository 'Items'");
  });

  it.each([
    ["a `return`", "queryHandler Q(n: int): int { return Items.all(Big(n)).count }"],
    [
      "a `?:` condition",
      "queryHandler Q(n: int): int { return Items.all(Big(n)).count > 0 ? 1 : 0 }",
    ],
    [
      "a `&&` left operand",
      "queryHandler Q(n: int): bool { return Items.all(Big(n)).count > 0 && n > 0 }",
    ],
    [
      "a nested read argument",
      "queryHandler Q(s: string): string { return Items.get(Items.getBy(sku: s).id).sku }",
    ],
    ["a `let` source", "queryHandler Q(s: string): Item { let i = Items.getBy(sku: s)  return i }"],
  ])("stays silent on a read in %s (hoisted)", async (_label, handler) => {
    expect(await hits(handler)).toEqual([]);
  });
});
