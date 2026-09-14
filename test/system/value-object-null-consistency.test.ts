// A flattened OPTIONAL value object is N independent nullable columns, and
// until this gate nothing in the schema said the group has to be written and
// read as a unit.  Measured (audit P9, a Hibernate 7 + H2 probe against the
// emitted java mapping, rows inserted by raw SQL so no write path could mask
// the read): an all-NULL row loads as `null` and never invokes the compact
// constructor — correct — while a PARTIALLY null row throws
// `InstantiationException` -> NPE inside it.  node's `!` would hand back a VO
// with undefined leaves and python would build a VO of `None`s.
//
// No application write path produces such a row today, which is exactly why
// the repair is a schema CONSTRAINT and not an emitter change: a hand-written
// UPDATE, a bad migration backfill, or a future partial-update path can all
// make one, and the database would accept it.
//
// The four flattening backends (node / dotnet / java / python) share
// `MigrationsIR` and all render through `renderPgStep`, so the constraint
// lands on all four at once.  Phoenix/Ecto stores a value object as ONE `:map`
// cell — the group cannot be half-written — and emits none.

import { describe, expect, it } from "vitest";
import { renderEctoStep } from "../../src/generator/elixir/migrations-emit.js";
import { renderPgStep } from "../../src/generator/sql-pg.js";
import type { TableShape } from "../../src/ir/types/migrations-ir.js";
import { diffSchema, schemaFromModule } from "../../src/system/migrations-builder.js";
import { buildLoomModel, generateSystemFiles } from "../_helpers/index.js";

/** `Addr` carries every shape the grouping rule has to separate:
 *   - `line1` / `city` — plainly required, so they ARE the group;
 *   - `line2` — optional WITHIN the value object, so it must be excluded or a
 *     present address with no second line is rejected (a constraint that
 *     refuses valid data is strictly worse than the gap it closes);
 *   - `geo` — an optional NESTED value object, which owns its own group;
 *   - `region` — a REQUIRED nested value object, which folds into the
 *     parent's group (it is present exactly when the parent is).
 *  `shipTo` is optional, `billTo` required, `tip` a two-leaf optional VO,
 *  `note` a ONE-leaf optional VO, `span` an all-optional-leaf VO. */
const FIXTURE = `
system VO {
  subdomain S {
    context C {
      valueobject Geo { lat: decimal currency: string }
      valueobject Region { code: string name: string }
      valueobject Addr {
        line1: string
        line2: string?
        city: string
        geo: Geo?
        region: Region
      }
      valueobject Amount { value: decimal currency: string }
      valueobject Note { body: string }
      valueobject Span { lo: int? hi: int? }
      aggregate Order with crudish {
        code: string
        shipTo: Addr?
        billTo: Addr
        total: Amount
        tip: Amount?
        note: Note?
        span: Span?
      }
      repository Orders for Order { }
    }
  }
  api SApi from S
  storage loomDb { type: postgres }
  resource cState { for: C, kind: state, use: loomDb }
  deployable h { platform: node   contexts: [C] dataSources: [cState] serves: SApi port: 3000 }
  deployable d { platform: dotnet contexts: [C] dataSources: [cState] serves: SApi port: 8080 }
  deployable j { platform: java   contexts: [C] dataSources: [cState] serves: SApi port: 8081 }
  deployable y { platform: python contexts: [C] dataSources: [cState] serves: SApi port: 8000 }
  deployable p { platform: elixir contexts: [C] dataSources: [cState] serves: SApi port: 4000 }
}
`;

async function ordersTable(): Promise<TableShape> {
  const loom = await buildLoomModel(FIXTURE);
  const snap = schemaFromModule(loom.systems[0]!.subdomains[0]!);
  return snap.tables.find((t) => t.name === "orders")!;
}

function findFile(files: Map<string, string>, pattern: RegExp): string {
  for (const [k, v] of files) if (pattern.test(k)) return v;
  throw new Error(`no generated file matched ${pattern}`);
}

