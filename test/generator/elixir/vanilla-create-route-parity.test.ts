import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// Router ⟺ OpenAPI create-surface parity (vanilla Phoenix).
//
// Regression gate for a divergence where the vanilla backend GENERATED and
// DOCUMENTED a create endpoint but never ROUTED it: the router gated
// `POST /<plural>` on one predicate while the OpenAPI spec + controller used
// another.  The fix routes BOTH the route and the `post` operation off ONE
// shared predicate (`emitsRestCreate`).  These tests pin that they can never
// drift: every aggregate the router create-routes is create-documented, and
// vice versa.  (That the create, the paged list and the `tenantOwned` stamp
// work at all is asserted by value on the elixir behavioural leg — every corpus
// case creates and lists, and `corpus/tenancy-owned` stamps.)
//
// The create surface is now gated on an EXPLICIT canonical `create`
// (`emitsRestCreate` → `canonicalCreate != null`), symmetric with the DELETE
// gate — mere `isConstructible` no longer exposes a POST.  The fixture below
// therefore carries `with crudish` so `Order` has a canonical create; the
// parity assertions then exercise a create-bearing aggregate.  (A bare
// `aggregate Order { … }` with no create would correctly route NO POST and
// document none — parity still holds, but vacuously.)
// ---------------------------------------------------------------------------

/** Aggregates the router wires a `POST /<plural>` create route for. */
function routerCreateAggregates(router: string): Set<string> {
  const out = new Set<string>();
  for (const m of router.matchAll(/post\s+"\/\w+",\s+(\w+)Controller,\s+:create/g)) {
    out.add(m[1]!);
  }
  return out;
}

/** Aggregates the OpenAPI spec documents a `post` create operation for. */
function specCreateAggregates(spec: string): Set<string> {
  const out = new Set<string>();
  for (const m of spec.matchAll(/summary:\s+"Create (\w+)"/g)) {
    out.add(m[1]!);
  }
  return out;
}

function file(files: Map<string, string>, suffix: string): string {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return files.get(key!)!;
}

// A create-bearing aggregate (`with crudish` → canonical create).  Every
// backend exposes `POST /orders`; this pins that the vanilla router and its
// OpenAPI spec agree on that surface.
const BARE = `
system Shop {
  subdomain Sales {
    context Orders {
      aggregate Order with crudish {
        code: string
        region: string
      }
      repository Orders for Order {}
    }
  }
  api OrdersApi from Sales
  storage primary { type: postgres }
  resource ordersState { for: Orders, kind: state, use: primary }
  deployable api {
    platform: elixir
    contexts: [Orders]
    dataSources: [ordersState]
    serves: OrdersApi
    port: 4000
  }
}
`;

describe("vanilla create-route ⟺ OpenAPI parity", () => {
  it("documents the create in the OpenAPI spec for the same aggregate", async () => {
    const files = await generateSystemFiles(BARE);
    const specKey = [...files.keys()].find((k) => k.endsWith("_spec.ex") && k.includes("/api/"));
    const spec = files.get(specKey!)!;
    expect(spec).toContain('summary: "Create Order"');
  });

  it("router create-routes and OpenAPI create-docs are the same set", async () => {
    const files = await generateSystemFiles(BARE);
    const router = file(files, "/router.ex");
    const specKey = [...files.keys()].find((k) => k.endsWith("_spec.ex") && k.includes("/api/"));
    const spec = files.get(specKey!)!;
    expect([...routerCreateAggregates(router)].sort()).toEqual(
      [...specCreateAggregates(spec)].sort(),
    );
    expect(routerCreateAggregates(router)).toContain("Order");
  });

  it("parity holds across a multi-aggregate tenancy system (crudish + registry)", async () => {
    const src = readFileSync("test/fixtures/corpus/tenancy-owned.ddd", "utf8").replace(
      "__PLATFORM__",
      "elixir",
    );
    const files = await generateSystemFiles(src);
    const router = file(files, "/router.ex");
    const specKey = [...files.keys()].find((k) => k.endsWith("_spec.ex") && k.includes("/api/"));
    const spec = files.get(specKey!)!;
    const routed = routerCreateAggregates(router);
    const documented = specCreateAggregates(spec);
    expect([...routed].sort()).toEqual([...documented].sort());
    // Both the tenant-owned aggregate and the registry are constructible.
    expect(routed).toContain("Invoice");
    expect(routed).toContain("Organization");
  });
});
