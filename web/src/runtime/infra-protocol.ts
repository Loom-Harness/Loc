// The infra worker's protocol — the playground's shared infrastructure, the
// browser twin of the non-application services in `docker-compose.yml`.
//
//   main thread ──► infra worker ──► storage host worker (one per storage)
//                    ├─ broker state (infra/broker-model.ts)
//                    └─ further services (infra/services.ts)
//   deployable worker ── InfraPort (MessagePort) ──► infra worker
//
// Deployable workers reach a storage directly: each opens a `PGliteWorker`
// client on the storage's `channel` (see `storage-client.ts`), and the storage
// host serves it with PGlite's own leader half.  The infra worker only owns
// lifecycle and the operations no deployable performs: opening a database,
// migrating it, the Database console, Reset.
//
// Every message is plain, structured-clone data, so the same protocol can move
// to a SharedWorker (or across tabs) unchanged.  A new kind of infrastructure
// is a new `service` with its own ops; the envelope stays.

import type { BrokerOp } from "./infra/broker-protocol.js";
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
  /** What a deployable worker passes to its `PGliteWorker` client. */
  channel: string;
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
  | { op: "migrate"; params: { key: string; plan: StorageSchemaPlan } }
  | { op: "query"; params: { key: string; sql: string } }
  | { op: "wipe"; params: { key: string } }
  | { op: "close"; params: { key: string } };

export type InfraOp =
  | { op: "reset"; params: Record<string, never> }
  /** Attach a deployable: the request carries one end of a `MessageChannel`
   *  (transferred); the deployable holds the other as its `InfraPort`. */
  | { op: "connect"; params: { client: string } }
  | { op: "disconnect"; params: { client: string } };

/** Every service's ops, by service name.  A new infra service adds one line
 *  here and one in `infra/services.ts` (see `infra/service.ts`). */
export interface InfraServiceOps {
  storage: StorageOp;
  infra: InfraOp;
  broker: BrokerOp;
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
// The host runs PGlite's stock `worker({ init })`, whose handshake (`here`,
// `init`, `ready`, `leader-now`) shares the port; these carry a distinct
// `type` so neither side mistakes the other's messages.

export type HostControl =
  | { op: "status" }
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

/** Init options the infra worker hands the host through PGlite's `init`
 *  message.  `id` is PGlite's broadcast id — the storage's `channel`. */
export interface HostInitOptions {
  id: string;
  dataDir?: string;
  fresh?: boolean;
}
