// A deployable worker's line to the infra services: the `MessagePort` the
// engine handed over at `start` (see `infra-protocol.ts` → `connect`).
// Requests are the infra protocol's `{ id, service, op, params }`; the infra
// worker answers each with `{ id, result | error }` and may push unasked
// messages tagged `{ push: <service> }` (broker deliveries).
//
// Holds no infrastructure state — only the calls in flight.

import type { InfraRequest, InfraResponse } from "./infra-protocol.js";
import type { InfraPush } from "./infra/service.js";

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

export class InfraPort {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readonly listeners = new Map<string, (msg: InfraPush) => void>();
  private closed = false;

  constructor(private readonly port: MessagePort) {
    port.onmessage = (ev: MessageEvent<InfraResponse | InfraPush>) => {
      const msg = ev.data;
      if ("push" in msg) {
        this.listeners.get(msg.push)?.(msg);
        return;
      }
      const slot = this.pending.get(msg.id);
      if (!slot) return;
      this.pending.delete(msg.id);
      if (msg.error) slot.reject(new Error(msg.error.message));
      else slot.resolve(msg.result ?? null);
    };
  }

  call<T>(req: DistributiveOmit<InfraRequest, "id">): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Infra port closed."));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject });
      this.port.postMessage({ id, ...req } as InfraRequest);
    });
  }

  /** Receive one service's pushes (one listener per service). */
  onPush<M extends InfraPush>(service: string, fn: (msg: M) => void): void {
    this.listeners.set(service, fn as (msg: InfraPush) => void);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.port.close();
    for (const slot of this.pending.values()) slot.reject(new Error("Infra port closed."));
    this.pending.clear();
    this.listeners.clear();
  }
}
