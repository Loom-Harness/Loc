// The fold-tenancy fact (`src/ir/enrich/fold-tenancy.ts`): which folded
// projections are tenant-scoped, the read scope of their rows, and the two
// refusals around them (a fold mixing `crossTenant` and tenant-scoped
// producers; a query-time projection over a scoped fold).

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import {
  foldFloorTerms,
  foldProducersOf,
  foldTenancyFor,
  foldTenancyVerdict,
} from "../../src/ir/enrich/fold-tenancy.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type { ProjectionIR, SystemIR } from "../../src/ir/types/loom-ir.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const FIXTURE = fs.readFileSync(
  path.resolve(__dirname, "../e2e/fixtures/ts-build/fold-tenant-scoped.ddd"),
  "utf8",
);

async function load(src: string) {
  const { model } = await parseString(src, { validate: false });
  const loom = enrichLoomModel(lowerModel(model));
  const sys = loom.systems[0]! as unknown as SystemIR;
  const proj = (name: string): ProjectionIR =>
    sys.subdomains
      .flatMap((s) => s.contexts)
      .flatMap((c) => c.projections)
      .find((p) => p.name === name)!;
  return { loom, sys, proj };
}

describe("fold tenancy — verdicts", async () => {
  const { sys, proj } = await load(FIXTURE);

  it("a fold over tenantOwned producers (state AND event-sourced) is scoped", () => {
    expect(foldProducersOf(proj("Totals"), sys)).toEqual({
      tenantOwned: ["Main.Acct", "Main.Ledger"],
      crossTenant: [],
      other: [],
    });
    expect(foldTenancyVerdict(proj("Totals"), sys)).toBe("scoped");
    expect(proj("Totals").foldTenantClaim).toBe("tenantId");
  });

  it("a fold whose producers are all crossTenant is exempt — no tenant column, unscoped", () => {
    expect(foldTenancyVerdict(proj("Bookings"), sys)).toBe("exempt");
    expect(foldTenancyFor(proj("Bookings"))).toBeUndefined();
  });

  it("the scoped fold's read scope is the tenant floor over the row's tenantId", () => {
    const t = foldTenancyFor(proj("Totals"))!;
    expect(t.scope.restrictions.map((r) => [r.kind, r.tenancy, r.capability])).toEqual([
      ["tenancy", "tenant", "tenantOwned"],
    ]);
    expect(foldFloorTerms(t)).toEqual([
      { field: "tenantId", column: "tenant_id", claim: "tenantId" },
    ]);
  });

  it("without `tenancy by` a fold is unscoped", async () => {
    const plain = FIXTURE.replace("tenancy by user.tenantId of Org", "")
      .replaceAll("with tenantOwned, crudish", "with crudish")
      .replace("with tenantOwned {", "{")
      .replace(" crossTenant ", " ");
    const { sys: s2, proj: p2 } = await load(plain);
    expect(foldTenancyVerdict(p2("Totals"), s2)).toBe("unscoped");
    expect(foldTenancyFor(p2("Totals"))).toBeUndefined();
  });
});

describe("fold tenancy — refusals", () => {
  const codes = async (src: string): Promise<string[]> => {
    const { loom } = await load(src);
    return validateLoomModel(loom)
      .filter((d) => d.severity === "error")
      .map((d) => d.code ?? "");
  };

  it("admits the fixture", async () => {
    expect(await codes(FIXTURE)).toEqual([]);
  });

  it("refuses a fold mixing crossTenant and tenantOwned producers", async () => {
    const mixed = FIXTURE.replace(
      "on(e: Booked) { seats := e.seats }",
      "on(e: Booked) { seats := e.seats }\n        on(e: Paid) { seats := e.amount }",
    )
      .replace(
        "event Paid { acct: Acct id, amount: int }",
        "event Paid { acct: Acct id, plan: Plan id, amount: int }",
      )
      .replace(
        "emit Paid { acct: id, amount: amount }",
        "emit Paid { acct: id, plan: plan, amount: amount }",
      )
      .replace("operation pay(amount: int)", "operation pay(plan: Plan id, amount: int)")
      .replace("on(e: Paid) { seats := e.amount }", "on(e: Paid) by e.plan { seats := e.amount }");
    expect(await codes(mixed)).toEqual(["loom.tenancy-folded-projection-mixed"]);
  });

  it("refuses a query-time projection over a scoped fold, not over an exempt one", async () => {
    const over = (src: string) =>
      FIXTURE.replace(
        "      projection Bookings keyed by plan {",
        `      projection Q { n: int  from ${src} as t  select n = count() }\n      projection Bookings keyed by plan {`,
      );
    expect(await codes(over("Totals"))).toEqual(["loom.tenancy-projection-over-scoped-fold"]);
    expect(await codes(over("Bookings"))).toEqual([]);
  });
});
