import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";
import { BACKENDS, type Backend } from "../fixtures/corpus/backends.js";
import { generateCorpusCase } from "../fixtures/corpus/harness.js";

// ---------------------------------------------------------------------------
// Every table a backend's ORM maps is a table its migration created, for
// every corpus feature on every backend.
//
// The acronym fixture (`acronym-storage-names.test.ts`) pins the one spelling
// trap — `plural(snake(n))` vs `snake(plural(n))` — on every persistence
// adapter.  This sweep is its breadth twin: the same agreement, read the same
// way (the migration DDL on one side, the ORM mapping on the other, neither
// taken from the code under test), over the whole corpus on each backend's
// default adapter.  A backend that picks the wrong declaration to spell a
// table from (a TPH concrete's own name instead of its root's, a projection
// source instead of its table owner) maps a table nothing created, and fails
// here on the feature that reaches it.
// ---------------------------------------------------------------------------

const CORPUS_DIR = join(import.meta.dirname, "..", "fixtures", "corpus");
const FEATURES = readdirSync(CORPUS_DIR)
  .filter((f) => f.endsWith(".ddd"))
  .map((f) => f.slice(0, -".ddd".length))
  .sort();

/** Each default adapter's own spelling of a mapped table. */
const ORM_TABLE: Record<Backend, { file: RegExp; table: RegExp }> = {
  node: { file: /\/db\/schema\.ts$/, table: /(?:pgTable|\.table)\(\s*"([a-z0-9_]+)"/g },
  dotnet: { file: /\.cs$/, table: /ToTable\("([a-z0-9_]+)"/g },
  python: { file: /\/app\/db\/schema\.py$/, table: /__tablename__ = "([a-z0-9_]+)"/g },
  java: { file: /\.java$/, table: /@Table\(name = "([a-z0-9_]+)"/g },
  vanilla: { file: /\.ex$/, table: /\bschema "([a-z0-9_]+)"/g },
};

/** Known disagreements, per backend and feature, each naming its owning issue.
 *  It ratchets: a feature that now agrees fails until its entry is deleted. */
const KNOWN: Partial<Record<Backend, { issue: string; features: readonly string[] }>> = {
  // drizzle declares a table for every projection, query-time included.
  node: {
    issue: "#4674",
    features: [
      "datetime-wire",
      "inheritance-base-reads",
      "projection-agg-filters",
      "projection-aggregation",
      "projection-document-aggregation",
      "projection-groupby",
      "projection-join",
      "projection-params",
      "projection-split-deployables",
      "projection-tph-source",
      "read-gates",
    ],
  },
};

function migrationTables(files: Map<string, string>): Set<string> {
  const out = new Set<string>();
  for (const [p, content] of files) {
    if (!/migration/i.test(p)) continue;
    for (const m of content.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"*(?:\w+"*\.)?"*(\w+)/gi)) {
      out.add(m[1]!);
    }
    // Ecto: `create table(:product_skus, prefix: "catalog")`.
    for (const m of content.matchAll(/create(?:_if_not_exists)? table\(:(\w+)/g)) out.add(m[1]!);
    // A rename moves a table the chain created earlier under its new name.
    for (const m of content.matchAll(/ALTER TABLE (?:"*\w+"*\.)?"*\w+"* RENAME TO "*(\w+)/gi)) {
      out.add(m[1]!);
    }
    for (const m of content.matchAll(/rename table\(:\w+(?:, [^)]*)?\), to: table\(:(\w+)/g)) {
      out.add(m[1]!);
    }
  }
  return out;
}

describe("corpus-wide: the ORM maps only tables the migration created", () => {
  it("reaches the corpus", () => {
    expectReach("corpus features", FEATURES.length, 130);
  });

  for (const backend of BACKENDS) {
    it(`${backend}: every mapped table exists in the migration`, async () => {
      const { file, table } = ORM_TABLE[backend];
      const problems: string[] = [];
      const disagreeing = new Set<string>();
      let mappedTotal = 0;
      let generated = 0;
      for (const feature of FEATURES) {
        let files: Map<string, string>;
        try {
          files = await generateCorpusCase(feature, backend);
        } catch {
          // A feature that does not generate on this backend is the corpus
          // generation gate's business, not this agreement's.
          continue;
        }
        generated++;
        const created = migrationTables(files);
        const mapped = new Set<string>();
        for (const [p, content] of files) {
          if (!file.test(p)) continue;
          for (const m of content.matchAll(table)) mapped.add(m[1]!);
        }
        mappedTotal += mapped.size;
        const unknown = [...mapped].filter((t) => !created.has(t));
        if (unknown.length === 0) continue;
        disagreeing.add(feature);
        if (!KNOWN[backend]?.features.includes(feature)) {
          problems.push(`${feature}: ${unknown.join(", ")}`);
        }
      }
      for (const feature of KNOWN[backend]?.features ?? []) {
        if (!disagreeing.has(feature)) {
          problems.push(`${feature}: agrees now — delete it from KNOWN (${KNOWN[backend]?.issue})`);
        }
      }
      // Vacuity guard: the sweep generated the corpus and read real mappings.
      expectReach(`${backend} generated features`, generated, 130);
      expectReach(`${backend} mapped tables`, mappedTotal, 100);
      expect(problems, `${backend} maps tables the migration never created`).toEqual([]);
    }, 600_000);
  }
});
