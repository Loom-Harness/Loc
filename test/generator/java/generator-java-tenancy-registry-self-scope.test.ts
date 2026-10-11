// ---------------------------------------------------------------------------
// Java backend — derived tenancy registry self-scope filter (multi-tenancy
// Phase 1b, capstone decision 4).
//
// The registry's derived `this.id == currentUser.tenantId` rides the same
// per-query SpEL-principal JPQL path as `tenantOwned`'s filter.  The entity
// key is an `@EmbeddedId` record (`OrganizationId(UUID value)`), so the
// comparison navigates into its component (`e.id.value`) and the SpEL side
// binds the claim AS the id's value type: a `string` claim against a guid id
// converts through the principal's emitted `<claim>AsUuid()` accessor, which
// is null for an absent OR MALFORMED claim (M-T3.7(c)) — converting inline in
// SpEL (`T(java.util.UUID).fromString`) could only null-guard, so a token
// carrying `tenantId: "not-a-guid"` threw IllegalArgumentException out of
// query preparation (a 500 for an ordinary bad token).  A same-typed guid
// claim binds directly through the plain `?.` accessor.
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

async function orgRepo(src: string = SRC): Promise<string> {
  const files = await generateSystemFiles(src);
  return files.get(`${ROOT}/features/organizations/OrganizationJpaRepository.java`)!;
}

describe("java generator — derived registry self-scope filter", () => {
  it("binds a same-typed guid claim directly (no UUID.fromString)", async () => {
    const repo = await orgRepo(guidClaim(SRC));
    expect(repo).toContain("e.id.value = :#{@currentUserAccessor.user()?.tenantId()}");
    expect(repo).not.toContain("fromString");
  });

  it("routes the reified-retrieval (Criteria) self-scope through the same accessor", async () => {
    // A `criterion` on the registry emits a `tenantScope(User)` Specification
    // that bypasses the @Query reads.  It must navigate the @EmbeddedId to its
    // `value` component AND bind the parsed claim — comparing the embeddable
    // to a raw String threw for EVERY claim, well-formed or not.
    const withCriterion = SRC.replace(
      "      aggregate Organization with crudish {\n        name: string\n      }",
      '      aggregate Organization with crudish {\n        name: string\n      }\n      criterion NamedAcme of Organization = this.name == "Acme"',
    );
    expect(withCriterion).not.toBe(SRC); // the fixture still has the shape we patched
    const files = await generateSystemFiles(withCriterion);
    const criteria = files.get(`${ROOT}/domain/criteria/OrganizationCriteria.java`)!;
    expect(criteria).toContain(
      'cb.equal(root.get("id").<UUID>get("value"), (currentUser == null ? null : currentUser.tenantIdAsUuid()))',
    );
  });

  it("keeps the registry entity free of @SQLRestriction and claim reads", async () => {
    const files = await generateSystemFiles(SRC);
    const entity = files.get(`${ROOT}/features/organizations/Organization.java`)!;
    expect(entity).not.toContain("@SQLRestriction");
    expect(entity).not.toContain("currentUser");
    expect(entity).not.toContain("tenantId");
  });
});
