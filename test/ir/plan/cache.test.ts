// The by-id cache plan (`src/ir/plan/cache.ts`): which reads are cached, the
// scope inputs their key carries, ttl / keyPrefix, and which writes evict.
// Pure IR facts, so pinned here; hits, eviction and isolation at run time are
// the `cache-by-id` corpus fixture's.

import { describe, expect, it } from "vitest";
import { cachePlanFor, DEFAULT_CACHE_TTL_SECONDS } from "../../../src/ir/plan/cache.js";
import { buildLoomModel } from "../../_helpers/ir.js";

const SRC = `
system C {
  user { id: string  tenantId: string  role: string }
  tenancy by user.tenantId of Org
  subdomain Core {
    context Main {
      aggregate Org with crudish { name: string }
      aggregate Plan crossTenant with crudish { code: string }
      aggregate Note with tenantOwned, auditable, crudish {
        body: string
        secret: string mask unless currentUser.role == "manager"
      }
      aggregate Doc with tenantOwned, softDeletable, crudish { title: string }
      aggregate Share with tenantOwned, crudish { doc: Doc id  grantee: string }
      aggregate Shared with tenantOwned, crudish { title: string }
      policy {
        allow own on Note when currentUser.role == "clerk"
        allow on Shared as s where exists Share as x where x.grantee == currentUser.tenantId
      }
    }
  }
  storage hot { type: redis }
  storage pg { type: postgres }
  resource st { for: Main, kind: state, use: pg }
  resource ca { for: Main, kind: cache, use: hot, keyPrefix: "app", ttl: 30 }
  deployable d { platform: node, contexts: [Main], dataSources: [st, ca], port: 3000, auth: required }
}
`;

async function plan() {
  const loom = await buildLoomModel(SRC);
  const sys = loom.systems[0]!;
  const ctx = sys.subdomains[0]!.contexts[0]!;
  return cachePlanFor(sys, ctx, sys.deployables[0]);
}

describe("cache plan", () => {
  it("keys each cached read by every principal member its scope, rungs and masks read", async () => {
    const { cached } = await plan();
    const scopeOf = (agg: string) =>
      cached
        .find((c) => c.aggregate === agg)
        ?.scope.map((s) => (s.kind === "claim" ? s.claim : "*"));
    // A crossTenant aggregate with no restriction shares one answer.
    expect(scopeOf("Plan")).toEqual([]);
    // The tenant floor reads the operating org; the rungs read role and id;
    // the mask reads role.
    expect(scopeOf("Note")).toEqual(expect.arrayContaining(["operatingOrg", "role", "id"]));
    expect(scopeOf("Doc")).toEqual(["operatingOrg"]);
  });

  it("honours ttl and keyPrefix, and versions the prefix by wire shape", async () => {
    const note = (await plan()).cached.find((c) => c.aggregate === "Note")!;
    expect(note.ttlSeconds).toBe(30);
    expect(note.entryPrefix).toMatch(/^app:note:[0-9a-f]{8}:$/);
    expect(note.storageType).toBe("redis");
    expect(note.evictOn).toEqual(["save", "delete"]);
  });

  it("does not cache a read whose scope reads other rows", async () => {
    const { cached, uncached } = await plan();
    expect(cached.map((c) => c.aggregate)).not.toContain("Shared");
    expect(uncached).toEqual([
      expect.objectContaining({ aggregate: "Shared", reason: "scope-reads-other-rows" }),
    ]);
  });

  it("defaults the ttl and the prefix", async () => {
    const loom = await buildLoomModel(
      SRC.replace(`, keyPrefix: "app", ttl: 30`, "").replace("type: redis", "type: inMemory"),
    );
    const sys = loom.systems[0]!;
    const note = cachePlanFor(sys, sys.subdomains[0]!.contexts[0]!).cached.find(
      (c) => c.aggregate === "Note",
    )!;
    expect(note.ttlSeconds).toBe(DEFAULT_CACHE_TTL_SECONDS);
    expect(note.entryPrefix).toMatch(/^c:main:note:[0-9a-f]{8}:$/);
    expect(note.storageType).toBe("inMemory");
  });
});
