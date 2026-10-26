// ---------------------------------------------------------------------------
// Census — no generated JPQL names a read restriction.
//
// Every read restriction of a relational java aggregate is an entity-level
// Hibernate hook: the never-bypassed ones `@SQLRestriction`, the rest
// auto-enabled `@Filter`s (tenancy's claims resolved per query by
// `@ParamDef` resolvers), all hosted on the TPH root for a hierarchy, and the
// TPH discriminator is JPA's own `@DiscriminatorValue`.  Hibernate applies them
// to every query of the entity — so a hand-written tenant, data-key or `kind`
// predicate in a `@Query` or an `EntityManager.createQuery` string is either
// redundant or, worse, the only thing scoping that one query while the
// entity's other reads go unscoped (the shape every past java tenancy leak
// had: an inherited `findAllById`, `existsById`, a projection aggregation).
//
// Native SQL over a `shape: document` table is out of scope: it has no entity
// and so no filter, and spells the tenant predicate itself.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { corpusSourceFor } from "../../fixtures/corpus/harness.js";
import { CORPUS } from "../../fixtures/corpus/manifest.js";

/** Every corpus fixture with a read restriction or an inheritance hierarchy. */
const FIXTURES = [
  "audit-history-guarded",
  "criterion-filter",
  "find-bypass",
  "inheritance-base-reads",
  "inheritance-read-restrictions",
  "inheritance",
  "org-context",
  "policy-deny",
  "policy-document",
  "prefix-filter",
  "projection-agg-filters",
  "projection-tph-source",
  "read-gates",
  "scaffold-macros",
  "tenancy-claim-name",
  "tenancy-filter",
  "tenancy-hierarchy",
  "tenancy-owned",
  "tph-crossings",
  "tph",
  "vo-cross-context",
].filter((id) => CORPUS.find((f) => f.id === id)?.backends.includes("java"));

/** A tenancy or TPH restriction spelled in JPQL: the tenant / data-key
 *  columns, a read of the tenancy claims (SpEL or a bound `__cu…` parameter —
 *  `tenantIdAsUuid` is the registry self-scope's), or the TPH discriminator.
 *  A find's OWN `where` over another claim (`this.owner == currentUser.id`)
 *  is the read's predicate, not a restriction, and stays in its query. */
const RESTRICTION_IN_JPQL =
  /\be\.(?:tenantId|dataKey)\b|currentUserAccessor\.user\(\)\?\.(?:tenantId|orgPath)|:__cu(?:Subtree)?(?:TenantId|OrgPath)|\bkind\b|\btype\(e\)/;

/** Every JPQL string the emitted java hands Hibernate: `@Query("…")` and
 *  `createQuery("…")` (not `createNativeQuery`). */
function jpqlStrings(src: string): string[] {
  return [...src.matchAll(/(?:@Query|[^e]createQuery)\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!);
}

/** Every `file: jpql` that names a read restriction. */
function restrictionLeaks(files: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  for (const [path, src] of files) {
    if (!path.endsWith(".java")) continue;
    for (const q of jpqlStrings(src)) {
      if (RESTRICTION_IN_JPQL.test(q)) out.push(`${path.split("/").pop()}: ${q}`);
    }
  }
  return out;
}

describe("java census — no JPQL string names a read restriction", () => {
  it("vacuity: the census reads the fixtures it names", () => {
    expect(FIXTURES.length).toBeGreaterThan(15);
  });

  it.each(FIXTURES)("%s", async (id) => {
    const files = await generateSystemFiles(corpusSourceFor(id, "java"));
    const queries = [...files.values()].flatMap(jpqlStrings);
    expect(queries.length, "vacuity: the fixture emits JPQL").toBeGreaterThan(0);
    expect(restrictionLeaks(files)).toEqual([]);
  });
});
