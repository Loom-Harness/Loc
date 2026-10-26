// .NET Dapper (persistence: dapper) applies the shared MigrationsIR chain
// (D-DAPPER-ALTER / M-T2.17).
//
// What this file pins, at the emission level (the runtime proof is the
// migration-evolution `dapper` leg, `test:migration-evolution-dapper`):
//
//   - the chain is emitted as versioned `Migrations/<version>_<Module>_<Name>.cs`
//     classes (the id EF gives the same migration), rendered by `sql-pg.ts`;
//   - the `CREATE TABLE IF NOT EXISTS` bootstrap is gone — `DbSchema.cs` is the
//     runner: `public.__loom_migrations`, one transaction per migration, an
//     advisory lock, and no legacy-bootstrap baseline;
//   - the steps are projected onto the Dapper column layout — a value object is
//     ONE jsonb column, a list is jsonb, a value-object list has no child table
//     — because that is what the repositories read and write;
//   - the connection's `search_path` names the schemas the tables land in.

import { describe, expect, it } from "vitest";
import {
  dapperMigrationSteps,
  dapperStatements,
  projectDapperTable,
} from "../../../src/generator/dotnet/emit/dapper-migrations.js";
import type {
  MigrationsIR,
  SchemaSnapshot,
  TableShape,
} from "../../../src/ir/types/migrations-ir.js";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SOURCE = (persistence: string) => `
system Dm {
  subdomain Sales {
    context Orders {
      valueobject Money { amount: int  currency: string }
      enum Kind { A, B }
      aggregate Order with crudish {
        code: string
        total: Money
        discount: Money?
        tags: string[]
        kinds: Kind[]
        charges: Money[]
        unique (code)
      }
      repository Orders for Order { }
    }
  }
  api A from Sales
  storage pg { type: postgres }
  resource s { for: Orders, kind: state, use: pg }
  deployable d {
    platform: dotnet { persistence: ${persistence} }
    contexts: [Orders]
    dataSources: [s]
    serves: A
    port: 4000
  }
}`;

const unverb = (s: string) => s.replace(/""/g, '"');

