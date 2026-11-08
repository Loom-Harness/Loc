import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { composeServiceEnv } from "../../web/src/build/deployables.js";
import type { DispatchResult, SerializedRequest } from "../../web/src/runtime/protocol.js";
import { serviceFetch } from "../../web/src/runtime/service-fetch.js";
import { generateSystemFiles } from "../_helpers/generate.js";

// ---------------------------------------------------------------------------
// Backend→backend HTTP in the playground: each deployable boots with its
// compose service's env, and a request to another deployable's compose
// address is routed to that deployable's app instead of the network.
// ---------------------------------------------------------------------------

const API_CALL = readFileSync(
  path.resolve(__dirname, "../fixtures/corpus/api-call.ddd"),
  "utf8",
).replaceAll("__PLATFORM__", "node");

describe("composeServiceEnv", () => {
  it("reads the caller's api address and not the callee's, per service", async () => {
    const compose = (await generateSystemFiles(API_CALL)).get("docker-compose.yml") ?? "";
    const caller = composeServiceEnv(compose, "shipping_svc");
    expect(caller.ORDERS_URL).toBe("http://orders_svc:3000");
    expect(caller.LOG_LEVEL).toBe("info");
    // The callee neither sees the caller's variable nor a compose-only
    // database address.
    const callee = composeServiceEnv(compose, "orders_svc");
    expect(callee.ORDERS_URL).toBeUndefined();
    expect(caller.DATABASE_URL).toBeUndefined();
  });

  it("is empty for a service the file does not declare", () => {
    expect(composeServiceEnv("services:\n  a:\n    build: .\n", "b")).toEqual({});
  });
});

describe("serviceFetch", () => {
  const ok = (body: string, status = 200): DispatchResult => ({
    ok: true,
    response: { status, statusText: "", headers: { "content-type": "application/json" }, body },
    durationMs: 0,
  });

  it("routes a compose address to its deployable and anything else to the network", async () => {
    const forwarded: Array<{ host: string; req: SerializedRequest }> = [];
    const real = (async () => new Response("network")) as unknown as typeof fetch;
    const f = serviceFetch(
      new Set(["orders_svc"]),
      async (host, req) => {
        forwarded.push({ host, req });
        return ok('{"code":"A-1"}');
      },
      real,
    );
    const hit = await f(new URL("/orders/1", "http://orders_svc:3000"));
    expect(await hit.json()).toEqual({ code: "A-1" });
    expect(forwarded[0]?.host).toBe("orders_svc");
    expect(new URL(forwarded[0]?.req.url ?? "").pathname).toBe("/orders/1");

    const post = await f("http://orders_svc:3000/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "x" }),
    });
    expect(post.status).toBe(200);
    expect(forwarded[1]?.req).toMatchObject({ method: "POST", body: '{"code":"x"}' });

    // Not a booted deployable: the real fetch.
    expect(await (await f("http://localhost:3000/x")).text()).toBe("network");
    expect(await (await f("https://orders_svc/x")).text()).toBe("network");
    expect(forwarded).toHaveLength(2);
  });

  it("a failed dispatch is a network error to the caller", async () => {
    const f = serviceFetch(
      new Set(["b"]),
      async () => ({ ok: false, message: 'No booted deployable "b".' }),
      fetch,
    );
    await expect(f("http://b:3000/")).rejects.toThrow(/No booted deployable/);
  });
});
