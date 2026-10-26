// The node/drizzle read paths take every read restriction from ONE IR fact —
// `readScopeFor` (`src/ir/enrich/read-scope.ts`) — and every aggregate read
// with no declared order is ordered by `id`.
//
// Drizzle has no global query filter, so every read site ANDs the `kind` scope
// and the filters in by hand.  The guarantee that no site forgets one, or
// re-derives one differently, is that no drizzle source reads the raw IR arrays
// the fact is derived from:
//
//   1. SOURCE census — no drizzle emitter reads `contextFilters` /
//      `contextFilterOrigins` / `contextFilterRefs`, calls `discriminatorValue`
//      or `aggregateUsesPrincipalContextFilter`, or spells the `kind` equality
//      anywhere but the one adapter (`drizzleDiscriminatorEq`).
//   2. EMISSION census — over fixtures that exercise TPH, embedded, document,
//      retrieval and tenancy reads, every root-table read in a generated
//      repository that is not a by-id lookup carries an `.orderBy(`.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";
import { corpusSourceFor } from "../../fixtures/corpus/harness.js";

const ROOT = path.resolve(__dirname, "../../..");

/** Every drizzle-side emitter that renders an aggregate read: the repository
 *  builders (globbed, so a new one is covered the day it lands) and the
 *  query-time projection routes' drizzle arm. */
function drizzleSources(): string[] {
  const dir = "src/generator/typescript";
  const repoBuilders = fs
    .readdirSync(path.join(ROOT, dir))
    .filter((f) => /^repository-.*\.ts$/.test(f))
    .map((f) => `${dir}/${f}`);
  return [
    ...repoBuilders,
    `${dir}/base-reader-builder.ts`,
    "src/platform/hono/v4/projection-query-routes-builder.ts",
  ].sort();
}

/** Source with comments blanked, so prose that NAMES a forbidden symbol
 *  (explaining why it is not read) does not trip the census. */
function code(rel: string): string {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const FORBIDDEN: { what: string; re: RegExp }[] = [
  { what: "a raw read of the filter arrays", re: /\.contextFilter(s|Origins|Refs)\b/ },
  { what: "a hand-derived TPH discriminator", re: /\bdiscriminatorValue\s*\(/ },
  {
    what: "a hand-derived principal-filter test",
    re: /\baggregateUsesPrincipalContextFilter\s*\(/,
  },
  { what: "a second spelling of the `kind` equality", re: /\.kind,\s*\$\{JSON\.stringify/ },
];

/** The one sanctioned spelling of the `kind` equality. */
const KIND_ADAPTER = {
  file: "src/generator/typescript/repository-find-predicate.ts",
  fn: "drizzleDiscriminatorEq",
};

describe("drizzle read-scope census — source", () => {
  it("covers the repository builders and the projection routes", () => {
    const files = drizzleSources();
    expect(files).toContain("src/generator/typescript/repository-find-builder.ts");
    expect(files).toContain("src/generator/typescript/repository-embedded-builder.ts");
    expect(files).toContain("src/generator/typescript/repository-document-builder.ts");
    expect(files.length).toBeGreaterThan(8);
  });

  it.each(drizzleSources())("%s re-derives no read restriction", (rel) => {
    let src = code(rel);
    if (rel === KIND_ADAPTER.file) {
      // Blank the adapter's own body: it is the one place the equality is spelled.
      const start = src.indexOf(`export function ${KIND_ADAPTER.fn}(`);
      expect(start, `${KIND_ADAPTER.fn} is defined in ${rel}`).toBeGreaterThanOrEqual(0);
      const end = src.indexOf("\n}\n", start);
      src = src.slice(0, start) + src.slice(end);
    }
    const hits = FORBIDDEN.flatMap(({ what, re }) =>
      src
        .split("\n")
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => re.test(l))
        .map(({ l, i }) => `${rel}:${i + 1} ${what}: ${l.trim()}`),
    );
    expect(hits).toEqual([]);
  });
});

/** Fixtures whose node output covers every drizzle read shape: TPH concretes,
 *  `shape: embedded`, `shape: document`, retrievals, tenancy stances and a
 *  TPH-sourced query-time projection. */
const FIXTURES = [
  "tph",
  "embedded",
  "document",
  "principal-read-filter",
  "tenancy-hierarchy",
  "projection-tph-source",
  "find-bypass",
];

/** A root-table read in a generated repository: `this.db` / `tx` selecting
 *  whole rows.  A by-id lookup (one row by primary key) and a child-part load
 *  (keyed by `parentId`, ordered by its own `ordinal` where order matters) are
 *  not list reads. */
const ROOT_READ = /(?:this\.db|tx)\.select\(\)\.from\(schema\.\w+\)/;
const BY_ID = /\.id, id\)/;
const CHILD = /\.parentId,/;

describe("drizzle read-scope census — emitted order", () => {
  it.each(FIXTURES)("%s: every root list read is ordered", async (feature) => {
    const files = await generateSystemFiles(corpusSourceFor(feature, "node"));
    const unordered: string[] = [];
    let reads = 0;
    for (const [p, src] of files) {
      if (!/\/db\/repositories\/[^/]+\.ts$/.test(p)) continue;
      for (const line of src.split("\n")) {
        if (!ROOT_READ.test(line) || BY_ID.test(line) || CHILD.test(line)) continue;
        reads++;
        if (!line.includes(".orderBy(")) unordered.push(`${p}: ${line.trim()}`);
      }
    }
    expect(reads, `${feature} emits root list reads`).toBeGreaterThan(0);
    expect(unordered).toEqual([]);
  });
});
