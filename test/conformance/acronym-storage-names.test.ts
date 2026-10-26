import { describe, expect, it } from "vitest";
import { BACKENDS, type Backend } from "../fixtures/corpus/backends.js";
import { generateCorpusCase } from "../fixtures/corpus/harness.js";

// ---------------------------------------------------------------------------
// The table a migration creates is the table the ORM reads, and the route a
// backend mounts is the route its clients call — for names that end in an
// acronym, where the two orders of `snake` and `plural` disagree
// (`ProductSKU` → `product_skus` vs `product_sk_us`).
//
// THE ASSERTION IS AN AGREEMENT between two emitters: the table names are read
// out of the migration DDL (the shared `MigrationsIR` render) and, separately,
// out of each backend's ORM mapping, and every mapped table must be one the
// migration created.  Neither side's spelling is taken from the code under
// test.  The expected set is the fixture's answer key, so a backend that maps
// NOTHING fails the vacuity guard rather than passing an empty subset.
//
// Every persistence adapter with its own mapping is swept: drizzle and
// mikroorm (node), EF and Dapper (.NET), SQLAlchemy, JPA, Ecto.
// ---------------------------------------------------------------------------

const FIXTURE = "acronym-names";

/** The tables the fixture's declarations own — the answer key. */
const EXPECTED_TABLES = [
  "catalog_skus", // TPH base, shared by PhysicalSKU / DigitalSKU
  "http_logs",
  "product_sku_aliases", // `aliases: URLAlias id[]` join table
  "product_skus",
  "restock_skus", // workflow state
  "stock_per_skus", // folded projection
  "url_aliases",
  "variant_skus", // entity part
];

/** Each mapped table must appear in this set; the ORM's own spelling. */
const ORM_TABLE: Record<string, { file: RegExp; table: RegExp }> = {
  drizzle: { file: /\/db\/schema\.ts$/, table: /\.table\(\s*"([a-z_]+)"/g },
  mikroorm: { file: /\.ts$/, table: /tableName: "([a-z_]+)"/g },
  efcore: { file: /\.cs$/, table: /ToTable\("([a-z_]+)"/g },
  dapper: { file: /Repository\.cs$/, table: /\b(?:FROM|INTO|UPDATE|JOIN) \\?"?([a-z_]+)\b/g },
  python: { file: /\/app\/db\/schema\.py$/, table: /__tablename__ = "([a-z_]+)"/g },
  java: { file: /\.java$/, table: /@Table\(name = "([a-z_]+)"/g },
  vanilla: { file: /\.ex$/, table: /\bschema "([a-z_]+)"/g },
};

const CELLS: { backend: Backend; persistence?: string; orm: keyof typeof ORM_TABLE }[] = [
  { backend: "node", orm: "drizzle" },
  { backend: "node", persistence: "mikroorm", orm: "mikroorm" },
  { backend: "dotnet", orm: "efcore" },
  { backend: "dotnet", persistence: "dapper", orm: "dapper" },
  { backend: "python", orm: "python" },
  { backend: "java", orm: "java" },
  { backend: "vanilla", orm: "vanilla" },
];

function migrationTables(files: Map<string, string>): Set<string> {
  const out = new Set<string>();
  for (const [p, content] of files) {
    if (!/migration/i.test(p)) continue;

    for (const m of content.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"*(?:\w+"*\.)?"*(\w+)/gi)) {
      out.add(m[1]!);
    }
    // Ecto: `create table(:product_skus, prefix: "catalog")`.
    for (const m of content.matchAll(/create(?:_if_not_exists)? table\(:(\w+)/g)) out.add(m[1]!);
  }
  out.delete("__loom_migrations");
  return out;
}

describe("acronym-named declarations: one table name, one route segment", () => {
  for (const { backend, persistence, orm } of CELLS) {
    const label = persistence ? `${backend}/${persistence}` : backend;

    it(`${label}: every table the ORM maps is one the migration created`, async () => {
      const files = await generateCorpusCase(FIXTURE, backend, persistence);
      // mikroorm emits no migration of its own (it builds the schema from the
      // entity metadata), so its mapping is held to the shared MigrationsIR
      // render, read off the default node cell.
      const own = migrationTables(files);
      const created =
        own.size > 0 ? own : migrationTables(await generateCorpusCase(FIXTURE, "node"));
      for (const t of EXPECTED_TABLES) expect(created, `migration creates ${t}`).toContain(t);

      const { file, table } = ORM_TABLE[orm]!;
      const mapped = new Set<string>();
      for (const [p, content] of files) {
        if (!file.test(p)) continue;
        for (const m of content.matchAll(table)) mapped.add(m[1]!);
      }
      // Vacuity guard: the ORM maps the acronym-named root, part and TPH base.
      for (const t of ["product_skus", "variant_skus", "catalog_skus"]) {
        expect([...mapped], `${label} maps ${t}`).toContain(t);
      }
      const unknown = [...mapped].filter((t) => !created.has(t));
      expect(unknown, `${label} maps tables the migration never created`).toEqual([]);
    });

    it(`${label}: no emitted file spells the split-acronym form`, async () => {
      const files = await generateCorpusCase(FIXTURE, backend, persistence);
      const hits = [...files]
        .filter(([, c]) => /sk_us\b/i.test(c))
        .map(([p, c]) => `${p}: ${c.match(/.*sk_us\b.*/i)![0].trim()}`);
      expect(hits).toEqual([]);
    });
  }

  /** Where each backend mounts an aggregate's routes, and how it spells the
   *  mount — read from the router, not from a shared constant. */
  const ROUTE_MOUNT: Record<Backend, { file: RegExp; mount: RegExp }> = {
    node: { file: /\/http\/index\.ts$/, mount: /app\.route\("\/api\/(\w+)"/g },
    dotnet: { file: /Controller\.cs$/, mount: /\[Route\("api\/(\w+)"\)\]/g },
    java: { file: /Controller\.java$/, mount: /@RequestMapping\("\/api\/(\w+)"\)/g },
    python: { file: /_routes\.py$/, mount: /APIRouter\(prefix="\/(\w+)"/g },
    vanilla: { file: /router\.ex$/, mount: /get "\/(\w+)", \w+Controller, :index/g },
  };

  it("every backend mounts each aggregate under the route segment the e2e client calls", async () => {
    for (const backend of BACKENDS) {
      const files = await generateCorpusCase(FIXTURE, backend);
      const { file, mount } = ROUTE_MOUNT[backend];
      const mounted = new Set<string>();
      for (const [p, content] of files) {
        if (!file.test(p)) continue;
        for (const m of content.matchAll(mount)) mounted.add(m[1]!);
      }
      // The e2e client is emitted by a different module (src/system/e2e-render.ts).
      const e2e = [...files].find(([p]) => p.endsWith(".e2e.test.ts"))?.[1] ?? "";
      for (const seg of [
        "product_skus",
        "physical_skus",
        "digital_skus",
        "http_logs",
        "url_aliases",
      ]) {
        expect([...mounted], `${backend} mounts /${seg}`).toContain(seg);
        expect(e2e, `the e2e client calls /${seg}`).toContain(`/${seg}`);
      }
    }
  });
});
