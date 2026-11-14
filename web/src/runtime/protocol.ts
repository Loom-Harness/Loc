// Runtime-worker protocol.
//
import type { LogLine } from "../util/log-line.js";
import type { OidcPersona, OidcRealm } from "./infra/oidc.js";

//
// One runtime worker per Node deployable.  Once booted it holds the
// deployable's imported bundle, the bootstrapped Hono `app`, and a
// `StorageClient` on its storage port (the database itself runs in a storage
// host under the infra worker — see infra-protocol.ts and storage-wire.ts).  Each `dispatch` request transports a
// serialised Request → the worker reconstructs it, calls `app.fetch`, and
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
  /** Every `Set-Cookie` value (`headers` holds one value per name, and a
   *  response may set several cookies). */
  setCookies?: string[];
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

/** A deployable worker's first boot step: import the bundle. */
export interface LoadRequest {
  /** The deployable's process env, installed before the bundle is imported
   *  (its top-level `process.env.X_URL ?? …` reads run at import). */
  env?: Record<string, string>;
  /** Hostnames of the booted deployables (compose service names).  The
   *  worker's `fetch` sends a request to one of them to the main thread, which
   *  hands it to that deployable's app; every other URL reaches the network. */
  serviceHosts?: string[];
  /** ESM bundle source produced by the bundler worker. */
  bundleCode: string;
  /** The user verifier `bootApp` registers (see `Verifier`).  Default
   *  `"dev-stub"`. */
  verifier?: Verifier;
  /** Also derive the schema from the bundle's Drizzle tables — the schema of
   *  a source without a system, which its storage then applies. */
  synthDdl: boolean;
}

/** `"configured"`: the verifier the model declares — under `auth { oidc }` the
 *  generated OIDC verifier, checking tokens the infra worker's fake identity
 *  provider signs.  `"dev-stub"`: the dev stub and its `x-loom-dev-claims`
 *  header. */
export type Verifier = "configured" | "dev-stub";

export type LoadResult = { ok: true; ddl?: string } | { ok: false; message: string };

/** A deployable worker's second boot step: connect to its storage over the
 *  storage port (transferred with the request, ahead of the infra port) and
 *  start the app on it. */
export type StartRequest = Record<string, never>;

export type StartResult = { ok: true } | { ok: false; message: string };

/** One storage of a boot: where its database lives and what the boot may do
 *  to it. */
export interface StorageBootPlan {
  /** `StoragePlan.key` — the storage's name, or `deployable:<slug>`. */
  key: string;
  /** PGlite data-dir.  Default `:memory:` (wiped on close).  Pass
   *  `opfs-ahp://<some-name>` for OPFS-backed persistence — data survives
   *  page reloads.  The playground keys the island by workspace (and storage),
   *  so a schema edit reopens the same database and migrates it. */
  dataDir?: string;
  /** The migrations the boot may apply.  `unversioned`: the schema is the
   *  Drizzle DDL of the storage's (single) deployable. */
  migrations: MigrationPlan;
}

/** Everything a boot brings up: every storage, then every Node deployable on
 *  the storage it binds. */
export interface BootPlan {
  storages: StorageBootPlan[];
  /** OpenAPI documents the external-API mocks answer from, by origin. */
  restSpecs?: { origin: string; spec: object }[];
  /** In order of preference: the first one is the default dispatch target
   *  (the backend the frontend talks to). */
  backends: Array<{
    slug: string;
    bundleCode: string;
    storage: string;
    /** The process env this deployable boots with — its compose service's
     *  `environment:`.  Per worker, so two deployables never see each
     *  other's values. */
    env?: Record<string, string>;
    /** Default `"dev-stub"`. */
    verifier?: Verifier;
  }>;
  /** The fake identity provider's realms and personas — set for a system with
   *  `auth { oidc }`. */
  oidc?: { realms: OidcRealm[]; personas: OidcPersona[] };
  /** The system's deployables that do not run in the playground (a platform
   *  the browser cannot run, or a backend whose bundle failed), with why.  A
   *  call to one's compose address fails with that reason instead of going
   *  to the network. */
  unavailable?: { slug: string; reason: string }[];
}

/** A serving deployable and the `StorageBootPlan.key` it reads and writes. */
export interface DeployableBootInfo {
  slug: string;
  storage: string;
}

/** Where a failed boot stopped, when it stopped at one deployable or storage. */
export interface BootFailAt {
  deployable?: string;
  storage?: string;
}

/** What one storage's boot did. */
export interface StorageBootInfo {
  key: string;
  persistent: boolean;
  applied: string[];
  ddl: string;
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
  /** Per storage, in plan order. */
  storages: StorageBootInfo[];
  /** Slugs of the deployables now serving, in plan order. */
  backends: string[];
  /** Each serving deployable and the storage it binds, in plan order. */
  deployables: DeployableBootInfo[];
}

export interface BootFail {
  ok: false;
  message: string;
  /** Set when the boot stopped because the database is not at the model's
   *  schema and the recorded chain cannot bring it there.  The database is
   *  left as it was and the app is not started. */
  pending?: BlockingMigrationState;
  /** The deployable or storage the boot stopped at; absent when it failed
   *  before any (or the system has one of each). */
  at?: BootFailAt;
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
  | { id: number; method: "load"; params: LoadRequest }
  | { id: number; method: "start"; params: StartRequest }
  | { id: number; method: "dispatch"; params: SerializedRequest }
  | { id: number; method: "reset"; params: Record<string, never> }
  /** The main thread's answer to a worker's `HttpCall`. */
  | { id: number; method: "httpReply"; params: HttpReply };

/** A backend→backend request, pushed by the calling worker.  Like
 *  `RuntimeProgress` it carries no RPC `id`: the client tells it apart by
 *  `httpCall`, routes it by `host`, and answers with an `httpReply`. */
export interface HttpCall {
  httpCall: number;
  /** The compose service (hostname) the request addresses. */
  host: string;
  request: SerializedRequest;
}

export interface HttpReply {
  httpCall: number;
  result: DispatchResult;
}

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
    | "storage-connect"
    | "create-app";
  /** Optional scale note (e.g. `"182 stmts, 61KB"`).  The phase says where it
   *  died; this says how much work it was carrying, which is the difference
   *  between "inherently heavy on this device" and "should have been cheap". */
  note?: string;
}

/** Lines the deployable logged while no RPC was running — channel
 *  consumers, the outbox relay, timers.  Posted unasked, in batches. */
export interface RuntimeBackgroundLogs {
  backgroundLogs: LogLine[];
}

export interface RuntimeRpcResponse {
  id: number;
  result?: LoadResult | StartResult | DispatchResult | { ok: true };
  error?: { message: string };
  /** `console.*` (and any thrown stack) captured in the worker while
   *  this RPC ran — surfaced as the playground's "Backend" log stream.
   *  Omitted when nothing was logged. */
  logs?: LogLine[];
}
