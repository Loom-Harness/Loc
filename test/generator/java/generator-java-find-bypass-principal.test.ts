// ---------------------------------------------------------------------------
// Java backend — a repository `find … ignoring <Cap>` / `ignoring *` drops the
// PRINCIPAL (tenancy) conjunct too, on BOTH java read surfaces (M-T6.54 F18).
//
// Java installs a non-principal capability filter as a Hibernate named @Filter
// (`generator-java-filter-bypass.test.ts` covers that triage).  A PRINCIPAL
// filter has no static form, so it is AND-ed into each read at request time:
//
//   * relational — a SpEL conjunct inside the Spring Data `@Query` JPQL
//     (`emit/repository.ts`'s `jpqlWhere` / `principalJpqlClause`), and
//   * document   — an in-app predicate over the rehydrated jsonb blob
//     (`emit/document-store.ts`), which every declared find used to inherit
//     from the SHARED `findAll()`.
//
// Neither honoured the read's own `ignoring` clause: `find … ignoring
// tenantOwned` still returned only the caller's tenant, with no diagnostic,
// while `FILTER_BYPASS_FAMILIES` certifies java as honouring the clause.
//
// EVERY assertion here is paired presence + ABSENCE.  The failure mode is a
// RETAINED conjunct, which a presence-only assertion cannot see — that is
// precisely how this survived the existing bypass suite.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { corpusSourceFor } from "../../fixtures/corpus/harness.js";

const SRC = corpusSourceFor("find-bypass", "java");
const ROOT = "d/src/main/java/com/loom/d/features";

/** The `@Query(...)` JPQL string of one Spring Data method, by method name. */
function jpqlOf(jpaRepo: string, method: string): string {
  const m = new RegExp(`@Query\\("([^"]*)"\\)\\s*\\n[^\\n]*\\b${method}\\(`).exec(jpaRepo);
  if (!m) throw new Error(`no @Query found for ${method}`);
  return m[1]!;
}

/** One method body of the document repository impl, by method name. */
function bodyOf(impl: string, method: string): string {
  const start = impl.indexOf(` ${method}(`);
  if (start < 0) throw new Error(`no method ${method}`);
  const end = impl.indexOf("\n    }", start);
  return impl.slice(start, end);
}

const TENANT_JPQL = "e.tenantId = :#{@currentUserAccessor.user()?.tenantId()}";
const TENANT_INAPP = "Objects.equals(x.tenantId(), currentUser.tenantId())";
const DELETED_INAPP = "!x.isDeleted()";

describe("java — `find … ignoring` drops the principal conjunct (M-T6.54 F18)", () => {
  describe("relational read surface (@Query JPQL)", () => {
    it("a find with NO `ignoring` keeps the tenant conjunct", async () => {
      const jpa = (await generateSystemFiles(SRC)).get(`${ROOT}/orders/OrderJpaRepository.java`)!;
      const q = jpqlOf(jpa, "scoped");
      expect(q).toContain("e.code = :c");
      expect(q).toContain(TENANT_JPQL);
    });

    it("`ignoring tenantOwned` drops the tenant conjunct and keeps the find's own filter", async () => {
      const jpa = (await generateSystemFiles(SRC)).get(`${ROOT}/orders/OrderJpaRepository.java`)!;
      const q = jpqlOf(jpa, "anyTenant");
      expect(q).toContain("e.code = :c");
      // THE assertion: the conjunct is GONE, not merely "the filter is present".
      expect(q).not.toContain("tenantId");
      expect(q).not.toContain("currentUserAccessor");
    });

    it("`ignoring *` drops the tenant conjunct too", async () => {
      const jpa = (await generateSystemFiles(SRC)).get(`${ROOT}/orders/OrderJpaRepository.java`)!;
      const q = jpqlOf(jpa, "unfiltered");
      expect(q).toContain("e.code = :c");
      expect(q).not.toContain("tenantId");
    });

    it("the root findAll / findById overrides keep the tenant conjunct regardless", async () => {
      const jpa = (await generateSystemFiles(SRC)).get(`${ROOT}/orders/OrderJpaRepository.java`)!;
      expect(jpqlOf(jpa, "findAll")).toContain(TENANT_JPQL);
      expect(jpqlOf(jpa, "findById")).toContain(TENANT_JPQL);
    });
  });

  describe("document read surface (in-app predicate over the rehydrated blob)", () => {
    it("a find with NO `ignoring` keeps BOTH conjuncts", async () => {
      const impl = (await generateSystemFiles(SRC)).get(`${ROOT}/notes/NoteRepositoryImpl.java`)!;
      const body = bodyOf(impl, "scopedNote");
      expect(body).toContain(TENANT_INAPP);
      expect(body).toContain(DELETED_INAPP);
    });

    it("`ignoring tenantOwned` drops ONLY the tenant conjunct", async () => {
      const impl = (await generateSystemFiles(SRC)).get(`${ROOT}/notes/NoteRepositoryImpl.java`)!;
      const body = bodyOf(impl, "anyTenantNote");
      expect(body).toContain(DELETED_INAPP);
      expect(body).not.toContain("tenantId");
      expect(body).not.toContain("currentUser");
    });

    it("`ignoring *` drops both conjuncts", async () => {
      const impl = (await generateSystemFiles(SRC)).get(`${ROOT}/notes/NoteRepositoryImpl.java`)!;
      const body = bodyOf(impl, "unfilteredNote");
      expect(body).not.toContain("tenantId");
      expect(body).not.toContain("isDeleted");
    });

    // The fail-OPEN direction.  `findAll()` is the root LIST route's only
    // source; it carries no `ignoring` clause of its own, so no bypass on any
    // OTHER find may widen it.  The previous emission hoisted the bypassable
    // predicates OUT of `findAll()` and re-applied them per find, which made a
    // soft-deleted / cross-tenant row visible through `GET /notes`.
    it("findAll() applies BOTH conjuncts even though two finds bypass them", async () => {
      const impl = (await generateSystemFiles(SRC)).get(`${ROOT}/notes/NoteRepositoryImpl.java`)!;
      const body = bodyOf(impl, "findAll");
      expect(body).toContain(TENANT_INAPP);
      expect(body).toContain(DELETED_INAPP);
      // …off an UNFILTERED rehydrate, which is what a bypassing find streams.
      expect(impl).toContain("private List<Note> rehydrateAll()");
      expect(bodyOf(impl, "rehydrateAll")).not.toContain("isDeleted");
      expect(bodyOf(impl, "rehydrateAll")).not.toContain("tenantId");
    });

    it("findById() applies BOTH conjuncts", async () => {
      const impl = (await generateSystemFiles(SRC)).get(`${ROOT}/notes/NoteRepositoryImpl.java`)!;
      const body = bodyOf(impl, "findById");
      expect(body).toContain("Objects.equals(rec.tenantId(), currentUser.tenantId())");
      expect(body).toContain("!rec.isDeleted()");
    });
  });
});
