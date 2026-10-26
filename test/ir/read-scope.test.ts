// The read-scope fact (`src/ir/enrich/read-scope.ts`): every restriction a read
// of an aggregate applies, derived from the enriched IR.  These pin the fact
// itself — order, provenance, bypassability, tenancy stance, the TPH
// discriminator, the root-hosted guarded subtype form and the default order —
// independent of any backend that renders it.

import { describe, expect, it } from "vitest";
import {
  polymorphicReadFor,
  readDiscriminator,
  readOrderFor,
  readScopeFor,
} from "../../src/ir/enrich/read-scope.js";
import type { EnrichedAggregateIR } from "../../src/ir/types/loom-ir.js";
import { buildLoomModel, enrichedContexts } from "../_helpers/index.js";

const FLEET = `
system Fleets {
  user { id: guid  tenantId: string }
  tenancy by user.tenantId of Org
  subdomain D {
    context Fleet {
      abstract aggregate Vehicle inheritanceUsing: sharedTable with softDeletable, tenantOwned {
        name: string
      }
      aggregate Car extends Vehicle {
        seats: int
        filter this.seats > 0
      }
      aggregate Truck extends Vehicle { payload: int }
      aggregate Org with crudish {
        name: string
        implements tenantRegistry
      }
      aggregate Account with tenantOwned, crudish { label: string }
      aggregate Entry with tenantOwned, crudish { label: string }
      aggregate Secret with crudish { code: string }
      repository Cars for Car { }
      repository Trucks for Truck { }
      repository Orgs for Org { }
      repository Accounts for Account { }
      repository Entries for Entry { }
      repository Secrets for Secret { }
      policy {
        allow deep on Account
        allow global on Entry
        deny on Secret
      }
    }
  }
  storage primary { type: postgres }
  resource st { for: Fleet, kind: state, use: primary }
  deployable api { platform: node contexts: [Fleet] dataSources: [st] port: 3000 auth: required }
}`;

async function pool(): Promise<EnrichedAggregateIR[]> {
  const loom = await buildLoomModel(FLEET);
  return enrichedContexts(loom).find((c) => c.name === "Fleet")!.aggregates;
}

const named = (aggs: EnrichedAggregateIR[], n: string): EnrichedAggregateIR =>
  aggs.find((a) => a.name === n)!;

/** A compact, comparable view of a scope's restrictions. */
const shape = (
  aggs: EnrichedAggregateIR[],
  n: string,
  ignoring?: Parameters<typeof readScopeFor>[2],
) =>
  readScopeFor(named(aggs, n), aggs, ignoring).restrictions.map((r) => ({
    kind: r.kind,
    capability: r.capability,
    discriminator: r.discriminator,
    bypassable: r.bypassable,
    declaredOn: r.declaredOn,
    inherited: r.inherited,
    tenancy: r.tenancy,
  }));

describe("readScope — TPH concrete", () => {
  it("is the discriminator, then the inherited base filters, then the concrete's own", async () => {
    const aggs = await pool();
    expect(shape(aggs, "Car")).toEqual([
      {
        kind: "discriminator",
        capability: undefined,
        discriminator: "Car",
        bypassable: false,
        declaredOn: "Car",
        inherited: false,
        tenancy: undefined,
      },
      {
        kind: "capability",
        capability: "softDeletable",
        discriminator: undefined,
        bypassable: true,
        declaredOn: "Vehicle",
        inherited: true,
        tenancy: undefined,
      },
      {
        kind: "tenancy",
        capability: "tenantOwned",
        discriminator: undefined,
        bypassable: true,
        declaredOn: "Vehicle",
        inherited: true,
        tenancy: "tenant",
      },
      {
        kind: "filter",
        capability: undefined,
        discriminator: undefined,
        bypassable: false,
        declaredOn: "Car",
        inherited: false,
        tenancy: undefined,
      },
    ]);
  });

  it("`ignoring <Cap>` drops exactly that capability; `ignoring *` every bypassable one", async () => {
    const aggs = await pool();
    const kinds = (ig: Parameters<typeof readScopeFor>[2]) =>
      shape(aggs, "Car", ig).map((r) => r.capability ?? r.kind);
    expect(kinds({ ignoring: { bypassCaps: ["softDeletable"] } })).toEqual([
      "discriminator",
      "tenantOwned",
      "filter",
    ]);
    expect(kinds({ ignoring: { bypassAll: true } })).toEqual(["discriminator", "filter"]);
  });

  it("the discriminator accessor answers the concrete's kind, nothing for a standalone", async () => {
    const aggs = await pool();
    expect(readDiscriminator(readScopeFor(named(aggs, "Truck"), aggs))).toBe("Truck");
    expect(readDiscriminator(readScopeFor(named(aggs, "Account"), aggs))).toBeUndefined();
  });
});

describe("readScope — TPH root", () => {
  it("hosts each concrete's own filters, guarded by that concrete's discriminator", async () => {
    const aggs = await pool();
    const scope = readScopeFor(named(aggs, "Vehicle"), aggs);
    // The root's own filters apply to every row, unguarded.
    expect(scope.restrictions.map((r) => r.capability)).toEqual(["softDeletable", "tenantOwned"]);
    // Only Car's bare filter is not already root-hosted; Truck adds nothing.
    expect(
      scope.subtypeRestrictions.map((g) => ({ d: g.discriminator, kind: g.restriction.kind })),
    ).toEqual([{ d: "Car", kind: "filter" }]);
    const guarded = scope.subtypeRestrictions[0]!.restriction.predicate;
    expect(guarded?.kind).toBe("binary");
  });

  it("a concrete's discriminator-guarded filters honour `ignoring`", async () => {
    const aggs = await pool();
    const scope = readScopeFor(named(aggs, "Vehicle"), aggs, {
      ignoring: { bypassAll: true },
    });
    expect(scope.restrictions).toEqual([]);
    // A bare filter is never bypassable, so the guarded one stays.
    expect(scope.subtypeRestrictions).toHaveLength(1);
  });
});

