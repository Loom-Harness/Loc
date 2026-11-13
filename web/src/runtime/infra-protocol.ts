// The infra worker's protocol — the playground's shared infrastructure, the
// browser twin of the non-application services in `docker-compose.yml`.
//
//   main thread ──► infra worker ──► storage host worker (one per storage)
//                    └─ registered services (infra/services.ts)
//   deployable worker ── InfraPort (MessagePort) ──► infra worker
//
// Deployable workers reach a storage directly, over a storage port of their
// own that `storage.attach` hands to the storage host (see `storage-wire.ts`).
// The infra worker only owns lifecycle and the operations no deployable
// performs: opening a database, attaching and detaching its clients,
// migrating it, the Database console, Reset.
//
// Every message is plain, structured-clone data, so the same protocol can move
// to a SharedWorker (or across tabs) unchanged.  A new kind of infrastructure
// is a new `service` with its own ops; the envelope stays.

import type { BrokerOp } from "../../../src/emulation/broker-protocol.js";
import type { ResourceOp } from "./infra/resource-types.js";
import type { BootFail, MigrationPlan } from "./protocol.js";

/** The schema a storage is brought to: the recorded chain's units for the
 *  modules it holds, or — for a source without a system — the Drizzle-derived
 *  DDL a deployable worker synthesised from its bundle. */
export type StorageSchemaPlan =
  | Extract<MigrationPlan, { kind: "chain" }>
  | { kind: "ddl"; ddl: string };

export interface StorageOpenParams {
  /** The storage's key (`StoragePlan.key`). */
  key: string;
  /** PGlite data dir: `:memory:` (default) or `opfs-ahp://<island>`. */
  dataDir?: string;
  /** Explicit reset: drop every user schema and the bookkeeping right after
   *  the database opens, before anything reads it. */
  fresh?: boolean;
}

export interface StorageOpenOk {
  ok: true;
  /** False when the persistent data dir was refused and the storage fell back
   *  to memory. */
  persistent: boolean;
}

export type StorageOpenResult = StorageOpenOk | { ok: false; message: string };

export interface StorageMigrateOk {
  ok: true;
  /** The SQL the schema was built from. */
  ddl: string;
  /** Ids of the units this migration applied. */
  applied: string[];
}

export type StorageMigrateResult = StorageMigrateOk | BootFail;

export type StorageOp =
  | { op: "open"; params: StorageOpenParams }
  /** Attach a deployable to the storage: the request carries one end of a
   *  `MessageChannel` (transferred) for the storage host; the deployable
   *  holds the other as its `StorageClient`. */
  | { op: "attach"; params: { key: string; client: string } }
  | { op: "migrate"; params: { key: string; plan: StorageSchemaPlan } }
  | { op: "query"; params: { key: string; sql: string } }
  | { op: "wipe"; params: { key: string } }
  | { op: "close"; params: { key: string } };

export type InfraOp =
  | { op: "reset"; params: Record<string, never> }
  /** Back the resource fakes (S3 objects, disk files, the Mailbox) with the
   *  durable store of `island` and load it; null → memory only.  `fresh`
   *  empties the store first. */
  | { op: "configure"; params: { island: string | null; fresh?: boolean } }
  /** Empty the resource fakes, durable copy included. */
  | { op: "wipeResources"; params: Record<string, never> }
  /** Attach a deployable: the request carries one end of a `MessageChannel`
   *  (transferred); the deployable holds the other as its `InfraPort`. */
  | { op: "connect"; params: { client: string } }
  /** The deployable stopped or its worker ended: its infra port closes and
   *  its storage clients are dropped (an open transaction rolls back). */
  | { op: "disconnect"; params: { client: string } };

/** Every service's ops, by service name.  A new infra service adds one line
 *  here and one in `infra/services.ts` (see `infra/service.ts`). */
export interface InfraServiceOps {
  storage: StorageOp;
  infra: InfraOp;
  broker: BrokerOp;
  s3: ResourceOp;
  ses: ResourceOp;
  mailbox: ResourceOp;
  disk: ResourceOp;
  httpMock: ResourceOp;
}

type ServiceRequest<S extends keyof InfraServiceOps> = S extends keyof InfraServiceOps
  ? { service: S } & InfraServiceOps[S]
  : never;

/** One request, from the main thread or (over an `InfraPort`) from a
 *  deployable. */
export type InfraRequest = { id: number } & ServiceRequest<keyof InfraServiceOps>;

export interface InfraResponse {
  id: number;
  result?: unknown;
  error?: { message: string };
}

/** A boot-progress note from a storage host, relayed to the main thread (see
 *  `RuntimeProgress` for why boot is instrumented step by step). */
export interface InfraProgress {
  phase: "pglite-assets" | "pglite-construct" | "ddl-meta" | "ddl-drop" | "ddl-apply";
  storage: string;
  note?: string;
}

// -- infra worker ↔ storage host ---------------------------------------------
// The host announces `here` once loaded and opens the database on `init`;
// every later message is a `HostRequest`.

export type HostControl =
  | { op: "status" }
  /** Carries the deployable's storage port (transferred). */
  | { op: "attach"; client: string }
  | { op: "detach"; client: string }
  | { op: "migrate"; plan: StorageSchemaPlan }
  | { op: "query"; sql: string }
  | { op: "wipe" }
  | { op: "close" };

export type HostRequest = { type: "loom-host"; id: number } & HostControl;

export interface HostResponse {
  type: "loom-host-ret";
  id: number;
  result?: unknown;
  error?: string;
}

export interface HostProgress {
  type: "loom-host-progress";
  phase: InfraProgress["phase"];
  note?: string;
}

/** Init options the infra worker hands the host in its `init` message. */
export interface HostInitOptions {
  dataDir?: string;
  fresh?: boolean;
}
