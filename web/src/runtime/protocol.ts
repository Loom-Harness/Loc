// Runtime-worker protocol.
//
import type { LogLine } from "../util/log-line.js";

//
// The runtime worker is long-lived: once booted it holds a PGlite
// instance, the bootstrapped Hono `app`, and the migration plan that
// built the schema.  Each `dispatch` request transports a serialised
// Request → the worker reconstructs it, calls `app.fetch`, and
// returns a serialised Response.

export interface SerializedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** Body as text.  null when the request has no body. */
  body: string | null;
}

export interface SerializedResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  /** Empty string when the upstream Response had no body, or when
   *  the status (204 / 205 / 304) forbids a body.  Consumers must
   *  pass `null` to `new Response()` for null-body statuses — the
   *  Web Fetch invariant rejects "" as a body for those. */
  body: string;
}

// -- migrations --------------------------------------------------------------
// The runtime's database evolves only by applying the workspace's recorded
// migration chain (`migrations/*.json` beside the entry), the way a deployed
// backend does.  The build worker renders the chain to SQL; the runtime
// applies the units the database has not seen yet.  A model change that is
// not recorded leaves the database as it is.

/** One migration file of the recorded chain, as the runtime applies it — the
 *  same file the generated Hono backend carries in `db/migrations/`. */
export interface MigrationUnitPlan {
  /** The file's tag: `<version>_<module>_<name>`, with `_concurrent` for a
   *  generation's non-transactional unit.  `__loom.schema_meta` records the
   *  last one applied. */
  id: string;
  /** The statements, in order. */
  statements: string[];
  /** False when every statement must run on its own, outside a transaction
   *  (`CREATE INDEX CONCURRENTLY`). */
  transactional: boolean;
}

/** Schema changes the model has that the chain does not record — what
 *  `ddd migrate status` lists and "Record migration" would record. */
export interface UnrecordedChanges {
  /** The workspace has no chain yet, so the whole schema is unrecorded. */
  initial: boolean;
  modules: string[];
  /** Number of migration steps recording would write. */
  steps: number;
  /** A step the destructive gate refuses (a drop or a narrowing); recording
   *  it needs the destructive acknowledgement. */
  destructive: boolean;
}

/** What a boot may do to the database. */
export type MigrationPlan =
  | {
      kind: "chain";
      /** Every unit of the recorded chain, root first; empty without a chain. */
      units: MigrationUnitPlan[];
      /** `null` when the chain records the model. */
      unrecorded: UnrecordedChanges | null;
    }
  /** A source with no `system` block: no chain can be recorded for it, so the
   *  schema comes from the bundle's Drizzle tables. */
  | { kind: "unversioned" };

/** The database measured against a plan. */
export type MigrationState =
  | { kind: "up-to-date"; head: string | null }
  /** Recorded units the database has not applied; a boot applies them. */
  | { kind: "recorded-not-applied"; head: string | null; units: string[] }
  /** The model has unrecorded changes; a boot leaves the database as it is. */
  | ({ kind: "unrecorded"; head: string | null } & UnrecordedChanges)
  /** Which migrations the database holds cannot be told from the chain: it
   *  predates migration tracking (`legacy`), it is at a unit the chain no
   *  longer has (`diverged`), or a source without a system changed its
   *  schema (`schema-changed`).  Only an explicit reset rebuilds it. */
  | {
      kind: "unknown-database";
      reason: "legacy" | "diverged" | "schema-changed";
      head: string | null;
    };

/** A state a boot cannot migrate past. */
export type BlockingMigrationState = Extract<
  MigrationState,
  { kind: "unrecorded" | "unknown-database" }
>;

export interface BootRequest {
  /** ESM bundle source produced by the bundler worker. */
  bundleCode: string;
  /** The migrations the boot may apply. */
  migrations: MigrationPlan;
  /** PGlite data-dir.  Default `:memory:` (wiped on close).  Pass
   *  `opfs-ahp://<some-name>` for OPFS-backed persistence — data
   *  survives page reloads.  The playground keys the island by workspace,
   *  so a schema edit reopens the same database and migrates it. */
  dataDir?: string;
  /** Explicit reset: drop every user schema and the `__loom` bookkeeping
   *  right after opening PGlite, before migrating.  The recovery path for a
   *  database the chain cannot describe, or one that fails every boot — the
   *  normal Reset needs a booted instance, which such a boot never
   *  produces. */
  fresh?: boolean;
}

