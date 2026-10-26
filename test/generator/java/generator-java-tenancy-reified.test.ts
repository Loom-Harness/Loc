// ---------------------------------------------------------------------------
// Java backend — tenancy on a REIFIED `criterion` retrieval.
//
// A retrieval whose `where:` is exactly a criterion reference reads via
// `JpaSpecificationExecutor.findAll(spec)`.  The tenant restriction is an
// auto-enabled Hibernate filter on the entity, which Hibernate applies to a
// Criteria query like to every other, so the spec is the criterion alone: no
// `tenantScope(User)` factory, no injected principal accessor.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = readFileSync("test/e2e/fixtures/java-build/tenancy-reified.ddd", "utf8");
const ROOT = "api1/src/main/java/com/loom/api1";

describe("java generator — tenancy on a reified criterion retrieval", () => {
  it("the Criteria class carries the criterion only", async () => {
    const files = await generateSystemFiles(SRC);
    const criteria = [...files.keys()].find((k) => k.endsWith("AccountCriteria.java"))!;
    const content = files.get(criteria)!;
    expect(content).toContain("public static Specification<Account> HighBalance(");
    expect(content).not.toContain("tenantScope");
    expect(content).not.toContain("currentUser");
  });

  it("the reified findAll runs the criterion spec under the entity's tenant filter", async () => {
    const files = await generateSystemFiles(SRC);
    const impl = files.get(`${ROOT}/features/accounts/AccountRepositoryImpl.java`)!;
    expect(impl).toContain(
      'jpa.findAll(AccountCriteria.HighBalance(min), Sort.by(Sort.Order.desc("balance")))',
    );
    expect(impl).not.toContain("CurrentUserAccessor");
    const entity = files.get(`${ROOT}/features/accounts/Account.java`)!;
    expect(entity).toMatch(
      /@Filter\(name = "Account_\w+", condition = "tenant_id = :__cuTenantId"\)/,
    );
  });
});
