// Validation for the M-T2.3 `migration`-block data steps — the AST-level
// structural checks (src/language/validators/migration.ts) and the phase-⑦
// IR checks (src/ir/validate/checks/migration-checks.ts).  The temporary S2
// honest gate is gone: the builder consumes the intents (S3).

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../../src/ir/validate/validate.js";
import { parseString } from "../../_helpers/parse.js";

const SYS = `
system Shop {
  subdomain Sales {
    context Orders {
      enum OrderStatus { Pending, Confirmed }
      valueobject Money { amount: decimal  currency: string }
      aggregate Order {
        quantity: int
        status: OrderStatus
        price: Money
        note: string?
        placedAt: datetime
        dueAt: datetime
        tags: string[]
      }
      aggregate Doc shape: document { body: string }
      repository Orders for Order { }
      repository Docs for Doc { }
    }
  }
  deployable api { platform: node, contexts: [Orders], port: 3000 }
}
`;

/** AST-level diagnostic codes. */
const astCodes = async (migration: string): Promise<string[]> =>
  (await parseString(`${SYS}\n${migration}`)).diagnostics
    .map((d) => String(d.code ?? ""))
    .filter(Boolean);

/** Phase-⑦ IR diagnostic codes. */
const irCodes = async (migration: string): Promise<string[]> => {
  const { model } = await parseString(`${SYS}\n${migration}`, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .map((d) => d.code ?? "")
    .filter(Boolean);
};

describe("migration data steps — AST validation (M-T2.3)", () => {
  it("flags a backfill of a field the aggregate does not declare", async () => {
    expect(await astCodes(`migration "x" { Order.missing = 1 }`)).toContain(
      "loom.backfill-unknown-field",
    );
  });

  it("flags two backfills of one column in one block", async () => {
    expect(await astCodes(`migration "x" { Order.quantity = 1  Order.quantity = 2 }`)).toContain(
      "loom.backfill-duplicate",
    );
  });

  it("allows re-backfilling the same column in a LATER block (ledger history)", async () => {
    const found = await astCodes(
      `migration "a" { Order.quantity = 1 }\nmigration "b" { Order.quantity = 2 }`,
    );
    expect(found).not.toContain("loom.backfill-duplicate");
  });

  it("flags an empty sql step", async () => {
    expect(await astCodes(`migration "x" { sql "  " }`)).toContain("loom.migration-sql-empty");
  });
});

describe("migration data steps — IR validation (M-T2.3)", () => {
  it("accepts a well-formed backfill (no migration diagnostics)", async () => {
    const found = await irCodes(`migration "ok" {
      Order.status = Pending
      Order.quantity = quantity + 1
      Order.note = null
    }`);
    expect(found).not.toContain("loom.migration-expr-unsupported");
    expect(found).not.toContain("loom.backfill-type-mismatch");
    expect(found).not.toContain("loom.backfill-target-invalid");
    expect(found).not.toContain("loom.migration-data-steps-unsupported");
  });

  it("rejects an expression outside the SQL-renderable subset", async () => {
    expect(await irCodes(`migration "x" { Order.quantity = [1, 2].count }`)).toContain(
      "loom.migration-expr-unsupported",
    );
  });

  it("rejects a type-mismatched backfill value", async () => {
    expect(await irCodes(`migration "x" { Order.quantity = "lots" }`)).toContain(
      "loom.backfill-type-mismatch",
    );
  });

  it("rejects NULL into a non-optional column", async () => {
    expect(await irCodes(`migration "x" { Order.quantity = null }`)).toContain(
      "loom.backfill-type-mismatch",
    );
  });

  it("rejects a value-object target (no single scalar column)", async () => {
    expect(await irCodes(`migration "x" { Order.price = 1 }`)).toContain(
      "loom.backfill-target-invalid",
    );
  });

  it("admits datetime ± a duration constructor (rendered as a Postgres interval)", async () => {
    const found = await irCodes(`migration "x" {
      Order.dueAt = placedAt + hours(24)
      Order.placedAt = dueAt - days(quantity)
    }`);
    expect(found).not.toContain("loom.migration-expr-unsupported");
    expect(found).not.toContain("loom.backfill-type-mismatch");
  });

  it("still refuses a duration that is not added to a datetime", async () => {
    expect(await irCodes(`migration "x" { Order.quantity = quantity + hours(1) }`)).toContain(
      "loom.migration-expr-unsupported",
    );
  });

  it("tells a collection backfill it is unnecessary (the add fills it empty)", async () => {
    const { model } = await parseString(`${SYS}\nmigration "x" { Order.tags = [] }`, {
      validate: false,
    });
    const d = validateLoomModel(enrichLoomModel(lowerModel(model))).find(
      (x) => x.code === "loom.backfill-target-invalid",
    );
    expect(d?.message).toContain("a collection field needs no backfill");
  });

  it("rejects a backfill on a shape: document aggregate", async () => {
    expect(await irCodes(`migration "x" { Doc.body = "b" }`)).toContain(
      "loom.backfill-target-invalid",
    );
  });

  it("admits raw sql steps (the S2 honest gate is lifted)", async () => {
    expect(await irCodes(`migration "x" { sql "ANALYZE orders" }`)).not.toContain(
      "loom.migration-data-steps-unsupported",
    );
  });
});
