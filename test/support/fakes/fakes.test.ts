// The Node fake-service kit: the restApi transport, the effect normalisation
// the wire golden diffs, quiescence, and the model-derived plan.  The Mailpit
// sidecar needs docker and is proved by mailpit-sidecar.test.ts.
// The models' own semantics are the emulation contract's (test/emulation/).

import { describe, expect, it } from "vitest";
import { start as startHttp } from "./http.mjs";
import { diffEffects, mayNeedSidecars, plannedFakes, quiesce } from "./index.mjs";

describe("restApi recorder", () => {
  it("answers through the core mock and records method, path and the run-stable body", async () => {
    const http = await startHttp({ resources: [{ name: "crm" }] });
    try {
      expect(Object.keys(http.env)).toEqual(["CRM_URL"]);
      const r = await fetch(`${http.url}/pings?x=1`, {
        method: "POST",
        body: JSON.stringify({ id: "random", b: 1 }),
      });
      expect(r.status).toBe(200);
      await fetch(`${http.url}/customers`);
      await fetch(`${http.url}/one`, { method: "POST", body: '"a@x"' });
      expect(http.observe()).toEqual([
        { method: "GET", path: "/customers", body: null },
        { method: "POST", path: "/one", body: "a@x" },
        { method: "POST", path: "/pings?x=1", body: { keys: ["b", "id"] } },
      ]);
    } finally {
      await http.stop();
    }
  });
});

describe("effects", () => {
  it("quiesce waits for two equal snapshots", async () => {
    let n = 0;
    const r = await quiesce(() => Math.min(++n, 3), { intervalMs: 1 });
    expect(r).toMatchObject({ value: 3, settled: true });
  });

  it("diffEffects names each divergence", () => {
    const golden = { mail: [{ to: ["a@x"], subject: "Hi" }] };
    expect(diffEffects(golden, golden)).toEqual([]);
    expect(diffEffects(golden, { mail: [{ to: ["a@x"], subject: "Ho" }] })).toEqual([
      { path: "$.mail[0].subject", golden: "Hi", actual: "Ho" },
    ]);
    expect(diffEffects(golden, {})).toEqual([
      { path: "$.mail", golden: golden.mail, actual: undefined },
    ]);
    expect(diffEffects(golden, { mail: [] })).toEqual([
      { path: "$.mail.length", golden: 1, actual: 0 },
    ]);
    expect(diffEffects(undefined, {})).toEqual([]);
  });

  it("the plan is read off the model: one fake per fakeable storage a deployable hosts", () => {
    const loom = {
      systems: [
        {
          deployables: [{ dataSourceNames: ["st", "crm", "mail", "mail2"] }],
          storages: [
            { name: "pg", type: "postgres" },
            { name: "api", type: "restApi" },
            { name: "box", type: "smtp" },
            { name: "files", type: "s3" },
          ],
          dataSources: [
            { name: "st", storageName: "pg" },
            { name: "crm", storageName: "api" },
            { name: "mail", storageName: "box" },
            { name: "mail2", storageName: "box" },
            { name: "unhosted", storageName: "files" },
          ],
        },
      ],
    };
    const plan = plannedFakes(loom);
    expect(plan.map((p) => [p.type, p.resources.map((r: { name: string }) => r.name)])).toEqual([
      ["restApi", ["crm"]],
      ["smtp", ["mail", "mail2"]],
    ]);
    expect(mayNeedSidecars("storage m { type: smtp }")).toBe(true);
    expect(mayNeedSidecars("storage p { type: postgres }")).toBe(false);
  });
});
