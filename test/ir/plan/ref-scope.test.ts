// The reference-scope decision (`src/ir/plan/ref-scope.ts`): which persisted
// `X id` a save must probe.  Pure IR facts, so pinned here; the probe's
// behaviour is the isolation e2e's `assertReferenceAdmission`.

import { describe, expect, it } from "vitest";
import { admittedReferences, scopedReferences } from "../../../src/ir/plan/ref-scope.js";
import { buildLoomModel, enrichedContexts } from "../../_helpers/ir.js";

const SRC = `
system R {
  user { id: string  tenantId: string }
  tenancy by user.tenantId of Org
  subdomain Core {
    context Main {
      aggregate Org with crudish { name: string }
      aggregate Invoice with tenantOwned, crudish { number: string }
      aggregate Plan crossTenant with crudish { code: string }
      aggregate Payment with tenantOwned, crudish {
        invoice: Invoice id
        backup: Invoice id?
        others: Invoice id[]
        plan: Plan id?
        payer: Org id?
        contains lines: Line[]
        entity Line { invoice: Invoice id }
      }
      repository Orgs for Org { }
      repository Invoices for Invoice { }
      repository Plans for Plan { }
      repository Payments for Payment { }
    }
    context Other {
      aggregate Claim with tenantOwned, crudish { invoice: Invoice id }
      repository Claims for Claim { }
    }
  }
  api MainApi from Core
  storage pg { type: postgres }
  resource st { for: Main, kind: state, use: pg }
  resource ot { for: Other, kind: state, use: pg }
  deployable d { platform: node, contexts: [Main, Other], dataSources: [st, ot], serves: MainApi, port: 3000, auth: required }
}
`;

describe("ref-scope plan", () => {
  it("probes tenantOwned targets only, through parts, optionals and collections", async () => {
    const ctx = enrichedContexts(await buildLoomModel(SRC)).find((c) => c.name === "Main")!;
    const payment = ctx.aggregates.find((a) => a.name === "Payment")!;
    const scopes = scopedReferences(payment, ctx.aggregates).map((r) => [
      r.part ?? "",
      r.field,
      r.scope,
      r.collection,
      r.optional,
    ]);
    expect(scopes).toEqual([
      ["", "invoice", "row-tenant", false, false],
      ["", "backup", "row-tenant", false, true],
      ["", "others", "row-tenant", true, false],
      // crossTenant data and the registry are global: the FK decides.
      ["", "plan", "global", false, true],
      ["", "payer", "global", false, true],
      ["Line", "invoice", "row-tenant", false, false],
    ]);
    expect(admittedReferences(payment, ctx.aggregates).map((r) => r.field)).toEqual([
      "invoice",
      "backup",
      "others",
      "invoice",
    ]);
    expect(admittedReferences(payment, ctx.aggregates)[3]!.via).toEqual([
      { contain: "lines", collection: true, optional: false },
    ]);
  });

  it("a tenantOwned target with no table beside the row is unresolvable", async () => {
    const loom = await buildLoomModel(SRC);
    const ctxs = enrichedContexts(loom);
    const other = ctxs.find((c) => c.name === "Other")!;
    const all = ctxs.flatMap((c) => c.aggregates);
    const claim = other.aggregates.find((a) => a.name === "Claim")!;
    expect(
      scopedReferences(claim, other.aggregates, (n) => all.find((a) => a.name === n)).map(
        (r) => r.scope,
      ),
    ).toEqual(["unresolvable"]);
    expect(admittedReferences(claim, other.aggregates)).toEqual([]);
  });
});
