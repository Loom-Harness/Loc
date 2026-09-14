// Regression: a child table's Drizzle schema must agree with the migration on
// the FK — same index NAME and an explicit `.references()`.
//
// Two child-table kinds reach this, and they were fixed at different times:
// containment PARTS (below) and value-object COLLECTIONS (`<VO>[]`, the second
// describe).  The value-collection emitter was missed when the parts one was
// corrected, so it kept the same two defects for both owners it serves.
//
// The part table's parent FK column is `<parent>_id` (e.g. `project_id`), but
// the schema named its index `<table>_parent_id_idx` (literal "parent_id") while
// the migration creates `<table>_project_id_idx` + `FOREIGN KEY … REFERENCES …
// ON DELETE CASCADE`.  The schema also omitted `.references()`.  Loom ships its
// own SQL migrations (so the DB is correct either way), but the Drizzle schema's
// FK/index metadata drifted from it — aligned here for consistency.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SRC = `
system Acme {
  subdomain Sales {
    context S {
      aggregate Project {
        name: string
        contains pipelines: Pipeline[]
        entity Pipeline { label: string }
      }
      repository Projects for Project { }
    }
  }
  api SalesApi from Sales
  storage primarySql { type: postgres }
  resource sState { for: S, kind: state, use: primarySql }
  deployable api {
    platform: node
    contexts: [S]
    dataSources: [sState]
    serves: SalesApi
    port: 3001
  }
}
`;

describe("hono drizzle schema — containment FK matches the migration", () => {
  it("indexes the FK by its real column name and declares .references()", async () => {
    const files = await generateSystemFiles(SRC);
    const schema = [...files.entries()].find(([p]) => p.endsWith("db/schema.ts"))?.[1];
    expect(schema, "db/schema.ts").toBeDefined();
    // Index name uses the real FK column (`project_id`), matching the migration.
    expect(schema).toContain('index("pipelines_project_id_idx")');
    expect(schema).not.toContain('index("pipelines_parent_id_idx")');
    // The FK is declared so Drizzle's metadata mirrors the migration's
    // FOREIGN KEY … ON DELETE CASCADE.
    expect(schema).toMatch(
      /parentId:\s*uuid\("project_id"\)\.notNull\(\)\.references\(\(\) => projects\.id, \{ onDelete: "cascade" \}\)/,
    );
  });
});

// ---------------------------------------------------------------------------
// The same contract for value-object COLLECTION child tables (`<VO>[]`).
//
// `emitValueCollectionTable` hard-coded the literal `parent_id` in its index
// name and declared no `.references()`, so it emitted
// `index("order_lines_parent_id_idx")` against a table whose FK column is
// `order_id` — a name matching no column, which the migration could never
// agree with and `drizzle-kit generate/push` would recreate as a duplicate.
// The parts path above (and every other backend: python's `Index(...)`, EF's
// `HasForeignKey`, JPA's `@JoinColumn`, Ecto's `belongs_to`) already keyed off
// the real FK column.
//
// A value collection can hang off the aggregate OR off an entity part, and the
// FK points at whichever owns it — both covered here, because the owner is
// what the fix had to thread through.
// ---------------------------------------------------------------------------
const VC_SRC = `
system Acme {
  subdomain Ordering {
    context Ord {
      valueobject LineVO { sku: string  qty: int }
      aggregate Order {
        note: string
        lines: LineVO[]
        contains shipments: Shipment[]
        entity Shipment { carrier: string  legs: LineVO[] }
      }
      repository Orders for Order { }
    }
  }
  api OrdApi from Ordering
  storage primarySql { type: postgres }
  resource ordState { for: Ord, kind: state, use: primarySql }
  deployable api {
    platform: node
    contexts: [Ord]
    dataSources: [ordState]
    serves: OrdApi
    port: 3001
  }
}
`;

describe("hono drizzle schema — value-collection FK matches the migration", () => {
  async function generated() {
    const files = await generateSystemFiles(VC_SRC);
    const entries = [...files.entries()];
    const schema = entries.find(([p]) => p.endsWith("db/schema.ts"))?.[1];
    const sql = entries
      .filter(([p]) => p.includes("db/migrations/") && p.endsWith(".sql"))
      .map(([, c]) => c)
      .join("\n");
    expect(schema, "db/schema.ts").toBeDefined();
    expect(sql, "db/migrations/*.sql").not.toBe("");
    return { schema: schema as string, sql };
  }

  it("indexes an aggregate-owned collection by its real FK column, and references the owner", async () => {
    const { schema } = await generated();
    expect(schema).toContain('index("order_lines_order_id_idx")');
    expect(schema).not.toContain('index("order_lines_parent_id_idx")');
    expect(schema).toMatch(
      /parentId:\s*uuid\("order_id"\)\.notNull\(\)\.references\(\(\) => orders\.id, \{ onDelete: "cascade" \}\)/,
    );
  });

  it("points a PART-owned collection at the part table, not the aggregate", async () => {
    const { schema } = await generated();
    expect(schema).toContain('index("shipment_legs_shipment_id_idx")');
    expect(schema).not.toContain('index("shipment_legs_parent_id_idx")');
    // `shipments`, not `orders` — the legs hang off the part row.
    expect(schema).toMatch(
      /parentId:\s*uuid\("shipment_id"\)\.notNull\(\)\.references\(\(\) => shipments\.id, \{ onDelete: "cascade" \}\)/,
    );
  });

  // The general form of both defects, and the one that catches the NEXT child
  // table kind someone adds: an index the ORM declares but the DDL never
  // creates is drift by definition, whatever its name.
  it("every index the schema declares is one the migration actually creates", async () => {
    const { schema, sql } = await generated();
    const declared = [...schema.matchAll(/\bindex\("([^"]+)"\)/g)].map((m) => m[1]);
    const created = new Set(
      [...sql.matchAll(/CREATE INDEX (?:IF NOT EXISTS )?"([^"]+)"/g)].map((m) => m[1]),
    );
    expect(declared.length, "fixture should declare some indexes").toBeGreaterThan(2);
    expect(declared.filter((n) => !created.has(n))).toEqual([]);
  });
});