/** The columns a generated null-consistency expression names, in order. */
function checkedColumns(expression: string): string[] {
  const allNullArm = expression.slice(1, expression.indexOf(") OR ("));
  return allNullArm.split(" AND ").map((t) => t.replace(/^"|" IS NULL$/g, ""));
}

describe("flattened value object — all-null-or-all-present CHECK", () => {
  it("an OPTIONAL value object gets one check over its required leaves", async () => {
    const orders = await ordersTable();
    const check = orders.checks?.find((c) => c.name === "orders_ship_to_null_consistent");
    expect(check).toBeDefined();
    expect(check!.expression).toBe(
      '("ship_to_line1" IS NULL AND "ship_to_city" IS NULL AND "ship_to_region_code" IS NULL ' +
        'AND "ship_to_region_name" IS NULL) OR ("ship_to_line1" IS NOT NULL AND ' +
        '"ship_to_city" IS NOT NULL AND "ship_to_region_code" IS NOT NULL AND ' +
        '"ship_to_region_name" IS NOT NULL)',
    );
  });

  it("a subfield that is itself OPTIONAL is excluded — the constraint must not reject valid data", async () => {
    const orders = await ordersTable();
    const check = orders.checks!.find((c) => c.name === "orders_ship_to_null_consistent")!;
    // `line2: string?` is a legitimately-null column of a PRESENT address.
    expect(orders.columns.map((c) => c.name)).toContain("ship_to_line2");
    expect(checkedColumns(check.expression)).not.toContain("ship_to_line2");
  });

  it("a REQUIRED nested value object folds into the parent's group (whole tree, not one level)", async () => {
    const orders = await ordersTable();
    const check = orders.checks!.find((c) => c.name === "orders_ship_to_null_consistent")!;
    // `region: Region` is present exactly when the address is, so its leaves
    // belong to the address's own group.
    expect(checkedColumns(check.expression)).toEqual([
      "ship_to_line1",
      "ship_to_city",
      "ship_to_region_code",
      "ship_to_region_name",
    ]);
  });

  it("an OPTIONAL nested value object gets its OWN check and leaves the parent's group", async () => {
    const orders = await ordersTable();
    const nested = orders.checks!.find((c) => c.name === "orders_ship_to_geo_null_consistent")!;
    expect(checkedColumns(nested.expression)).toEqual(["ship_to_geo_lat", "ship_to_geo_currency"]);
    const outer = orders.checks!.find((c) => c.name === "orders_ship_to_null_consistent")!;
    expect(checkedColumns(outer.expression)).not.toContain("ship_to_geo_lat");
  });

  it("a REQUIRED value object gets no check of its own — its leaves are already NOT NULL", async () => {
    const orders = await ordersTable();
    expect(orders.checks!.map((c) => c.name)).not.toContain("orders_bill_to_null_consistent");
    expect(orders.checks!.map((c) => c.name)).not.toContain("orders_total_null_consistent");
    // …but an OPTIONAL value object nested inside a required one still does:
    // `bill_to_geo_*` are nullable columns of a present address.
    expect(orders.checks!.map((c) => c.name)).toContain("orders_bill_to_geo_null_consistent");
  });

  it("fewer than two required leaves ⇒ no check (a tautology, or nothing observable to assert)", async () => {
    const orders = await ordersTable();
    const names = orders.checks!.map((c) => c.name);
    // One leaf: `c IS NULL OR c IS NOT NULL`.
    expect(names).not.toContain("orders_note_null_consistent");
    // Zero required leaves: an absent VO and a present all-null one are the
    // same row, so there is no invariant to state.
    expect(names).not.toContain("orders_span_null_consistent");
  });

  it("every check names only nullable columns that exist on the table", async () => {
    const orders = await ordersTable();
    const nullable = new Set(orders.columns.filter((c) => c.nullable).map((c) => c.name));
    for (const check of orders.checks ?? []) {
      for (const col of checkedColumns(check.expression)) expect(nullable).toContain(col);
    }
  });
});

