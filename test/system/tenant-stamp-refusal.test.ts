// Finding F-018 — a principal whose tenancy claim is MISSING must be refused on
// the write path, on every backend, not handed a 500.
//
// The shape of the defect: `with tenantOwned` under `tenancy by user.tenantId`
// gives an aggregate a NOT NULL `tenant_id` column and an `onCreate` stamp that
// fills it from `currentUser.tenantId`.  A token omitting that claim is routine
// (an IdP emits a tenant claim only for users who have a tenant).  Reads then
// behave correctly — `docs/tenancy.md` promises the missing/malformed-claim path
// is "an ordinary empty read on every backend … never a 500" — but the WRITE
// bound null into the NOT NULL column, and what came back was
// `500 {"detail":"internal"}`, naming nothing.
//
// This gate asserts the refusal is emitted at each backend's own stamp site, in
// that backend's own 403 idiom, and that the message names the claim.  It is a
// CROSS-BACKEND test on purpose: the failure it guards is "four backends fixed,
// one forgotten", and a per-backend suite cannot see that.

import { NodeFileSystem } from "langium/node";
import { parseHelper } from "langium/test";
import { describe, expect, it } from "vitest";
import { createDddServices } from "../../src/language/ddd-module.js";
import type { Model } from "../../src/language/generated/ast.js";
import { generateSystems } from "../../src/system/index.js";

const services = createDddServices(NodeFileSystem);
const parse = parseHelper<Model>(services.Ddd);

const SRC = `
system Multi {
  user { id: string  email: string  tenantId: string }
  auth { enforcement: opt  oidc { issuer: env("OIDC_ISSUER")  clientId: env("OIDC_CLIENT_ID") } }
  tenancy by user.tenantId of Org

  subdomain S {
    context C {
      aggregate Org with crudish { name: string }
      aggregate Widget with tenantOwned, crudish { label: string }
    }
  }

  storage primary { type: postgres }
  resource cState { for: C, kind: state, use: primary }

  deployable apiNode { platform: node   contexts: [C] dataSources: [cState] auth: required port: 3001 }
  deployable apiNet  { platform: dotnet contexts: [C] dataSources: [cState] auth: required port: 3002 }
  deployable apiEx   { platform: elixir contexts: [C] dataSources: [cState] auth: required port: 3003 }
  deployable apiPy   { platform: python contexts: [C] dataSources: [cState] auth: required port: 3004 }
  deployable apiJv   { platform: java   contexts: [C] dataSources: [cState] auth: required port: 3005 }
}`;

let cached: Map<string, string> | undefined;
async function files(): Promise<Map<string, string>> {
  if (!cached) {
    const doc = await parse(SRC, { validation: false });
    cached = generateSystems(doc.parseResult.value).files;
  }
  return cached;
}

/** The one emitted file whose path ends with `suffix`. */
async function file(suffix: string): Promise<string> {
  const all = await files();
  const hits = [...all.keys()].filter((p) => p.endsWith(suffix));
  expect(hits, `expected exactly one emitted path ending in ${suffix}`).toHaveLength(1);
  return all.get(hits[0]!)!;
}

