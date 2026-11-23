// The entry-surface plan (`src/ir/plan/entry-surface.ts`): what it records for
// each entry — role, principal, tenancy stance and gates.  Which entries exist
// is the census's business (`test/system/entry-surface-census.test.ts`
// compares the list with every backend's generated tree); these cases pin the
// facts the promise probes read off each entry.

import { describe, expect, it } from "vitest";
import {
  ENTRY_KINDS,
  type Entry,
  type EntrySurface,
  entrySurface,
  httpEntries,
} from "../../../src/ir/plan/entry-surface.js";
import { buildLoomModel } from "../../_helpers/index.js";
import { corpusSourceFor } from "../../fixtures/corpus/harness.js";

async function surfaceOf(feature: string, deployable = "d"): Promise<EntrySurface> {
  const loom = await buildLoomModel(corpusSourceFor(feature, "node"));
  for (const sys of loom.systems) {
    const d = sys.deployables.find((x) => x.name === deployable);
    if (!d) continue;
    const contexts = sys.subdomains
      .flatMap((s) => s.contexts)
      .filter((c) => d.contextNames.includes(c.name));
    return entrySurface({ deployable: d, contexts, sys });
  }
  throw new Error(`no deployable ${deployable} in ${feature}`);
}

const at = (s: EntrySurface, method: string, path: string): Entry => {
  const e = httpEntries(s).find((x) => x.trigger.method === method && x.trigger.path === path);
  if (!e) throw new Error(`no ${method} ${path}`);
  return e;
};

describe("entrySurface", () => {
  it("gives every entry the role its kind has", async () => {
    const s = await surfaceOf("channels-broker-mixed-durable");
    for (const e of s.entries) expect(e.role).toBe(ENTRY_KINDS[e.kind].role);
    expect(s.entries.length).toBeGreaterThan(0);
  });

  it("runs the api as the signed-in caller and the probes before sign-in", async () => {
    const s = await surfaceOf("audit-history-guarded");
    expect(at(s, "get", "/health")).toMatchObject({
      principal: "anonymous",
      role: "infrastructure",
    });
    expect(at(s, "post", "/__test/reset").principal).toBe("anonymous");
    expect(at(s, "get", "/api/auth/me")).toMatchObject({
      principal: "caller",
      role: "infrastructure",
    });
    expect(at(s, "post", "/api/employees")).toMatchObject({
      kind: "create",
      principal: "caller",
      role: "api",
    });
  });

  it("carries an operation's `requires` and leaves an ungated one empty", async () => {
    const s = await surfaceOf("audit-history-guarded");
    expect(at(s, "post", "/api/employees/{id}/promote").gates).toHaveLength(1);
    // `raise` writes the masked `salary`, so it also evaluates the mask's
    // write gate enrichment derives.
    expect(at(s, "post", "/api/employees/{id}/raise").gates).toHaveLength(2);
    expect(at(s, "post", "/api/employees/{id}/rename").gates).toEqual([]);
  });

  it("records an aggregate route's tenancy stance and no tenant frame for the probes", async () => {
    const s = await surfaceOf("cache-by-id");
    expect(at(s, "get", "/api/items/{id}").tenancy).toBe("tenantOwned");
    expect(at(s, "get", "/health").tenancy).toBe("none");
  });

  it("runs every non-HTTP entry as the system principal", async () => {
    const s = await surfaceOf("channels-broker-mixed-durable");
    const internal = s.entries.filter((e) => e.role === "internal");
    expect(new Set(internal.map((e) => e.kind))).toEqual(
      new Set(["workflowEventStart", "outboxRelay", "inboxPurge"]),
    );
    for (const e of internal) expect(e.principal).toBe("system");
  });

  it("lists no sign-in routes on a deployable that does not require sign-in", async () => {
    const s = await surfaceOf("channels-broker-mixed-durable");
    expect(s.entries.some((e) => e.kind.startsWith("auth"))).toBe(false);
    expect(at(s, "get", "/health").principal).toBe("anonymous");
  });
});
