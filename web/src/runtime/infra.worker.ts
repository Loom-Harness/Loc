/// <reference lib="webworker" />
// The playground's shared infrastructure — what `docker-compose.yml` runs
// beside the application services: one database per `storage`, each in its
// own storage host worker (`storage-host.worker.ts`), and the services of
// `infra/services.ts` (the message broker, …).
//
// Deployable workers hold no infrastructure state: they reach a storage
// through the `channel` its `open` returns, and every other service through
// their `InfraPort` — the `MessagePort` the `connect` op hands over.  See
// `infra-protocol.ts`.

import type {
  HostControl,
  HostInitOptions,
  HostProgress,
  HostRequest,
  HostResponse,
  InfraProgress,
  InfraRequest,
  InfraResponse,
  StorageOp,
  StorageOpenResult,
} from "./infra-protocol.js";
import { createServices } from "./infra/services.js";
import type { InfraPush } from "./infra/service.js";
import { errText } from "./migrate.js";

declare const self: DedicatedWorkerGlobalScope;

/** Unique per infra worker, so two playground tabs (or a respawned infra
 *  worker) never answer each other's broadcast channels. */
const instance = crypto.randomUUID();
let generation = 0;

class StorageHost {
  private nextId = 1;
  private readonly pending = new Map<number, (res: HostResponse) => void>();

  private constructor(
    readonly key: string,
    readonly channel: string,
    private readonly worker: Worker,
  ) {
    worker.addEventListener("message", (ev: MessageEvent) => {
      const msg = ev.data as HostResponse | HostProgress | { type?: string };
      if (msg?.type === "loom-host-ret") {
        const res = msg as HostResponse;
        this.pending.get(res.id)?.(res);
        this.pending.delete(res.id);
      } else if (msg?.type === "loom-host-progress") {
        const p = msg as HostProgress;
        self.postMessage({ phase: p.phase, note: p.note, storage: key } satisfies InfraProgress);
      }
    });
  }

  /** Spawn the host and run PGlite's handshake with it: it announces `here`,
   *  takes the init options, and opens the database. */
  static async spawn(key: string, dataDir?: string, fresh?: boolean): Promise<StorageHost> {
    const channel = `loom-storage:${instance}:${++generation}:${key}`;
    const worker = new Worker(new URL("./storage-host.worker.ts", import.meta.url), {
      type: "module",
    });
    await new Promise<void>((resolve, reject) => {
      worker.addEventListener("error", (ev) => reject(new Error(ev.message || "storage host failed to load")), {
        once: true,
      });
      worker.addEventListener("message", function here(ev: MessageEvent) {
        if ((ev.data as { type?: string })?.type !== "here") return;
        worker.removeEventListener("message", here);
        resolve();
      });
    });
    const options: HostInitOptions = { id: channel, dataDir, fresh };
    worker.postMessage({ type: "init", options });
    return new StorageHost(key, channel, worker);
  }

  call<T>(control: HostControl): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, (res) =>
        res.error !== undefined ? reject(new Error(res.error)) : resolve(res.result as T),
      );
      this.worker.postMessage({ type: "loom-host", id, ...control } satisfies HostRequest);
    });
  }

  /** Close the database (so an OPFS island is released cleanly), then end the
   *  host.  Bounded: a wedged host is terminated regardless. */
  async close(): Promise<void> {
    await Promise.race([
      this.call({ op: "close" }).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
    this.worker.terminate();
    for (const settle of this.pending.values()) {
      settle({ type: "loom-host-ret", id: 0, error: "Storage closed." });
    }
    this.pending.clear();
  }
}

const storages = new Map<string, StorageHost>();

function host(key: string): StorageHost {
  const h = storages.get(key);
  if (!h) throw new Error(`Storage "${key}" is not open.`);
  return h;
}

async function storage(req: StorageOp): Promise<InfraResponse["result"]> {
  switch (req.op) {
    case "open": {
      const { key, dataDir, fresh } = req.params;
      await storages.get(key)?.close();
      storages.delete(key);
      let h: StorageHost;
      try {
        h = await StorageHost.spawn(key, dataDir, fresh);
      } catch (err) {
        return { ok: false, message: `Storage "${key}" failed to start: ${errText(err)}` };
      }
      try {
        const { persistent } = await h.call<{ persistent: boolean }>({ op: "status" });
        storages.set(key, h);
        return { ok: true, channel: h.channel, persistent } satisfies StorageOpenResult;
      } catch (err) {
        await h.close();
        return { ok: false, message: `PGlite boot failed: ${errText(err)}` };
      }
    }
    case "migrate":
      return host(req.params.key).call({ op: "migrate", plan: req.params.plan });
    case "query":
      return storages.has(req.params.key)
        ? host(req.params.key).call({ op: "query", sql: req.params.sql })
        : { ok: false, message: "Runtime not booted — boot first." };
    case "wipe":
      return storages.has(req.params.key)
        ? host(req.params.key).call({ op: "wipe" })
        : { ok: false, message: "Runtime not booted — nothing to wipe." };
    case "close":
      await storages.get(req.params.key)?.close();
      storages.delete(req.params.key);
      return { ok: true };
  }
}

/** Connected deployables, by slug: the infra end of each one's `InfraPort`. */
const clients = new Map<string, MessagePort>();

const services = createServices({
  push(client: string, message: InfraPush) {
    clients.get(client)?.postMessage(message);
  },
});

function disconnect(client: string): void {
  const port = clients.get(client);
  if (!port) return;
  clients.delete(client);
  port.close();
  for (const svc of services.values()) svc.disconnect?.(client);
}

async function handle(req: InfraRequest, client: string | null, ports: readonly MessagePort[]): Promise<unknown> {
  if (req.service === "storage") {
    if (client !== null) throw new Error("A deployable reaches its storage through PGliteWorker, not the infra port.");
    return storage(req);
  }
  if (req.service === "infra") {
    if (client !== null) throw new Error(`infra.${req.op} is for the main thread only.`);
    switch (req.op) {
      case "reset":
        for (const slug of [...clients.keys()]) disconnect(slug);
        await Promise.all([...storages.values()].map((h) => h.close()));
        storages.clear();
        for (const svc of services.values()) await svc.reset();
        return { ok: true };
      case "connect": {
        const port = ports[0];
        if (!port) throw new Error("infra.connect needs a transferred MessagePort.");
        const slug = req.params.client;
        disconnect(slug);
        clients.set(slug, port);
        port.onmessage = (msg: MessageEvent<InfraRequest>) => void serve(msg.data, slug, [], port);
        return { ok: true };
      }
      case "disconnect":
        disconnect(req.params.client);
        return { ok: true };
    }
  }
  const svc = services.get(req.service);
  if (!svc) throw new Error(`Unknown infra service "${(req as { service: string }).service}".`);
  return svc.handle(req, { client });
}

async function serve(
  req: InfraRequest,
  client: string | null,
  ports: readonly MessagePort[],
  reply: { postMessage(msg: InfraResponse): void },
): Promise<void> {
  const response: InfraResponse = { id: req.id };
  try {
    response.result = await handle(req, client, ports);
  } catch (err) {
    response.error = { message: errText(err) };
  }
  reply.postMessage(response);
}

self.onmessage = (ev: MessageEvent<InfraRequest>) => void serve(ev.data, null, ev.ports, self);
