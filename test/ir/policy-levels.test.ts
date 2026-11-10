// `policy { allow [write] local on <Aggregate> }` — the flat ladder
// (D-TENANCY-FLAT).  `local`, the tenant floor, is the only level: a rule only
// names an aggregate for the phase-⑦ target checks, and enrichment leaves the
// `tenantOwned` floor exactly as the capability contributed it.  The removed
// `deep` / `global` levels still PARSE so a model written against the old
// ladder gets the named `loom.policy-level-removed` error, and lowering drops
// the rule.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type { LoomDiagnostic } from "../../src/ir/validate/validate.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { diagText } from "../_helpers/diagnostics.js";
import { buildLoomModel } from "../_helpers/ir.js";
import { parseString } from "../_helpers/parse.js";

const shop = (opts: { policy: string; extra?: string }): string => `
  system Shop {
    user { id: guid  tenantId: string }
    tenancy by user.tenantId of Org
    subdomain S {
      context C {
        aggregate Invoice with tenantOwned { amount: int }
        aggregate Order with tenantOwned { total: int }
        ${opts.extra ?? ""}
        aggregate Org {
          name: string
          implements tenantRegistry
        }
        repository Invoices for Invoice { }
        repository Orders for Order { }
        repository Orgs for Org { }
        policy Reach {
          ${opts.policy}
        }
      }
    }
    api ShopApi from S
    storage primarySql { type: postgres }
    resource shopState { for: C, kind: state, use: primarySql }
    deployable api {
      platform: node
      contexts: [C]
      dataSources: [shopState]
      serves: ShopApi
      port: 3001
      auth: required
    }
  }
`;

const POLICY_CODES = new Set([
  "loom.policy-unknown-aggregate",
  "loom.policy-target-not-tenant-owned",
  "loom.policy-duplicate-target",
]);

async function policyDiags(source: string): Promise<LoomDiagnostic[]> {
  const { model } = await parseString(source, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model))).filter(
    (d) => d.code !== undefined && POLICY_CODES.has(d.code),
  );
}

async function removedLevelErrors(policy: string): Promise<string[]> {
  const { diagnostics } = await parseString(shop({ policy }));
  return diagnostics.filter((d) => d.code === "loom.policy-level-removed").map(diagText);
}

describe("policy levels — lowering", () => {
  it("lowers `allow [write] local on <Agg>` onto the read and write rule lists", async () => {
    const model = await buildLoomModel(
      shop({ policy: "allow local on Invoice\nallow write local on Order" }),
    );
    const ctx = model.systems[0]!.subdomains[0]!.contexts[0]!;
    expect(ctx.policyReadLevels).toEqual([
      { aggregate: "Invoice", level: "local", source: "allow local on Invoice" },
    ]);
    expect(ctx.policyWriteLevels).toEqual([
      { aggregate: "Order", level: "local", source: "allow write local on Order" },
    ]);
  });

  it("a context with no policy carries no rule lists", async () => {
    const model = await buildLoomModel(shop({ policy: "" }));
    const ctx = model.systems[0]!.subdomains[0]!.contexts[0]!;
    expect(ctx.policyReadLevels).toBeUndefined();
    expect(ctx.policyWriteLevels).toBeUndefined();
  });

  it("`local` leaves the tenantOwned floor and the write seam untouched", async () => {
    const plain = await buildLoomModel(shop({ policy: "" }));
    const ruled = await buildLoomModel(
      shop({ policy: "allow local on Invoice\nallow write local on Invoice" }),
    );
    const inv = (m: typeof plain) =>
      m.systems[0]!.subdomains[0]!.contexts[0]!.aggregates.find((a) => a.name === "Invoice")!;
    expect(inv(ruled).contextFilters).toEqual(inv(plain).contextFilters);
    expect(inv(ruled).writeScopeFilter).toBeUndefined();
  });

  it("a removed level never reaches the IR", async () => {
    const { model } = await parseString(
      shop({ policy: "allow deep on Invoice\nallow write global on Order" }),
      { validate: false },
    );
    const ctx = enrichLoomModel(lowerModel(model)).systems[0]!.subdomains[0]!.contexts[0]!;
    expect(ctx.policyReadLevels).toBeUndefined();
    expect(ctx.policyWriteLevels).toBeUndefined();
  });
});

describe("policy levels — the removed `deep` / `global` levels", () => {
  it.each([
    ["allow deep on Invoice", "deep"],
    ["allow global on Invoice", "global"],
    ["allow write deep on Invoice", "deep"],
    ["allow write global on Invoice", "global"],
  ])("`%s` → loom.policy-level-removed naming the replacement", async (rule, level) => {
    const errors = await removedLevelErrors(rule);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(`\`${rule}\``);
    expect(errors[0]).toContain(`the '${level}' level no longer exists`);
    expect(errors[0]).toContain("a share or a row rule");
  });

  it("`local` is not refused", async () => {
    expect(await removedLevelErrors("allow local on Invoice\nallow write local on Order")).toEqual(
      [],
    );
  });
});

describe("policy levels — target validation (fail closed)", () => {
  it("valid `local` rules produce no policy diagnostics", async () => {
    expect(
      await policyDiags(shop({ policy: "allow local on Invoice\nallow write local on Order" })),
    ).toEqual([]);
  });

  it("unknown aggregate → loom.policy-unknown-aggregate", async () => {
    const diags = await policyDiags(shop({ policy: "allow local on Ghost" }));
    expect(diags.map((d) => d.code)).toContain("loom.policy-unknown-aggregate");
  });

  it("non-tenantOwned target → loom.policy-target-not-tenant-owned", async () => {
    const diags = await policyDiags(
      shop({
        extra: "aggregate Plan crossTenant { tier: string }",
        policy: "allow write local on Plan",
      }),
    );
    expect(diags.map((d) => d.code)).toContain("loom.policy-target-not-tenant-owned");
  });

  it("duplicate target → loom.policy-duplicate-target", async () => {
    const diags = await policyDiags(
      shop({ policy: "allow local on Invoice\nallow local on Invoice" }),
    );
    expect(diags.map((d) => d.code)).toContain("loom.policy-duplicate-target");
  });
});
