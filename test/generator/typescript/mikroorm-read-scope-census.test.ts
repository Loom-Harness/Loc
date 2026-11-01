// The node/MikroORM read paths take every read restriction from ONE IR fact —
// `readScopeFor` (`src/ir/enrich/read-scope.ts`) — and declare it ONCE, on the
// entity schemas, as named default filters (`mikroorm-schema-filters.ts`).
// MikroORM then applies it to every `find` / `findOne` / `count` /
// `nativeUpdate` / `nativeDelete`, and scopes a TPH concrete's queries to its
// `kind` by its Row class, so no read site ANDs a `kind` or a filter in by hand.
// The guarantee that none does — and that none forgets one — is a census:
//
//   1. SOURCE census — no MikroORM emitter reads the raw `contextFilters*`
//      arrays, calls `readScopeFor`, or spells a `{ kind: … }` conjunct, except
//      the one schema-filter renderer; `discriminatorValue` is read only where
//      a discriminator is DECLARED or STAMPED (the map, the insert payload).
//   2. EMISSION census — over fixtures that exercise TPH, TPC, embedded,
//      tenancy, `ignoring` and a TPH-sourced projection, no generated read or
//      native write names `kind`, the tenant scope or the soft-delete scope, and a TPH
//      concrete's reads go through its own Row, never its root's.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";
import { corpusSourceFor } from "../../fixtures/corpus/harness.js";

const ROOT = path.resolve(__dirname, "../../..");
const EMIT = "src/generator/typescript/emit";

/** Source with comments blanked, so prose that NAMES a forbidden symbol
 *  (explaining why it is not read) does not trip the census. */