export interface BootOk {
  ok: true;
  /** The SQL the database schema was built from: every migration unit of the
   *  chain, in order (the Drizzle-derived DDL for a source without a
   *  system). */
  ddl: string;
  durationMs: number;
  /** Whether PGlite actually attached to a persistent backing
   *  (OPFS / IDB) rather than falling back to in-memory.  When the
   *  caller asked for OPFS but the browser refused (e.g. cross-
   *  origin iframe blocking the storage API), this flips to false
   *  so the UI can show "in-memory" instead of misleadingly
   *  saying "persisted". */
  persistent: boolean;
  /** Ids of the migration units this boot applied, in order; empty when the
   *  database was already at the chain's head. */
  applied: string[];
}

export interface BootFail {
  ok: false;
  message: string;
  /** Set when the boot stopped because the database is not at the model's
   *  schema and the recorded chain cannot bring it there.  The database is
   *  left as it was and the app is not started. */
  pending?: BlockingMigrationState;
}

export type BootResult = BootOk | BootFail;

export interface DispatchOk {
  ok: true;
  response: SerializedResponse;
  durationMs: number;
}

export interface DispatchFail {
  ok: false;
  message: string;
}

export type DispatchResult = DispatchOk | DispatchFail;

export interface QueryOk {
  ok: true;
  /** Column names in result order, taken from PGlite's `fields`.
   *  Present even when `rows` is empty so a zero-row SELECT still
   *  renders its header. */
  fields: string[];
  rows: Array<Record<string, unknown>>;
  /** Rows affected by an INSERT/UPDATE/DELETE.  0 for SELECT. */
  affectedRows: number;
  durationMs: number;
}

export interface QueryFail {
  ok: false;
  message: string;
}

export type QueryResult = QueryOk | QueryFail;

export interface WipeResult {
  ok: boolean;
  /** Error message when `ok === false` — the drop or a migration unit
   *  failed while rebuilding the schema. */
  message?: string;
}

export type RuntimeRpcRequest =
  | { id: number; method: "boot"; params: BootRequest }
  | { id: number; method: "dispatch"; params: SerializedRequest }
  | { id: number; method: "query"; params: { sql: string } }
  | { id: number; method: "reset"; params: Record<string, never> }
  | { id: number; method: "wipe"; params: Record<string, never> };

/** Fire-and-forget progress note pushed by the worker DURING an RPC (it
 *  carries no `id` and expects no reply, so the client tells it apart from a
 *  response by the presence of `phase`).
 *
 *  Boot is one long RPC whose expensive interior — importing a ~2.5 MB bundle,
 *  fetching and compiling PGlite's WASM, materialising its data dir — is where
 *  a memory-constrained device actually dies.  Without this the main thread
 *  sees a single opaque call and, if the renderer is killed mid-boot, cannot
 *  say which step it was in.  The client turns each note into a synchronous
 *  `markPhase` (workers have no localStorage), so the tombstone the next page
 *  load finds is specific instead of just "boot". */
export interface RuntimeProgress {
  phase:
    | "import-bundle"
    | "pglite-assets"
    | "pglite-construct"
    // `ddl` was one phase over four different operations, and a field report
    // landed on it.  These say which — and note that the FIRST of them is
    // also where PGlite really starts up (see `pglite-construct`).
    | "ddl-synth"
    | "ddl-meta"
    | "ddl-drop"
    | "ddl-apply"
    | "create-app";
  /** Optional scale note (e.g. `"182 stmts, 61KB"`).  The phase says where it
   *  died; this says how much work it was carrying, which is the difference
   *  between "inherently heavy on this device" and "should have been cheap". */
  note?: string;
}

export interface RuntimeRpcResponse {
  id: number;
  result?: BootResult | DispatchResult | QueryResult | WipeResult | { ok: true };
  error?: { message: string };
  /** `console.*` (and any thrown stack) captured in the worker while
   *  this RPC ran — surfaced as the playground's "Backend" log stream.
   *  Omitted when nothing was logged. */
  logs?: LogLine[];
}
