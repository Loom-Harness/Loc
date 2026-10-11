// A `unique (...)` key has ONE enforcement — the database unique index the
// migration declares (`<table>_<cols>_uq`, partial `WHERE is_deleted = false`
// under `softDeletable`) — but the node backend builds its schema from three
// definitions, and each must carry the index:
//
//   real Postgres, drizzle  → `db/migrations/*.sql` (the shared MigrationsIR)
//   PGlite (the playground) → `synthDDL` over the DRIZZLE schema object
//   real Postgres, MikroORM → `orm.schema.updateSchema()` over the EntitySchema
//                             metadata — the migration files are never run
//
// A key missing from the MikroORM metadata is a duplicate that commits with
// 201; one missing from the drizzle object is the same on a synthesised
// database.  The runtime half is `corpus/unique-conflict` (node and mikroorm
// legs, against one golden); this pins every shape a key may sit on — a
// relational root, a compound key, a soft-deletable (partial) key and a TPH
// shared table — against the migration, both directions.  (`shape: embedded`
// and `shape: document` refuse a key at validation: no single relational
// table to constrain.)

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const model = (persistence: string): string => `
system U {
  subdomain S {
    context C {
      aggregate Member with crudish {
        email: string
        name: string
        unique (email)
      }
      aggregate Listing with crudish {
        sku: string
        region: string
        unique (sku, region)
      }
      aggregate Venue with softDeletable, softDelete, crudish {
        handle: string
        unique (handle)
      }
      abstract aggregate Animal {
        tag: string
        unique (tag)
      }
      aggregate Dog extends Animal with crudish { bark: string }
      aggregate Cat extends Animal with crudish { purr: string }
      repository Members for Member { }
      repository Listings for Listing { }
      repository Venues for Venue { }
      repository Dogs for Dog { }
      repository Cats for Cat { }
    }
  }
  api A from S
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d {
    platform: node${persistence}
    contexts: [C]
    dataSources: [st]
    serves: A
    port: 4000
  }
}
`;

/** `name → "cols|predicate"` for one unique index. */
type UniqueSet = Map<string, string>;

function fromMigrations(files: Map<string, string>): UniqueSet {
  const out: UniqueSet = new Map();
  const sql = [...files.entries()]
    .filter(([p]) => p.includes("/db/migrations/") && p.endsWith(".sql"))
    .map(([, c]) => c)
    .join("\n");
  for (const m of sql.matchAll(
    /CREATE UNIQUE INDEX "([a-z_]+)" ON "[a-z_]+"\."[a-z_]+" \(([^)]*)\)(?: WHERE ([^;]+))?;/g,
  )) {
    out.set(m[1]!, `${m[2]!.replace(/"/g, "")}|${m[3] ?? ""}`);
  }
  return out;
}

function fromDrizzle(files: Map<string, string>): UniqueSet {
  const out: UniqueSet = new Map();
  const schema = [...files.entries()].find(([p]) => p.endsWith("/db/schema.ts"))?.[1] ?? "";
  for (const m of schema.matchAll(
    /uniqueIndex\("([a-z_]+)"\)\.on\(([^)]*)\)(?:\.where\(sql`([^`]*)`\))?/g,
  )) {
    const cols = m[2]!.split(",").map((c) => snake(c.trim().replace(/^table\./, "")));
    out.set(m[1]!, `${cols.join(", ")}|${m[3] ?? ""}`);
  }
  return out;
}

function fromMikro(files: Map<string, string>): UniqueSet {
  const out: UniqueSet = new Map();
  const entities = [...files.entries()].find(([p]) => p.endsWith("/db/entities.ts"))?.[1] ?? "";
  for (const m of entities.matchAll(/\{ name: "([a-z_]+)", properties: \[([^\]]*)\] \}/g)) {
    const cols = m[2]!.split(",").map((c) => snake(JSON.parse(c.trim()) as string));
    out.set(m[1]!, `${cols.join(", ")}|`);
  }
  for (const m of entities.matchAll(/\{ name: "([a-z_]+)", expression: ("(?:[^"\\]|\\.)*") \}/g)) {
    const ddl = JSON.parse(m[2]!) as string;
    const parts = /\("?([^)]*)"?\) where (.+)$/.exec(ddl);
    out.set(m[1]!, `${(parts?.[1] ?? "").replace(/"/g, "")}|${parts?.[2] ?? ""}`);
  }
  return out;
}

function snake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

const sorted = (m: UniqueSet): [string, string][] => [...m.entries()].sort();

describe("node — every `unique (...)` index the migration declares is in the ORM schema", () => {
  it("the migration carries all four shapes (so an empty match cannot agree)", async () => {
    const mig = fromMigrations(await generateSystemFiles(model("")));
    expect(sorted(mig)).toEqual([
      ["animals_tag_uq", "tag|"],
      ["listings_sku_region_uq", "sku, region|"],
      ["members_email_uq", "email|"],
      ["venues_handle_uq", "handle|is_deleted = false"],
    ]);
  });

  it("drizzle: the schema object declares the same unique indexes", async () => {
    const files = await generateSystemFiles(model(""));
    expect(sorted(fromDrizzle(files))).toEqual(sorted(fromMigrations(files)));
  });

  it("mikroorm: the EntitySchema metadata declares the same unique indexes", async () => {
    // A mikroorm project ships no migration files (its schema IS the
    // metadata), so the reference is the same model's MigrationsIR as the
    // drizzle project renders it.
    const reference = fromMigrations(await generateSystemFiles(model("")));
    const files = await generateSystemFiles(model(" { persistence: mikroorm }"));
    expect(sorted(fromMikro(files))).toEqual(sorted(reference));
  });
});
