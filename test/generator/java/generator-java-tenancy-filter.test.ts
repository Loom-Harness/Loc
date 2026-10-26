// ---------------------------------------------------------------------------
// Java backend — principal (tenancy) capability filter.
//
// `filter this.tenantId == currentUser.tenantId` (a bare filter, so named
// `<Agg>_filter` and never disabled) is an auto-enabled, by-key
// Hibernate filter on the entity: its `@ParamDef` resolver reads the ambient
// request principal whenever Hibernate binds the parameter, so it applies to
// every query of the entity — the repository's `@Query` finds, Spring Data's
// derived `findAll`/`count`/`existsById`, the `bumpVersion` update — without a
// tenant predicate in any of them.  No principal binds null: `tenant_id = NULL`
// matches no row (fail-closed).
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = readFileSync("test/e2e/fixtures/java-build/tenancy-filter.ddd", "utf8");
const ROOT = "api1/src/main/java/com/loom/api1";

async function file(rel: string): Promise<string> {
  const files = await generateSystemFiles(SRC);
  return files.get(`${ROOT}/${rel}`)!;
}

describe("java generator — principal (tenancy) capability filter", () => {
  it("is an auto-enabled, by-key named filter on the entity, its claim a resolved parameter", async () => {
    const entity = await file("features/accounts/Account.java");
    expect(entity).toContain(
      '@FilterDef(name = "Account_filter", autoEnabled = true, applyToLoadByKey = true, parameters = {\n' +
        '    @ParamDef(name = "__cuTenantId", type = String.class, resolver = Account.FilterParam__cuTenantId.class)\n' +
        "})",
    );
    expect(entity).toContain(
      '@Filter(name = "Account_filter", condition = "tenant_id = :__cuTenantId")',
    );
    expect(entity).not.toContain("@SQLRestriction");
  });

  it("resolves the parameter from the ambient principal, null without one", async () => {
    const entity = await file("features/accounts/Account.java");
    expect(entity).toContain(
      "public static final class FilterParam__cuTenantId implements java.util.function.Supplier<String> {",
    );
    expect(entity).toContain("var __cu = CurrentUserAccessor.currentOrNull();");
    expect(entity).toContain("return __cu == null ? null : __cu.tenantId();");
  });

  it("no repository query spells the tenant predicate; by id is still a query", async () => {
    const repo = await file("features/accounts/AccountJpaRepository.java");
    expect(repo).not.toMatch(/tenantId|currentUserAccessor/);
    expect(repo).toContain('@Query("select e from Account e where e.balance >= :min")');
    expect(repo).toContain(
      '@Query("select e from Account e where e.id = :id")\n    Optional<Account> findById(@Param("id") AccountId id);',
    );
    // Inherited `findAll` is not re-declared: the filter scopes it.
    expect(repo).not.toContain("List<Account> findAll();");
  });

  it("emits the CurrentUserAccessor the resolver reads", async () => {
    const accessor = await file("auth/CurrentUserAccessor.java");
    expect(accessor).toContain("public static User currentOrNull()");
    expect(await file("auth/User.java")).toContain(
      "record User(UUID id, String tenantId, boolean isSystem, String causedBy)",
    );
  });
});
