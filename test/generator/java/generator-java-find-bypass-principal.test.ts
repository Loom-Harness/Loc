// ---------------------------------------------------------------------------
// Java backend — a criterion read `Repo.find(C) ignoring <Cap>` / `ignoring *`
// drops the PRINCIPAL (tenancy) conjunct too, on BOTH java read surfaces.
//
// Java installs every capability filter — the principal (tenancy) one too —
// as an auto-enabled Hibernate named @Filter on the entity, and the document
// shape (no entity) as an in-app predicate over the rehydrated jsonb blob:
//
//   * relational — a bypassing read's impl method `disableFilter`s exactly the
//     filters its `ignoring` names (`emit/repository.ts`'s `wrapBypass`), and
//   * document   — an in-app predicate (`emit/document-store.ts`): a bypassing
//     read streams an UNFILTERED rehydrate and re-applies only the conjuncts
//     its `ignoring` keeps, while the shared `findAll()` keeps them all.
//
// A retained conjunct is silent: `ignoring tenantOwned` that still returns only
// the caller's tenant raises no diagnostic.
//
// EVERY assertion here is paired presence + ABSENCE.  The failure mode is a
// RETAINED conjunct, which a presence-only assertion cannot see — that is
// precisely how this survived the existing bypass suite.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { corpusSourceFor } from "../../fixtures/corpus/harness.js";

/** The corpus fixture's relational `Order` reads, plus the same three read
 *  stances over its `shape: document` `Note`. */
const SRC = corpusSourceFor("find-bypass", "java").replace(
  "repository Notes for Note",
  `repository Notes for Note
      criterion NoteBody(b: string) of Note = this.body == b
      queryHandler GetScopedNote(b: string): Note {
        if let x = Notes.find(NoteBody(b)) { return x } else { notFound "not_found" }
      }
      queryHandler GetAnyTenantNote(b: string): Note {
        if let x = Notes.find(NoteBody(b)) ignoring tenantOwned { return x } else { notFound "not_found" }
      }
      queryHandler GetUnfilteredNote(b: string): Note {
        if let x = Notes.find(NoteBody(b)) ignoring * { return x } else { notFound "not_found" }
      }`,
);
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

const TENANT_INAPP = "Objects.equals(x.tenantId(), currentUser.operatingOrg())";
const DELETED_INAPP = "!x.isDeleted()";

describe("java — `find(C) … ignoring` drops the principal conjunct", () => {
  describe("relational read surface (entity @Filter, disabled per read)", () => {
    const impl = async (): Promise<string> =>
      (await generateSystemFiles(SRC)).get(`${ROOT}/orders/OrderRepositoryImpl.java`)!;

    it("the tenant restriction is the entity's filter, in no @Query", async () => {
      const files = await generateSystemFiles(SRC);
      expect(files.get(`${ROOT}/orders/Order.java`)!).toContain(
        '@Filter(name = "Order_tenantOwned", condition = "tenant_id = :__cuOperatingOrg")',
      );
      const jpa = files.get(`${ROOT}/orders/OrderJpaRepository.java`)!;
      expect(jpqlOf(jpa, "findFirstByCodeIgnoringTenantOwned")).toBe(
        "select e from Order e where e.code = :c order by e.id",
      );
      expect(jpa).not.toMatch(/tenantId|currentUserAccessor/);
      // The unwidened read is the reified criterion — no tenant term either.
      const crit = files.get("d/src/main/java/com/loom/d/domain/criteria/OrderCriteria.java")!;
      expect(crit).toContain("Scoped(String c)");
      expect(crit).not.toMatch(/tenantId|currentUserAccessor/);
    });

    it("a read with NO `ignoring` disables nothing", async () => {
      expect(bodyOf(await impl(), "runFindAllByScoped")).not.toContain("disableFilter");
    });

    it("`ignoring tenantOwned` disables ONLY the tenant filter", async () => {
      const body = bodyOf(await impl(), "findFirstByCodeIgnoringTenantOwned");
      expect(body).toContain('__session.disableFilter("Order_tenantOwned");');
      expect(body).not.toContain('disableFilter("softDeletable")');
    });

    it("`ignoring *` disables the tenant filter too", async () => {
      const body = bodyOf(await impl(), "findFirstByCodeIgnoringAll");
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
    it("a read with NO `ignoring` keeps BOTH conjuncts", async () => {
      const impl = (await generateSystemFiles(SRC)).get(`${ROOT}/notes/NoteRepositoryImpl.java`)!;
      const body = bodyOf(impl, "runFindAllByNoteBody");
      expect(body).toContain(TENANT_INAPP);
      expect(body).toContain(DELETED_INAPP);
    });

    it("`ignoring tenantOwned` drops ONLY the tenant conjunct", async () => {
      const impl = (await generateSystemFiles(SRC)).get(`${ROOT}/notes/NoteRepositoryImpl.java`)!;
      const body = bodyOf(impl, "findFirstNoteBodyIgnoringTenantOwned");
      expect(body).toContain(DELETED_INAPP);
      expect(body).not.toContain("tenantId");
      expect(body).not.toContain("currentUser");
    });

    it("`ignoring *` drops both conjuncts", async () => {
      const impl = (await generateSystemFiles(SRC)).get(`${ROOT}/notes/NoteRepositoryImpl.java`)!;
      const body = bodyOf(impl, "findFirstNoteBodyIgnoringAll");
      expect(body).not.toContain("tenantId");
      expect(body).not.toContain("isDeleted");
    });

    // The fail-OPEN direction.  `findAll()` is the root LIST route's only
    // source; it carries no `ignoring` clause of its own, so no bypass on any
    // OTHER read may widen it.  Hoisting the bypassable predicates OUT of
    // `findAll()` and re-applying them per read would make a soft-deleted /
    // cross-tenant row visible through `GET /notes`.
    it("findAll() applies BOTH conjuncts even though two reads bypass them", async () => {
      const impl = (await generateSystemFiles(SRC)).get(`${ROOT}/notes/NoteRepositoryImpl.java`)!;
      const body = bodyOf(impl, "findAll");
      expect(body).toContain(TENANT_INAPP);
      expect(body).toContain(DELETED_INAPP);
      // …off an UNFILTERED rehydrate, which is what a bypassing read streams.
      expect(impl).toContain("private List<Note> rehydrateAll()");
      expect(bodyOf(impl, "rehydrateAll")).not.toContain("isDeleted");
      expect(bodyOf(impl, "rehydrateAll")).not.toContain("tenantId");
    });

    it("findById() applies BOTH conjuncts", async () => {
      const impl = (await generateSystemFiles(SRC)).get(`${ROOT}/notes/NoteRepositoryImpl.java`)!;
      const body = bodyOf(impl, "findById");
      expect(body).toContain("Objects.equals(rec.tenantId(), currentUser.operatingOrg())");
      expect(body).toContain("!rec.isDeleted()");
    });
  });
});
