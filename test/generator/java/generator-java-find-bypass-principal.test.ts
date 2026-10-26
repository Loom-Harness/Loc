// ---------------------------------------------------------------------------
// Java backend — a repository `find … ignoring <Cap>` / `ignoring *` drops the
// PRINCIPAL (tenancy) conjunct too, on BOTH java read surfaces (M-T6.54 F18).
//
// Java installs every capability filter — the principal (tenancy) one too —
// as an auto-enabled Hibernate named @Filter on the entity, and the document
// shape (no entity) as an in-app predicate over the rehydrated jsonb blob:
//
//   * relational — a bypassing read's impl method `disableFilter`s exactly the
//     filters its `ignoring` names (`emit/repository.ts`'s `wrapBypass`), and
//   * document   — an in-app predicate (`emit/document-store.ts`), which every
//     declared find used to inherit from the SHARED `findAll()`.
//
// Neither honoured the read's own `ignoring` clause: `find … ignoring
// tenantOwned` still returned only the caller's tenant, with no diagnostic,
// while the validator certified java as honouring the clause.
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

const TENANT_INAPP = "Objects.equals(x.tenantId(), currentUser.tenantId())";
const DELETED_INAPP = "!x.isDeleted()";

describe("java — `find … ignoring` drops the principal conjunct (M-T6.54 F18)", () => {
  describe("relational read surface (entity @Filter, disabled per read)", () => {
    const impl = async (): Promise<string> =>
      (await generateSystemFiles(SRC)).get(`${ROOT}/orders/OrderRepositoryImpl.java`)!;

    it("the tenant restriction is the entity's filter, in no @Query", async () => {
      const files = await generateSystemFiles(SRC);
      expect(files.get(`${ROOT}/orders/Order.java`)!).toContain(
        '@Filter(name = "Order_tenantOwned", condition = "tenant_id = :__cuTenantId")',
      );
      const jpa = files.get(`${ROOT}/orders/OrderJpaRepository.java`)!;
      expect(jpqlOf(jpa, "scoped")).toBe("select e from Order e where e.code = :c");
      expect(jpa).not.toMatch(/tenantId|currentUserAccessor/);
    });

    it("a find with NO `ignoring` disables nothing", async () => {
      expect(bodyOf(await impl(), "scoped")).not.toContain("disableFilter");
    });

    it("`ignoring tenantOwned` disables ONLY the tenant filter", async () => {
      const body = bodyOf(await impl(), "anyTenant");
      expect(body).toContain('__session.disableFilter("Order_tenantOwned");');
      expect(body).not.toContain('disableFilter("softDeletable")');
    });

    it("`ignoring *` disables the tenant filter too", async () => {
      const body = bodyOf(await impl(), "unfiltered");
      expect(body).toContain('__session.disableFilter("Order_tenantOwned");');
      expect(body).toContain('__session.disableFilter("softDeletable");');
    });

    it("the root findAll / findById disable nothing", async () => {
      const i = await impl();
      expect(bodyOf(i, "findAll")).not.toContain("disableFilter");
      expect(bodyOf(i, "findById")).not.toContain("disableFilter");
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