function code(rel: string): string {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Every MikroORM emitter (globbed, so a new one is covered the day it lands)
 *  plus the query-time projection routes' mikro arm and the TPH base reader. */
function mikroSources(): string[] {
  return [
    ...fs
      .readdirSync(path.join(ROOT, EMIT))
      .filter((f) => /^mikroorm.*\.ts$/.test(f))
      .map((f) => `${EMIT}/${f}`),
    "src/generator/typescript/base-reader-builder.ts",
    PROJECTION_ROUTES,
  ].sort();
}

const PROJECTION_ROUTES = "src/platform/hono/v4/projection-query-routes-builder.ts";

/** The one module that renders a read restriction. */
const RENDERER = `${EMIT}/mikroorm-schema-filters.ts`;

const FORBIDDEN: { what: string; re: RegExp; allow?: readonly string[] }[] = [
  { what: "a raw read of the filter arrays", re: /\.contextFilter(s|Origins|Refs)\b/ },
  {
    what: "a second derivation of the read scope",
    re: /\b(readScopeFor|allContextFilterEntries)\s*\(/,
    // The projection routes file is shared with the drizzle arm, which spells
    // its scope in SQL; its mikro arm is covered by the emission census.
    allow: [RENDERER, PROJECTION_ROUTES],
  },
  // An interpolated discriminator is a conjunct spelled by hand (the TS type
  // `{ kind: "binary" }` is not).
  { what: "a hand-written `{ kind: … }` conjunct", re: /\{\s*kind:\s*\$\{/, allow: [RENDERER] },
  {
    what: "a hand-derived principal-filter test",
    re: /\baggregateUsesPrincipalContextFilter\s*\(/,
    // `shape: document` has no queryable columns: the scope is evaluated in the
    // app over the loaded aggregate, with the principal bound once.
    allow: [`${EMIT}/mikroorm-document.ts`],
  },
  {
    what: "the removed per-read filter composition",
    re: /\b(withContextFilters|mikroContextFilters)\b/,
  },
  {
    what: "a discriminator derived outside its declaration / stamp",
    re: /\bdiscriminatorValue\s*\(/,
    allow: [
      RENDERER,
      // The discriminatorMap of the root schema.
      `${EMIT}/mikroorm-entities.ts`,
      // The `kind` stamped on an INSERT / upsert (a native insert does not set it).
      `${EMIT}/mikroorm-relational.ts`,
    ],
  },
];

describe("mikroorm read-scope census — source", () => {
  it("covers the repository emitters, the schema filters and the projection routes", () => {
    const files = mikroSources();
    expect(files).toContain(`${EMIT}/mikroorm-relational.ts`);
    expect(files).toContain(`${EMIT}/mikroorm-embedded.ts`);
    expect(files).toContain(`${EMIT}/mikroorm-document.ts`);
    expect(files).toContain(RENDERER);
    expect(files.length).toBeGreaterThan(8);
  });

  it.each(mikroSources())("%s re-derives no read restriction", (rel) => {
    const src = code(rel);
    const hits = FORBIDDEN.filter(({ allow }) => !allow?.includes(rel)).flatMap(({ what, re }) =>
      src
        .split("\n")
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => re.test(l))
        .map(({ l, i }) => `${rel}:${i + 1} ${what}: ${l.trim()}`),
    );
    expect(hits).toEqual([]);
  });

  it("does not claim MikroORM has no global query filter", () => {
    for (const rel of mikroSources()) {
      const raw = fs.readFileSync(path.join(ROOT, rel), "utf8");
      expect(raw, rel).not.toMatch(/MikroORM has no global (query )?filter/i);
    }
  });
});

/** Fixtures whose mikro output covers every read shape: TPH concretes, a TPC
 *  hierarchy, `shape: embedded`, tenancy stances, `ignoring` and a TPH-sourced
 *  query-time projection. */
const FIXTURES = [
  "tph",
  "tph-crossings",
  "inheritance-read-restrictions",
  "inheritance-base-reads",
  "embedded",
  "principal-read-filter",
  "tenancy-hierarchy",
  "projection-tph-source",
  "find-bypass",
];

/** A call that reads rows or writes them natively: the surfaces MikroORM
 *  filters.  (`em.insert` / `em.upsert` are not filtered, and are where the
 *  discriminator is stamped.) */
const SCOPED_CALL =
  /\b(?:em|db|this\.em\.fork\([^)]*\))\.(?:find|findOne|count|nativeUpdate|nativeDelete)\(|createQueryBuilder\(/;

describe("mikroorm read-scope census — emitted reads", () => {
  it.each(FIXTURES)("%s: no read or native write spells the scope by hand", async (feature) => {
    const files = await generateSystemFiles(corpusSourceFor(feature, "node", "mikroorm"));
    const hits: string[] = [];
    let scoped = 0;
    for (const [p, src] of files) {
      if (!/\/(db\/repositories|http)\/[^/]+\.ts$/.test(p)) continue;
      for (const line of src.split("\n")) {
        if (!SCOPED_CALL.test(line)) continue;
        scoped++;
        const at = `${p}: ${line.trim()}`;
        if (/\bkind\b/.test(line)) hits.push(`names the discriminator — ${at}`);
        // The write-scope pre-guard (`inScope`) is the one explicit scope: a write
        // narrower than the read scope is not a filter the read applies.
        if (!line.includes("inScope")) {
          if (/\btenantId: requireCurrentUser\(\)/.test(line))
            hits.push(`spells the tenant scope — ${at}`);
          if (/\bisDeleted: false\b/.test(line)) hits.push(`spells the soft-delete scope — ${at}`);
        }
      }
    }
    expect(scoped, `${feature} emits reads`).toBeGreaterThan(0);
    expect(hits).toEqual([]);
  });

  it("a TPH concrete's repository never reads through its root's Row unfiltered", async () => {
    const files = await generateSystemFiles(
      corpusSourceFor("inheritance-read-restrictions", "node", "mikroorm"),
    );
    for (const [p, src] of files) {
      if (!/db\/repositories\/(car|truck)-repository\.ts$/.test(p)) continue;
      const offenders = src
        .split("\n")
        .filter(
          (l) => SCOPED_CALL.test(l) && /\(VehicleRow\b/.test(l) && !l.includes("filters: false"),
        );
      expect(offenders, p).toEqual([]);
    }
  });
});