describe("readScope — tenancy stance", () => {
  it("reads the stance off the predicate: floor, deep, global, registry self-scope", async () => {
    const aggs = await pool();
    const stance = (n: string) =>
      readScopeFor(named(aggs, n), aggs).restrictions.find((r) => r.kind === "tenancy")?.tenancy;
    expect(stance("Truck")).toBe("tenant");
    expect(stance("Account")).toBe("deep");
    expect(stance("Entry")).toBe("global");
    expect(stance("Org")).toBe("self");
  });

  it("the registry self-scope is reachable only by `ignoring *`", async () => {
    const aggs = await pool();
    const self = readScopeFor(named(aggs, "Org"), aggs).restrictions.find(
      (r) => r.tenancy === "self",
    )!;
    expect(self.bypassable).toBe(true);
    expect(self.capability).toBe("tenancy");
  });

  it("a `deny` carve-out is a never-bypassable restriction", async () => {
    const aggs = await pool();
    const secret = shape(aggs, "Secret", { ignoring: { bypassAll: true } });
    expect(secret.map((r) => [r.kind, r.bypassable])).toEqual([["deny", false]]);
  });
});

describe("readScope — default order", () => {
  it("is `id` ascending when the read declares none", () => {
    expect(readOrderFor()).toEqual([{ field: "id", direction: "asc" }]);
    expect(readOrderFor([])).toEqual([{ field: "id", direction: "asc" }]);
  });

  it("appends the `id` tie-break to a declared order, once", () => {
    const term = (name: string, direction: "asc" | "desc") => ({
      path: [{ name, collection: false }],
      direction,
    });
    expect(readOrderFor([term("total", "desc")])).toEqual([
      { field: "total", direction: "desc" },
      { field: "id", direction: "asc" },
    ]);
    expect(readOrderFor([term("id", "desc")])).toEqual([{ field: "id", direction: "desc" }]);
  });
});

const POLY = `
system Poly {
  subdomain D {
    context Fleet {
      abstract aggregate Vehicle inheritanceUsing: sharedTable with softDeletable { name: string }
      aggregate Car extends Vehicle { seats: int  filter this.seats > 0 }
      aggregate Truck extends Vehicle { payload: int }
      abstract aggregate Party inheritanceUsing: ownTable { name: string }
      aggregate Person extends Party { age: int  filter this.age > 0 }
      aggregate Company extends Party { size: int }
      repository Cars for Car { }
      repository Trucks for Truck { }
      repository People for Person { }
      repository Companies for Company { }
    }
  }
  storage primary { type: postgres }
  resource st { for: Fleet, kind: state, use: primary }
  deployable api { platform: node contexts: [Fleet] dataSources: [st] port: 3000 }
}`;

async function polyPool(): Promise<EnrichedAggregateIR[]> {
  const loom = await buildLoomModel(POLY);
  return enrichedContexts(loom).find((c) => c.name === "Fleet")!.aggregates;
}

describe("polymorphicReadFor — the polymorphic base read", () => {
  it("TPH: the root's restrictions, each subtype's guarded, every variant tagged", async () => {
    const aggs = await polyPool();
    const read = polymorphicReadFor(named(aggs, "Vehicle"), aggs)!;
    expect(read.layout).toBe("sharedTable");
    expect(read.restrictions.map((r) => [r.kind, r.capability])).toEqual([
      ["capability", "softDeletable"],
    ]);
    expect(
      read.subtypeRestrictions.map((g) => [
        g.discriminator,
        g.restriction.kind,
        g.restriction.declaredOn,
      ]),
    ).toEqual([["Car", "filter", "Car"]]);
    expect(read.variants.map((v) => [v.aggregate, v.tag, v.discriminator])).toEqual([
      ["Car", "Car", "Car"],
      ["Truck", "Truck", "Truck"],
    ]);
    expect(read.order).toEqual([{ field: "id", direction: "asc" }]);
  });

  it("TPH: `ignoring` drops the root's capability and keeps the bare subtype filter", async () => {
    const aggs = await polyPool();
    const read = polymorphicReadFor(named(aggs, "Vehicle"), aggs, {
      ignoring: { bypassCaps: ["softDeletable"] },
    })!;
    expect(read.restrictions).toEqual([]);
    expect(read.subtypeRestrictions).toHaveLength(1);
  });

  it("TPC: no base table — each variant carries its own full scope", async () => {
    const aggs = await polyPool();
    const read = polymorphicReadFor(named(aggs, "Party"), aggs)!;
    expect(read.layout).toBe("ownTable");
    expect(read.restrictions).toEqual([]);
    expect(read.subtypeRestrictions).toEqual([]);
    expect(
      read.variants.map((v) => [v.tag, v.discriminator, v.scope.restrictions.map((r) => r.kind)]),
    ).toEqual([
      ["Person", undefined, ["filter"]],
      ["Company", undefined, []],
    ]);
  });

  it("is undefined for a concrete", async () => {
    const aggs = await polyPool();
    expect(polymorphicReadFor(named(aggs, "Car"), aggs)).toBeUndefined();
    expect(polymorphicReadFor(named(aggs, "Person"), aggs)).toBeUndefined();
  });
});
