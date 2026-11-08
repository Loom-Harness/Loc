/// <reference lib="webworker" />
// The playground's shared infrastructure — what `docker-compose.yml` runs
// beside the application services.  Today: one database per `storage`, each in
// its own storage host worker (`storage-host.worker.ts`).  Broker state and the
// resource fakes join here as further `service`s of the same protocol.
//
// Deployable workers hold no infrastructure state: they reach a storage
// through the `channel` its `open` returns.  See `infra-protocol.ts`.

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

self.onmessage = async (ev: MessageEvent<InfraRequest>) => {
  const req = ev.data;
  const response: InfraResponse = { id: req.id };
  try {
    if (req.service === "storage") {
      response.result = await storage(req);
    } else if (req.op === "reset") {
      await Promise.all([...storages.values()].map((h) => h.close()));
      storages.clear();
      response.result = { ok: true };
    }
  } catch (err) {
    response.error = { message: errText(err) };
  }
  self.postMessage(response);
};