describe("Dapper: the migration chain, emitted", () => {
  it("emits a versioned migration class per generation and a runner in place of the bootstrap", async () => {
    const files = await generateSystemFiles(SOURCE("dapper"));
    const migrations = [...files.keys()].filter((p) => p.startsWith("d/Migrations/"));
    expect(migrations).toEqual(["d/Migrations/20260101000000_Sales_Initial.cs"]);
    const initial = files.get(migrations[0]!)!;
    expect(initial).toContain(
      "public sealed class M20260101000000_Sales_Initial : global::D.Infrastructure.Persistence.LoomMigration",
    );
    expect(initial).toContain('public override string Id => "20260101000000_Sales_Initial";');
    // No database predates the chain, so nothing is baselined: an Initial
    // carries no table list and the runner never adopts existing tables.
    expect(initial).not.toContain("CreatesTables");

    const runner = files.get("d/Infrastructure/Persistence/DbSchema.cs")!;
    expect(runner).not.toContain("CREATE TABLE IF NOT EXISTS orders");
    expect(runner).toContain("public.__loom_migrations");
    expect(runner).toContain("pg_advisory_lock");
    expect(runner).toContain("pg_advisory_unlock");
    expect(runner).toContain("BeginTransactionAsync");
    expect(runner).toContain("INSERT INTO public.__loom_migrations (tag) VALUES (@tag)");
    expect(runner).not.toContain("BaselineLegacyAsync");
    expect(runner).not.toContain("CreatesTables");
    expect(runner).not.toContain("SET SCHEMA");

    const program = files.get("d/Program.cs")!;
    expect(program).toContain('SearchPath = "public,orders"');
    expect(program).toMatch(
      /DbSchema\.EnsureAsync\(\s*app\.Services\.GetRequiredService<NpgsqlDataSource>\(\),/,
    );
    // EF's migrator must not also run on the Dapper path.
    expect(program).not.toContain("Database.Migrate()");
  });

  it("creates the tables in the Dapper layout, schema-qualified like EF's", async () => {
    const files = await generateSystemFiles(SOURCE("dapper"));
    const sql = unverb(files.get("d/Migrations/20260101000000_Sales_Initial.cs")!);
    expect(sql).toContain('CREATE TABLE "orders"."orders" (');
    // value object → one jsonb column, required/optional by the field
    expect(sql).toContain('"total" JSONB NOT NULL');
    expect(sql).toContain('"discount" JSONB NULL');
    expect(sql).not.toContain("total_amount");
    // scalar / enum list → jsonb, not a Postgres array
    expect(sql).toContain('"tags" JSONB NOT NULL');
    expect(sql).toContain('"kinds" JSONB NOT NULL');
    // value-object list → jsonb on the parent, no child table
    expect(sql).toContain('"charges" JSONB NOT NULL');
    expect(sql).not.toContain("order_charges");
    // value-object null-consistency CHECK has no leaf columns to constrain
    expect(sql).not.toContain("null_consistent");
    // the shared unique index survives the projection
    expect(sql).toContain('CREATE UNIQUE INDEX "orders_code_uq" ON "orders"."orders" ("code");');
  });

  it("leaves the EF adapter's output alone — still EF migrations, no runner", async () => {
    const files = await generateSystemFiles(SOURCE("efcore"));
    expect(files.has("d/Infrastructure/Persistence/DbSchema.cs")).toBe(false);
    const ef = files.get("d/Migrations/20260101000000_Sales_Initial.cs")!;
    expect(ef).toContain("migrationBuilder.Sql(");
    expect(unverb(ef)).toContain('"total_amount"');
  });
});

// ---------------------------------------------------------------------------
// The DELTA projection, on hand-built MigrationsIR — the cases a first
// generation never reaches.
// ---------------------------------------------------------------------------

const ORDERS = (cols: TableShape["columns"]): TableShape => ({
  name: "orders",
  ownerModule: "M",
  schema: "s",
  columns: [{ name: "id", type: { kind: "uuid" }, nullable: false }, ...cols],
  primaryKey: ["id"],
  foreignKeys: [],
  indexes: [],
});
const snap = (tables: TableShape[]): SchemaSnapshot => ({ schemaVersion: 1, tables });
const delta = (
  before: TableShape[],
  after: TableShape[],
  steps: MigrationsIR["steps"],
): MigrationsIR => ({
  module: "M",
  storageName: "",
  baseline: snap(before),
  next: snap(after),
  steps,
  version: "20260101500001",
  name: "Delta",
});

describe("Dapper: delta steps on the jsonb layout", () => {
  it("a value object added later is ONE jsonb column, not its leaves", () => {
    const leaves = [
      { name: "ship_amount", type: { kind: "int" as const }, nullable: true, voGroup: "ship" },
      { name: "ship_currency", type: { kind: "text" as const }, nullable: true, voGroup: "ship" },
    ];
    const m = delta(
      [ORDERS([])],
      [ORDERS(leaves)],
      [
        ...leaves.map((column) => ({
          op: "addColumn" as const,
          table: "orders",
          schema: "s",
          column,
        })),
        {
          op: "addCheck",
          schema: "s",
          check: { name: "orders_ship_null_consistent", table: "orders", expression: "x" },
        },
      ],
    );
    expect(dapperStatements(dapperMigrationSteps(m))).toEqual([
      'ALTER TABLE "s"."orders" ADD COLUMN "ship" JSONB NULL;',
    ]);
  });

  it("a value-object list added to an existing table becomes a jsonb column, filled with []", () => {
    const parentCol = {
      name: "charges",
      type: { kind: "json" as const },
      nullable: false,
      valueArrayChildTable: "order_charges",
    };
    const child: TableShape = {
      name: "order_charges",
      ownerModule: "M",
      schema: "s",
      columns: [{ name: "order_id", type: { kind: "uuid" }, nullable: false }],
      primaryKey: ["order_id"],
      foreignKeys: [],
      indexes: [],
    };
    const m = delta(
      [ORDERS([])],
      [ORDERS([parentCol]), child],
      [{ op: "createTable", table: child }],
    );
    expect(dapperStatements(dapperMigrationSteps(m))).toEqual([
      'ALTER TABLE "s"."orders" ADD COLUMN "charges" JSONB NULL;',
      `UPDATE "s"."orders" SET "charges" = '[]'::jsonb WHERE "charges" IS NULL;`,
      'ALTER TABLE "s"."orders" ALTER COLUMN "charges" SET NOT NULL;',
    ]);
  });

  it("a renamed value-object field renames its jsonb column once", () => {
    const leaf = (f: string, sub: string) => ({
      name: `${f}_${sub}`,
      type: { kind: "text" as const },
      nullable: false,
      voGroup: f,
    });
    const m = delta(
      [ORDERS([leaf("price", "amount"), leaf("price", "currency")])],
      [ORDERS([leaf("cost", "amount"), leaf("cost", "currency")])],
      ["amount", "currency"].map((sub) => ({
        op: "renameColumn" as const,
        table: "orders",
        schema: "s",
        from: `price_${sub}`,
        to: `cost_${sub}`,
        type: { kind: "text" as const },
      })),
    );
    expect(dapperStatements(dapperMigrationSteps(m))).toEqual([
      'ALTER TABLE "s"."orders" RENAME COLUMN "price" TO "cost";',
    ]);
  });

  it("plain column steps, raw sql and index flips pass through unchanged", () => {
    const code = [{ name: "code", type: { kind: "text" as const }, nullable: false }];
    const idx = { name: "orders_code_uq", table: "orders", columns: ["code"], unique: true };
    const m = delta(
      [{ ...ORDERS(code), indexes: [idx] }],
      [{ ...ORDERS(code), indexes: [idx] }],
      [
        { op: "dropIndex", table: "orders", schema: "s", name: "orders_code_uq" },
        {
          op: "addIndex",
          schema: "s",
          index: {
            name: "orders_code_uq",
            table: "orders",
            columns: ["code"],
            unique: true,
            predicate: "is_deleted = false",
          },
        },
        { op: "sqlExec", sql: "DELETE FROM s.orders WHERE is_deleted" },
      ],
    );
    expect(dapperStatements(dapperMigrationSteps(m))).toEqual([
      'DROP INDEX "s"."orders_code_uq";',
      'CREATE UNIQUE INDEX "orders_code_uq" ON "s"."orders" ("code") WHERE is_deleted = false;',
      "DELETE FROM s.orders WHERE is_deleted;",
    ]);
  });

  it("projectDapperTable keeps an enum CHECK only while its column exists", () => {
    const t = projectDapperTable({
      ...ORDERS([
        { name: "status", type: { kind: "text" }, nullable: false },
        { name: "p_kind", type: { kind: "text" }, nullable: true, voGroup: "p" },
      ]),
      checks: [
        { name: "a", table: "orders", kind: "enumValues", expression: `"status" IN ('x')` },
        { name: "b", table: "orders", kind: "enumValues", expression: `"p_kind" IN ('x')` },
      ],
    });
    expect(t.checks?.map((c) => c.name)).toEqual(["a"]);
    expect(t.columns.map((c) => c.name)).toEqual(["id", "status", "p"]);
  });

  it("drops the FK of an `X id` inside a value object — the id lives in the jsonb", () => {
    // Found by the dapper behavioural leg (`vo-id-reference`): the Initial
    // failed with 42703 `column "berth_ship" referenced in foreign key
    // constraint does not exist`.
    const t = projectDapperTable({
      ...ORDERS([
        { name: "owner_id", type: { kind: "uuid" }, nullable: false },
        { name: "berth_ship", type: { kind: "uuid" }, nullable: false, voGroup: "berth" },
      ]),
      foreignKeys: [
        { column: "owner_id", refTable: "owners", onDelete: "restrict" },
        { column: "berth_ship", refTable: "ships", onDelete: "restrict" },
      ],
    });
    expect(t.foreignKeys.map((fk) => fk.column)).toEqual(["owner_id"]);
  });
});
