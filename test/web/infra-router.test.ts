import { describe, expect, it } from "vitest";
import { InfraRouter } from "../../web/src/runtime/infra/router.js";
import type {
  InfraPush,
  InfraService,
  InfraServiceHost,
} from "../../web/src/runtime/infra/service.js";
import { InfraPort } from "../../web/src/runtime/infra-port.js";
import type { InfraRequest, InfraResponse } from "../../web/src/runtime/infra-protocol.js";

// The infra worker's service registry and each deployable's `InfraPort`,
// driven over a real MessageChannel with a stand-in service.  Real services
// (the broker, the resource fakes) register the same way in
// web/src/runtime/infra/services.ts.

type EchoOp = { op: "echo"; params: { text: string } } | { op: "poke"; params: { text: string } };

interface Probe {
  calls: { op: string; client: string | null }[];
  disconnected: string[];
  storageDetached: string[];
  resets: number;
}

function echoService(host: InfraServiceHost, probe: Probe): InfraService<EchoOp> {
  return {
    name: "echo",
    handle(req, { client }) {
      probe.calls.push({ op: req.op, client });
      if (req.op === "poke" && client !== null)
        host.push(client, { push: "echo", text: req.params.text } as InfraPush);
      return { text: req.params.text, client };
    },
    disconnect(client) {
      probe.disconnected.push(client);
    },
    reset() {
      probe.resets++;
    },
  };
}

function setup() {
  const probe: Probe = { calls: [], disconnected: [], storageDetached: [], resets: 0 };
  let storagesClosed = 0;
  const router = new InfraRouter({
    createServices: (host) => new Map([["echo", echoService(host, probe)]]),
    storage: async () => ({ ok: true }),
    detachStorages: async (client) => {
      probe.storageDetached.push(client);
    },
    closeStorages: async () => {
      storagesClosed++;
    },
  });
  /** The main thread's side: one request, answered on a capture. */
  const main = async (
    req: Record<string, unknown>,
    ports: MessagePort[] = [],
  ): Promise<InfraResponse> => {
    let out: InfraResponse | undefined;
    await router.serve({ id: 1, ...req } as unknown as InfraRequest, null, ports, {
      postMessage: (m) => {
        out = m;
      },
    });
    return out as InfraResponse;
  };
  /** Connect a deployable: the router keeps port1, the deployable wraps port2. */
  const connect = async (slug: string): Promise<InfraPort> => {
    const { port1, port2 } = new MessageChannel();
    const res = await main({ service: "infra", op: "connect", params: { client: slug } }, [port1]);
    expect(res.error).toBeUndefined();
    return new InfraPort(port2);
  };
  return { probe, router, main, connect, storagesClosed: () => storagesClosed };
}

describe("infra router + InfraPort", () => {
  it("routes a deployable's call to its service, stamped with the deployable", async () => {
    const { probe, connect } = setup();
    const port = await connect("admin");
    await expect(
      port.call({ service: "echo", op: "echo", params: { text: "hi" } } as never),
    ).resolves.toEqual({
      text: "hi",
      client: "admin",
    });
    expect(probe.calls).toEqual([{ op: "echo", client: "admin" }]);
    port.close();
  });

  it("delivers a service's push to that deployable only", async () => {
    const { connect } = setup();
    const admin = await connect("admin");
    const shop = await connect("shop");
    const got: Record<string, unknown[]> = { admin: [], shop: [] };
    admin.onPush("echo", (m) => got.admin?.push(m));
    shop.onPush("echo", (m) => got.shop?.push(m));
    await admin.call({ service: "echo", op: "poke", params: { text: "ping" } } as never);
    await new Promise((r) => setTimeout(r, 20));
    expect(got).toEqual({ admin: [{ push: "echo", text: "ping" }], shop: [] });
    admin.close();
    shop.close();
  });

  it("refuses storage and infra ops over a deployable's port, and unknown services", async () => {
    const { connect, main } = setup();
    const port = await connect("admin");
    await expect(
      port.call({ service: "storage", op: "wipe", params: { key: "k" } }),
    ).rejects.toThrow(/storage port/);
    await expect(port.call({ service: "infra", op: "reset", params: {} })).rejects.toThrow(
      /main thread only/,
    );
    expect((await main({ service: "nope", op: "x", params: {} })).error?.message).toMatch(
      /Unknown infra service/,
    );
    port.close();
  });

  it("disconnect and reset reach every service; reset closes the storages", async () => {
    const { probe, connect, main, storagesClosed } = setup();
    const port = await connect("admin");
    await main({ service: "infra", op: "disconnect", params: { client: "admin" } });
    expect(probe.disconnected).toEqual(["admin"]);
    expect(probe.storageDetached).toEqual(["admin"]);
    await connect("shop");
    await main({ service: "infra", op: "reset", params: {} });
    expect(probe.disconnected).toEqual(["admin", "shop"]);
    expect(probe.resets).toBe(1);
    expect(storagesClosed()).toBe(1);
    port.close();
  });
});
