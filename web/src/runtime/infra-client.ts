// Main-thread client of the infra worker (see infra-protocol.ts).

import { type DiagPhase, markPhase } from "../util/diagnostics.js";
import type {
  InfraProgress,
  InfraRequest,
  InfraResponse,
  StorageMigrateResult,
  StorageOpenParams,
  StorageOpenResult,
  StorageSchemaPlan,
} from "./infra-protocol.js";
import type { QueryResult, WipeResult } from "./protocol.js";

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

export class InfraClient {
  private worker!: Worker;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private disposed = false;

  constructor() {
    this.spawn();
  }

  private spawn(): void {
    this.worker = new Worker(new URL("./infra.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (ev: MessageEvent<InfraResponse | InfraProgress>) => {
      if ("phase" in ev.data) {
        // Same tombstone trail as a deployable's boot (see RuntimeProgress).
        markPhase(`boot:${ev.data.phase}` as DiagPhase, `${ev.data.storage}${ev.data.note ? `: ${ev.data.note}` : ""}`);
        return;
      }
      const msg = ev.data;
      const slot = this.pending.get(msg.id);
      if (!slot) return;
      this.pending.delete(msg.id);
      if (msg.error) slot.reject(new Error(msg.error.message));
      else slot.resolve(msg.result ?? null);
    };
  }

  private send<T>(req: DistributiveOmit<InfraRequest, "id">): Promise<T> {
    if (this.disposed) return Promise.reject(new Error("InfraClient: disposed"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject });
      this.worker.postMessage({ id, ...req } as InfraRequest);
    });
  }

  openStorage(params: StorageOpenParams): Promise<StorageOpenResult> {
    return this.send({ service: "storage", op: "open", params });
  }

  migrateStorage(key: string, plan: StorageSchemaPlan): Promise<StorageMigrateResult> {
    return this.send({ service: "storage", op: "migrate", params: { key, plan } });
  }

  query(key: string, sql: string): Promise<QueryResult> {
    return this.send({ service: "storage", op: "query", params: { key, sql } });
  }

  wipe(key: string): Promise<WipeResult> {
    return this.send({ service: "storage", op: "wipe", params: { key } });
  }

  /** Close every storage. */
  reset(): Promise<{ ok: true }> {
    return this.send({ service: "infra", op: "reset", params: {} });
  }

  /** Terminate the worker (and with it every storage host) and start a fresh
   *  one.  Pending calls are rejected. */
  respawn(): void {
    if (this.disposed) return;
    try {
      this.worker.terminate();
    } catch {
      /* terminate on a dead worker can throw; ignore */
    }
    for (const slot of this.pending.values()) {
      slot.reject(new Error("Infra worker respawned; retry the operation."));
    }
    this.pending.clear();
    this.spawn();
  }

  dispose(): void {
    this.disposed = true;
    try {
      this.worker.terminate();
    } catch {
      /* ignore */
    }
    for (const slot of this.pending.values()) slot.reject(new Error("Infra client disposed"));
    this.pending.clear();
  }
}