describe("a missing tenancy claim refuses the write (F-018)", () => {
  it("node — the shared stamp helper throws ForbiddenError before building the row", async () => {
    const src = await file("api_node/db/audit-stamp.ts");
    expect(src).toContain('if (currentUser.tenantId == null || currentUser.tenantId === "") {');
    expect(src).toContain("throw new ForbiddenError(");
    expect(src).toContain('import { ForbiddenError } from "../domain/errors";');
    // The refusal must come BEFORE the row is assembled, or the null is already
    // in the values and the guard is decoration.
    expect(src.indexOf("throw new ForbiddenError(")).toBeLessThan(
      src.indexOf("tenantId: currentUser.tenantId"),
    );
  });

  it("dotnet — the SaveChanges interceptor throws ForbiddenException in the Added arm", async () => {
    const src = await file("Infrastructure/Persistence/AuditableInterceptor.cs");
    expect(src).toContain(
      "if (string.IsNullOrEmpty(RequestContext.Current!.CurrentUser!.TenantId))",
    );
    expect(src).toContain("throw new ForbiddenException(");
    expect(src.indexOf("throw new ForbiddenException(")).toBeLessThan(
      src.indexOf("Property(x => x.TenantId).CurrentValue"),
    );
  });

  it("python — the stamp method raises ForbiddenError and imports it", async () => {
    const src = await file("app/domain/widget.py");
    expect(src).toContain("def _stamp_on_create(self, current_user: User) -> None:");
    expect(src).toContain("if not current_user.tenant_id:");
    expect(src).toContain("raise ForbiddenError(");
    expect(src).toContain("from app.domain.errors import ForbiddenError");
    expect(src.indexOf("raise ForbiddenError(")).toBeLessThan(
      src.indexOf("self._tenant_id = current_user.tenant_id"),
    );
  });

  it("java — the @PrePersist hook throws ForbiddenException before assigning", async () => {
    const src = await file("features/widgets/Widget.java");
    expect(src).toContain(
      "if (currentUser.tenantId() == null || currentUser.tenantId().isEmpty()) {",
    );
    expect(src).toContain("throw new ForbiddenException(");
    expect(src.indexOf("throw new ForbiddenException(")).toBeLessThan(
      src.indexOf("this.tenantId = currentUser.tenantId();"),
    );
  });

  it("elixir — insert short-circuits to the {:error, {:forbidden, _}} tuple", async () => {
    const repo = await file("lib/api_ex/c/widget_repository.ex");
    expect(repo).toContain("{:error, {:forbidden,");
    expect(repo).toContain("is_nil(current_user.tenant_id)");
    // …and the controller must ANSWER that tuple.  Without this arm the tuple
    // falls through the `case` and raises, turning the refusal back into the 500
    // it exists to replace — the exact half-fix this assertion exists to catch.
    const ctrl = await file("controllers/widget_controller.ex");
    expect(ctrl).toContain("{:error, {:forbidden, detail}} ->");
    expect(ctrl).toContain('ProblemDetails.problem_response(conn, 403, "Forbidden", detail)');
  });

  it("every backend names the missing claim in its message", async () => {
    // `"internal"` was the whole complaint.  The operator must be able to read
    // the answer off the response without opening a log.
    for (const suffix of [
      "api_node/db/audit-stamp.ts",
      "Infrastructure/Persistence/AuditableInterceptor.cs",
      "app/domain/widget.py",
      "features/widgets/Widget.java",
      "lib/api_ex/c/widget_repository.ex",
    ]) {
      const src = await file(suffix);
      expect(src, suffix).toContain('carries no \\"tenantId\\" claim');
    }
  });

  it("leaves the OPTIONAL dataKey stamp unguarded, so the signup bootstrap survives", async () => {
    // `tenantOwned` also stamps `dataKey: string?` from `currentUser.orgPath`.
    // Null is legal there, and guarding it would refuse the claim-less signup
    // bootstrap `docs/tenancy.md` documents (create an Org with no tenant claim,
    // then use its id as the claim).  One guard, not two.
    const src = await file("api_node/db/audit-stamp.ts");
    expect(src).toContain("dataKey: currentUser.orgPath");
    expect(src).not.toContain("currentUser.orgPath == null");
    expect((src.match(/throw new ForbiddenError\(/g) ?? []).length).toBe(1);
  });

  it("leaves the tenant REGISTRY's own writes unguarded", async () => {
    // Org is the registry: it carries no tenant stamp at all, so a claim-less
    // principal must still be able to create one.  That is the bootstrap.
    const all = await files();
    const orgDomain = all.get(
      [...all.keys()].find((p) => p.endsWith("app/domain/org.py"))!,
    )!;
    expect(orgDomain).not.toContain("ForbiddenError");
  });
});
