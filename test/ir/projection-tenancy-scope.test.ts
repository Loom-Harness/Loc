// Projections under `tenancy by` — the two read shapes that served one
// tenant's data to another.
//
//   * A FOLDED projection (`on(e: Ev) { … }`) writes rows no tenant command
//     owns: the read-model table has no tenant column and every backend's
//     `GET /projections/<p>` reads it whole.  It is refused
//     (`loom.tenancy-folded-projection-unscoped`) until a fold can carry the
//     event's tenant.
//   * A QUERY-TIME projection declared in another context than its source
//     resolves the source in its HOME context — so its `ignoring` clause
//     validates against the aggregate that actually declares the capability.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

async function diagnose(
  source: string,
): Promise<{ code: string | undefined; message: string; severity: string }[]> {
  const { model } = await parseString(source, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model))).map((d) => ({
    code: d.code,
    message: d.message,
    severity: d.severity,
  }));
}

const folded = (tenancy: boolean): string => `
system R {
  user { id: guid  tenantId: string }
  ${tenancy ? "tenancy by user.tenantId of Org" : ""}
  subdomain S {
    context C {
      event Paid { acct: Acct id, amount: int }
      aggregate Org with crudish { name: string }
      aggregate Acct with ${tenancy ? "tenantOwned, " : ""}crudish {
        owner: string
        operation pay(amount: int) { emit Paid { acct: id, amount: amount } }
      }
      repository Accts for Acct { }
      repository Orgs for Org { }
      channel Ev { carries: Paid }
      projection Totals keyed by acct {
        acct: Acct id
        paid: int
        on(e: Paid) { acct := e.acct  paid := e.amount }
      }
    }
  }
  api A from S
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d { platform: node contexts: [C] dataSources: [st] serves: A port: 4000 auth: required }
}`;

describe("loom.tenancy-folded-projection-unscoped", () => {
  const CODE = "loom.tenancy-folded-projection-unscoped";

  it("refuses a folded projection under `tenancy by`", async () => {
    const hits = (await diagnose(folded(true))).filter((d) => d.code === CODE);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe("error");
    expect(hits[0]!.message).toContain("Projection 'C.Totals' folds 'Paid'");
  });

  it("is silent without `tenancy by`", async () => {
    expect((await diagnose(folded(false))).filter((d) => d.code === CODE)).toEqual([]);
  });
});

const crossContext = (ignoring: string): string => `
system F3 {
  user { id: guid  tenantId: string }
  tenancy by user.tenantId of Organization
  subdomain Sales {
    context Orders {
      aggregate Order with tenantOwned, softDeletable, crudish { code: string  total: int }
      repository Orders for Order { }
    }
    context Reports {
      projection Volume {
        n: int
        from Order as o
        ${ignoring}
        select n = count()
      }
    }
    context Accounts {
      aggregate Organization with crudish { name: string }
    }
  }
  api SalesApi from Sales
  storage primary { type: postgres }
  resource oState { for: Orders, kind: state, use: primary }
  resource aState { for: Accounts, kind: state, use: primary }
  deployable d {
    platform: java
    contexts: [Orders, Reports, Accounts]
    dataSources: [oState, aState]
    serves: SalesApi
    port: 4000
    auth: required
  }
}`;

describe("cross-context query-time projection — `ignoring` resolves the source's home context", () => {
  it("records the source's declaring context on the IR", async () => {
    const { model } = await parseString(crossContext(""), { validate: false });
    const loom = enrichLoomModel(lowerModel(model));
    const reports = loom.systems[0]!.subdomains[0]!.contexts.find((c) => c.name === "Reports")!;
    expect(reports.projections[0]!.query?.sourceContext).toBe("Orders");
  });

  it("accepts `ignoring softDeletable` — the capability the home aggregate implements", async () => {
    const diags = await diagnose(crossContext("ignoring softDeletable"));
    expect(diags.filter((d) => d.code?.startsWith("loom.filter-bypass"))).toEqual([]);
  });

  it("names the home context when `ignoring tenantOwned` drops the tenant floor", async () => {
    const diags = await diagnose(crossContext("ignoring tenantOwned"));
    expect(diags.filter((d) => d.code === "loom.filter-bypass-unknown-capability")).toEqual([]);
    const bypass = diags.filter((d) => d.code === "loom.tenancy-filter-bypass");
    expect(bypass).toHaveLength(1);
    expect(bypass[0]!.message).toContain("on aggregate 'Orders.Order'");
  });
});

describe("loom.projection-cross-context-source-unsupported", () => {
  const CODE = "loom.projection-cross-context-source-unsupported";
  const perRow = (platform: string): string =>
    crossContext("where o.total > 0")
      .replace("        select n = count()", "        select n = o.total")
      .replace("platform: java", `platform: ${platform}`);

  it("refuses a per-row cross-context read where the source find is synthesised per context", async () => {
    for (const platform of ["node", "python", "dotnet"]) {
      const hits = (await diagnose(perRow(platform))).filter((d) => d.code === CODE);
      expect(hits, platform).toHaveLength(1);
      expect(hits[0]!.message).toContain("reads 'Order' row by row from context 'Orders'");
    }
  });

  it("admits it on java and elixir, which resolve the source's home context", async () => {
    for (const platform of ["java", "elixir"]) {
      expect(
        (await diagnose(perRow(platform))).filter((d) => d.code === CODE),
        platform,
      ).toEqual([]);
    }
  });

  it("admits a cross-context aggregation everywhere", async () => {
    const diags = await diagnose(crossContext("").replace("platform: java", "platform: node"));
    expect(diags.filter((d) => d.code === CODE)).toEqual([]);
  });
});
