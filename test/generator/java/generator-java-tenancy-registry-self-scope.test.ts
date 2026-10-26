// ---------------------------------------------------------------------------
// Java backend — derived tenancy registry self-scope filter (multi-tenancy
// Phase 1b, capstone decision 4).
//
// The registry's derived `this.id == currentUser.tenantId` is a Hibernate
// filter on the registry entity, like `tenantOwned`'s: `id = :<param>`, the
// claim a `@ParamDef` resolved per query, bound AS the id's value type.  A
// `string` claim against a guid id converts through the principal's emitted
// `<claim>AsUuid()` accessor, which is null for an absent OR MALFORMED claim
// (M-T3.7(c)) — so a token carrying `tenantId: "not-a-guid"` matches no row
// instead of throwing out of query preparation.  A same-typed guid claim
// binds directly.  The filter is named `<Registry>_tenancy`: only
// `ignoring *` lifts it.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = readFileSync("test/fixtures/corpus/tenancy-owned.ddd", "utf8").replace(
  "__PLATFORM__",
  "java",
);
const ROOT = "d/src/main/java/com/loom/d";

// A guid claim and the `tenantOwned` capability are incompatible by
// construction: the capability provides `tenantId: string`, and comparing that
// to a guid claim mis-compiles the typed backends — `loom.tenant-owned-claim-type`
// says so.  The REGISTRY's own comparison is same-typed against its guid id and
// is fine, which is exactly what these cases exercise, so the guid variant drops
// the tenant-OWNED aggregate rather than emitting from a rejected model.
const guidClaim = (src: string): string =>
  src
    .replace("tenantId: string", "tenantId: guid")
    .replace(
      "aggregate Invoice with tenantOwned, crudish",
      "aggregate Invoice crossTenant with crudish",
    );

async function orgEntity(src: string = SRC): Promise<string> {
  const files = await generateSystemFiles(src);
  return files.get(`${ROOT}/features/organizations/Organization.java`)!;
}

async function orgRepo(src: string = SRC): Promise<string> {
  const files = await generateSystemFiles(src);
  return files.get(`${ROOT}/features/organizations/OrganizationJpaRepository.java`)!;
}

describe("java generator — derived registry self-scope filter", () => {
  it("binds a same-typed guid claim directly (no UUID.fromString)", async () => {
    const entity = await orgEntity(guidClaim(SRC));
    expect(entity).toContain(
      '@ParamDef(name = "__cuTenantId", type = java.util.UUID.class, resolver = Organization.FilterParam__cuTenantId.class)',
    );
    expect(entity).toContain(
      '@Filter(name = "Organization_tenancy", condition = "id = :__cuTenantId")',
    );
    expect(entity).toContain("return __cu == null ? null : __cu.tenantId();");
    expect(entity).not.toContain("fromString");
  });

  it("binds a string claim through the null-on-malformed AsUuid accessor", async () => {
    const entity = await orgEntity();
    expect(entity).toContain(
      '@Filter(name = "Organization_tenancy", condition = "id = :__cuTenantIdAsUuid")',
    );
    expect(entity).toContain("return __cu == null ? null : __cu.tenantIdAsUuid();");
  });

  it("a reified retrieval (Criteria) runs under the same entity filter, with no scope of its own", async () => {
    const withCriterion = SRC.replace(
      "      aggregate Organization with crudish {\n        name: string\n      }",
      '      aggregate Organization with crudish {\n        name: string\n      }\n      criterion NamedAcme of Organization = this.name == "Acme"',
    );
    expect(withCriterion).not.toBe(SRC); // the fixture still has the shape we patched
    const files = await generateSystemFiles(withCriterion);
    const criteria = files.get(`${ROOT}/domain/criteria/OrganizationCriteria.java`)!;
    expect(criteria).not.toContain("tenantScope");
    expect(criteria).not.toContain("currentUser");
  });

  it("no registry repository query spells the self-scope", async () => {
    const repo = await orgRepo();
    expect(repo).not.toMatch(/tenantId|currentUserAccessor/);
    expect(await orgEntity()).not.toContain("@SQLRestriction");
  });
});
