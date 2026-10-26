// Structural validation for `migration { rename ... }` blocks (M-T2.1,
// src/language/validators/migration.ts).  The checks are deliberately
// snapshot-INDEPENDENT (a ledger block legitimately references names that have
// since moved on), so they only reject the unambiguously-broken shapes.

import { describe, expect, it } from "vitest";
import { parseString } from "../../_helpers/parse.js";

const codes = async (migration: string): Promise<string[]> =>
  (
    await parseString(`
system Shop {
  subdomain Sales {
    context Orders {
      aggregate Order { quantity: int  amount: int }
      repository Orders for Order { }
    }
  }
  deployable api { platform: node, contexts: [Orders], port: 3000 }
}
${migration}
`)
  ).diagnostics
    .map((d) => String(d.code ?? ""))
    .filter(Boolean);

describe("migration rename — validation", () => {
  it("accepts a well-formed rename block (no migration diagnostics)", async () => {
    const found = await codes(`
migration "ok" {
  Order.qty -> quantity
  Order.total -> amount
}`);
    expect(
      found.filter((c) => c.startsWith("loom.migration") || c.startsWith("loom.rename")),
    ).toEqual([]);
  });

  it("flags a self-rename (loom.rename-to-self)", async () => {
    expect(await codes(`migration "x" { Order.quantity -> quantity }`)).toContain(
      "loom.rename-to-self",
    );
  });

  it("flags two blocks with the same name (loom.migration-duplicate-name)", async () => {
    const found = await codes(`
migration "dup" { Order.qty -> quantity }
migration "dup" { Order.total -> amount }`);
    expect(found).toContain("loom.migration-duplicate-name");
  });

  it("flags a column renamed from twice (loom.rename-duplicate-source)", async () => {
    const found = await codes(`
migration "a" { Order.qty -> quantity }
migration "b" { Order.qty -> amount }`);
    expect(found).toContain("loom.rename-duplicate-source");
  });

  it("flags two renames onto one target (loom.rename-duplicate-target)", async () => {
    const found = await codes(`
migration "a" { Order.qty -> amount }
migration "b" { Order.legacy -> amount }`);
    expect(found).toContain("loom.rename-duplicate-target");
  });

  it("a chained rename (qty -> quantity -> amount) is NOT a duplicate", async () => {
    const found = await codes(`
migration "a" { Order.qty -> quantity }
migration "b" { Order.quantity -> amount }`);
    expect(found.filter((c) => c.startsWith("loom.rename"))).toEqual([]);
  });
});

// Table steps (`OldName -> NewName`, `A.Name -> B.Name`) — both sides are bare
// names; only their structure is checked at this layer.
const tableCodes = async (migration: string): Promise<string[]> =>
  (
    await parseString(`
system Shop {
  subdomain Sales {
    context Orders {
      aggregate Order { quantity: int }
      aggregate Invoice { total: int }
      repository Orders for Order { }
      repository Invoices for Invoice { }
    }
  }
  deployable api { platform: node, contexts: [Orders], port: 3000 }
}
${migration}
`)
  ).diagnostics
    .map((d) => String(d.code ?? ""))
    .filter(Boolean);

describe("migration table rename — validation", () => {
  it("accepts a well-formed table rename (no migration diagnostics)", async () => {
    const found = await tableCodes(`migration "ok" { Legacy -> Order }`);
    expect(
      found.filter((c) => c.startsWith("loom.migration") || c.startsWith("loom.rename")),
    ).toEqual([]);
  });

  it("flags a table self-rename (loom.rename-to-self)", async () => {
    expect(await tableCodes(`migration "x" { Order -> Order }`)).toContain("loom.rename-to-self");
  });

  it("flags an aggregate renamed from twice (loom.rename-duplicate-source)", async () => {
    const found = await tableCodes(`
migration "a" { Legacy -> Order }
migration "b" { Legacy -> Invoice }`);
    expect(found).toContain("loom.rename-duplicate-source");
  });

  it("flags two renames onto one aggregate (loom.rename-duplicate-target)", async () => {
    const found = await tableCodes(`
migration "a" { Legacy -> Order }
migration "b" { Ancient -> Order }`);
    expect(found).toContain("loom.rename-duplicate-target");
  });

  it("an unknown target is left to the IR check, not flagged structurally", async () => {
    const found = await tableCodes(`migration "x" { Legacy -> Nonexistent }`);
    // The target is a bare name, resolved on the merged IR
    // (`loom.migration-step-target-missing`, test/ir/migration-table-steps.test.ts).
    expect(found.filter((c) => c.startsWith("loom.rename"))).toEqual([]);
  });

  it("a move keeps its context: `A.Order -> Orders.Order` is no self-rename", async () => {
    const found = await tableCodes(`migration "m" { Legacy.Order -> Orders.Order }`);
    expect(found.filter((c) => c.startsWith("loom.rename"))).toEqual([]);
    expect(await tableCodes(`migration "m" { Orders.Order -> Orders.Order }`)).toContain(
      "loom.rename-to-self",
    );
  });
});