describe("flattened value object — CHECK reaches the generated schema", () => {
  it("lands inline in CREATE TABLE on all four flattening backends", async () => {
    const files = await generateSystemFiles(FIXTURE);
    const inline = /CONSTRAINT "+orders_tip_null_consistent"+ CHECK \(/;
    expect(findFile(files, /h\/db\/migrations\/.*\.sql$/)).toMatch(inline);
    expect(findFile(files, /y\/migrations\/.*\.sql$/)).toMatch(inline);
    expect(findFile(files, /j\/src\/main\/resources\/db\/migration\/.*\.sql$/)).toMatch(inline);
    // Inside the C# verbatim @"…" literal the SQL's double quotes are doubled.
    expect(findFile(files, /d\/Migrations\/.*\.cs$/)).toMatch(inline);
  });

  it("Phoenix emits none — Ecto stores a value object as one :map, so it cannot be half-written", async () => {
    const files = await generateSystemFiles(FIXTURE);
    const ecto = findFile(files, /p\/priv\/repo\/migrations\/.*create_orders\.exs$/);
    expect(ecto).not.toMatch(/null_consistent/);
    // The reason it is immune, pinned: one `:map` column per value object.
    expect(ecto).toMatch(/add :ship_to, :map, null: true/);
    expect(ecto).not.toMatch(/ship_to_line1/);
  });
});

describe("flattened value object — the CHECK through the diff", () => {
  it("a same-schema regen emits no steps (the checks round-trip through the snapshot)", async () => {
    const loom = await buildLoomModel(FIXTURE);
    const snap = schemaFromModule(loom.systems[0]!.subdomains[0]!);
    expect(diffSchema(snap, snap)).toEqual([]);
  });

  it("a baseline that predates the field adds them, NOT VALID, so a populated database still migrates", async () => {
    const loom = await buildLoomModel(FIXTURE);
    const next = schemaFromModule(loom.systems[0]!.subdomains[0]!);
    // A pre-`checks` snapshot: identical, minus the constraints.
    const prev = { ...next, tables: next.tables.map((t) => ({ ...t, checks: undefined })) };
    const steps = diffSchema(prev, next);
    expect(steps.every((s) => s.op === "addCheck")).toBe(true);
    const sql = steps.map(renderPgStep).join("\n");
    // NOT VALID: the constraint's whole point is that stored rows CAN violate
    // it, so validating retroactively would abort the migration on exactly the
    // database that most needs the guard.  Future writes are enforced at once.
    expect(sql).toMatch(/ADD CONSTRAINT "orders_tip_null_consistent" CHECK \(.*\) NOT VALID;/);
    // …and the operator is told how to check the old rows deliberately.
    expect(sql).toMatch(
      /-- NOT VALID: already-stored rows are not re-checked\. To verify them, run ALTER TABLE .* VALIDATE CONSTRAINT "orders_tip_null_consistent"\n/,
    );
    // The note LEADS the statement and carries no `;`: every consumer splits
    // the file on a statement terminator, so a trailing comment would be
    // handed over as a statement of its own (an empty query).
    for (const line of sql.split("\n")) {
      if (line.startsWith("--")) expect(line).not.toContain(";");
    }
    // Phoenix has no columns to constrain — the step renders to nothing.
    expect(steps.flatMap(renderEctoStep)).toEqual([]);
  });

  it("a group that changes shape is dropped and re-added (Postgres cannot alter a CHECK in place)", async () => {
    const loom = await buildLoomModel(FIXTURE);
    const next = schemaFromModule(loom.systems[0]!.subdomains[0]!);
    const prev = {
      ...next,
      tables: next.tables.map((t) =>
        t.name === "orders"
          ? {
              ...t,
              checks: t.checks!.map((c) =>
                c.name === "orders_tip_null_consistent" ? { ...c, expression: "1 = 1" } : c,
              ),
            }
          : t,
      ),
    };
    const steps = diffSchema(prev, next);
    expect(steps.map((s) => s.op)).toEqual(["dropCheck", "addCheck"]);
    // The drop precedes every column change and the add follows every one, so
    // a constraint never outlives or outruns the columns it names.
    expect(renderPgStep(steps[0]!)).toMatch(
      /DROP CONSTRAINT IF EXISTS "orders_tip_null_consistent";/,
    );
  });
});
