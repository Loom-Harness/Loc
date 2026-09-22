// F-005 — `ignoring tenantOwned` / `ignoring *` is a one-word cross-tenant
// read bypass, and before `loom.tenancy-filter-bypass` it was SILENT in the
// language-default `auth { enforcement: opt }` mode: the emitted projection
// route carried no tenant predicate at all and answered with every tenant's
// rows.  `enforcement: denyByDefault` catches only the ABSENCE of a gate, and
// `requires true` satisfies that while leaking exactly as hard — so the gate
// here is about the tenancy bypass itself, in every enforcement mode.
//
// The other half of the test is NON-VACUITY: a warning that fired on every
// `ignoring` would be useless noise.  `ignoring softDeletable`, `ignoring *`
// on an untenanted aggregate, and a plain unbypassed read must all stay
// silent.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const CODE = "loom.tenancy-filter-bypass";

async function diagnose(source: string): Promise<{ errors: string[]; bypass: string[] }> {
  const { model } = await parseString(source, { validate: false });
  const diags = validateLoomModel(enrichLoomModel(lowerModel(model)));
  return {
    errors: diags.filter((d) => d.severity === "error").map((d) => `${d.code}: ${d.message}`),
    bypass: diags.filter((d) => d.code === CODE).map((d) => d.message),
  };
}

/** The repro shape: a tenant-owned aggregate, a tenancy declaration, and one
 *  read whose `ignoring` clause (if any) is the variable under test. */
function sys(opts: {
  enforcement?: string;
  /** e.g. ` ignoring tenantOwned` — the projection's bypass clause. */
  projectionIgnoring?: string;
  /** e.g. ` ignoring *` — a repository find's bypass clause. */
  findIgnoring?: string;
  /** extra capabilities on the tenant-owned aggregate. */
  caps?: string;
}): string {
  return `
system S {
  user { id: guid  orgId: string  role: string }
  auth { enforcement: ${opts.enforcement ?? "opt"}  oidc { issuer: "https://idp.example.com"  clientId: "app" } }
  tenancy by user.orgId of Org
  subdomain Ops { context Work {
    aggregate Org with crudish { name: string }
    aggregate WorkOrder with tenantOwned${opts.caps ?? ""}, crudish { ref: string  amount: money }
    repository Orgs for Org { }
    repository WorkOrders for WorkOrder {
      find byRef(ref: string): WorkOrder[] where this.ref == ref${opts.findIgnoring ?? ""}
    }
    projection PlatformRevenue {
      revenue: money
      from WorkOrder as w${opts.projectionIgnoring ?? ""}
      select revenue = sum(w.amount)
    }
  } }
  api Api from Ops
  storage pg { type: postgres }
  resource st { for: Work, kind: state, use: pg }
  deployable api { platform: node contexts: [Work] dataSources: [st] serves: Api port: 3000 auth: required }
}`;
}

describe("loom.tenancy-filter-bypass — the tenancy escape hatch is loud", () => {
  it("fires on `ignoring tenantOwned` under the DEFAULT enforcement: opt", async () => {
    const { errors, bypass } = await diagnose(
      sys({ enforcement: "opt", projectionIgnoring: " ignoring tenantOwned" }),
    );
    expect(errors).toEqual([]);
    expect(bypass).toHaveLength(1);
    expect(bypass[0]).toContain("PlatformRevenue");
    expect(bypass[0]).toContain("Work.WorkOrder");
    expect(bypass[0]).toContain("currentUser.orgId");
  });

  it("fires under denyByDefault too — the mode is not consulted", async () => {
    const { bypass } = await diagnose(
      sys({ enforcement: "denyByDefault", projectionIgnoring: " ignoring tenantOwned" }),
    );
    expect(bypass).toHaveLength(1);
  });

  it("fires on `ignoring *` over a tenant-owned aggregate", async () => {
    const { bypass } = await diagnose(sys({ findIgnoring: " ignoring *" }));
    expect(bypass).toHaveLength(1);
    expect(bypass[0]).toContain("WorkOrders.byRef");
  });

  it("warns, never errors — the platform-admin cross-tenant report still compiles", async () => {
    const { model } = await parseString(sys({ projectionIgnoring: " ignoring tenantOwned" }), {
      validate: false,
    });
    const diags = validateLoomModel(enrichLoomModel(lowerModel(model))).filter(
      (d) => d.code === CODE,
    );
    expect(diags.map((d) => d.severity)).toEqual(["warning"]);
  });

  // --- non-vacuity ---------------------------------------------------------

  it("stays silent on a read with no `ignoring` clause at all", async () => {
    const { errors, bypass } = await diagnose(sys({}));
    expect(errors).toEqual([]);
    expect(bypass).toEqual([]);
  });

  it("stays silent on `ignoring softDeletable` — that bypass keeps the tenant floor", async () => {
    const { errors, bypass } = await diagnose(
      sys({ caps: ", softDeletable", findIgnoring: " ignoring softDeletable" }),
    );
    expect(errors).toEqual([]);
    expect(bypass).toEqual([]);
  });

  it("stays silent on `ignoring *` over an aggregate with no tenancy filter", async () => {
    const { errors, bypass } = await diagnose(`
system S {
  user { id: guid  orgId: string }
  auth { enforcement: opt  oidc { issuer: "https://idp.example.com"  clientId: "app" } }
  tenancy by user.orgId of Org
  subdomain Ops { context Work {
    aggregate Org with crudish { name: string }
    aggregate Catalog crossTenant, with softDeletable, crudish { sku: string }
    repository Orgs for Org { }
    repository Catalogs for Catalog {
      find bySku(sku: string): Catalog[] where this.sku == sku ignoring *
    }
  } }
  api Api from Ops
  storage pg { type: postgres }
  resource st { for: Work, kind: state, use: pg }
  deployable api { platform: node contexts: [Work] dataSources: [st] serves: Api port: 3000 auth: required }
}`);
    expect(errors).toEqual([]);
    expect(bypass).toEqual([]);
  });

  it("stays silent on a system that declares no tenancy at all", async () => {
    const { errors, bypass } = await diagnose(`
system S {
  subdomain Ops { context Work {
    aggregate WorkOrder with softDeletable, crudish { ref: string }
    repository WorkOrders for WorkOrder {
      find byRef(ref: string): WorkOrder[] where this.ref == ref ignoring *
    }
  } }
  api Api from Ops
  storage pg { type: postgres }
  resource st { for: Work, kind: state, use: pg }
  deployable api { platform: node contexts: [Work] dataSources: [st] serves: Api port: 3000 }
}`);
    expect(errors).toEqual([]);
    expect(bypass).toEqual([]);
  });
});
