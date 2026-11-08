/// <reference lib="webworker" />
// FIRST import, ahead of everything: a worker has its own global scope, so
// the main thread's polyfill (main.tsx) does nothing here.  The generated
// bundle imported below reads `Buffer` while pg-protocol's module bodies
// evaluate — see buffer-polyfill.ts for the specific lines.
import "../buffer-polyfill";
import { synthDDL } from "./ddl";
import { pgliteAssetUrl } from "../bundle/plugin.js";
import { fnv1a32 } from "../util/hash.js";
import type { LogLine } from "../util/log-line.js";
import { installConsoleTee, setLogSink } from "./console-tee.js";
import {
  blockingMessage,
  blocksBoot,
  chainDdl,
  dropUserSchemasSql,
  errText,
  migrateChain,
  readSchemaMeta,
  rebuildChain,
  recordDdlHash,
  unversionedState,
} from "./migrate.js";
import type {
  BlockingMigrationState,
  BootFail,
  BootResult,
  DispatchResult,
  MigrationPlan,
  QueryResult,
  RuntimeProgress,
  RuntimeRpcRequest,
  RuntimeRpcResponse,
  SerializedRequest,
  SerializedResponse,
} from "./protocol.js";

declare const self: DedicatedWorkerGlobalScope;

/** Push a boot-progress note to the main thread.  Fire-and-forget: it carries
 *  no `id`, so the client routes it by the `phase` field.
 *
 *  Boot's expensive interior (a ~2.5 MB bundle import, PGlite's WASM + data
 *  dir) is where a memory-constrained device actually dies, and a worker has
 *  no localStorage to leave a tombstone in.  Posting each step lets the main
 *  thread write one synchronously, so a renderer kill mid-boot is attributable
 *  to a step instead of to "boot". */
function progress(phase: RuntimeProgress["phase"], note?: string): void {
  try {
    self.postMessage({ phase, note } satisfies RuntimeProgress);
  } catch {
    // never let instrumentation break a boot
  }
}

// Install the permanent console tee ONCE, before any generated bundle is
// imported, so pino (which binds `console.*` at logger creation during
// boot) routes through it for the lifetime of the worker.  See
// console-tee.ts for why a per-RPC patch lost every structured line.
installConsoleTee();

// PGlite's normal boot path computes WASM/data URLs relative to its
// own `import.meta.url` and fetches them at runtime.  When the
// bundle is loaded from a `blob:` URL the relative resolution lands
// on a nonexistent path.  PGlite's escape hatch is the
// `{ pgliteWasmModule, initdbWasmModule, fsBundle }` constructor
// options: pre-compile / pre-fetch the artifacts and it skips its
// own URL-based loading entirely.  See bundle/plugin.ts
// `pgliteAssetUrl` for the shared (jsdelivr-hosted) source.

interface BundleModule {
  createApp: (db: unknown) => { fetch: (req: Request) => Promise<Response> };
  /** The generated start-up sequence (`boot.ts`) — absent from a bundle whose
   *  backend emits none, which then boots through bare `createApp`. */
  bootApp?: (
    db: unknown,
    opts: { verifier: "dev-stub"; infra: "in-process" },
  ) => Promise<{ app: { fetch: (req: Request) => Promise<Response> }; stop: () => Promise<void> }>;
  schema: Record<string, unknown>;
  drizzle: (pglite: unknown, opts: { schema: Record<string, unknown> }) => unknown;
  // `new PGlite()`, `new PGlite(options)`, or `new PGlite(dataDir, options)`.
  // PGlite picks the right overload based on whether the first arg is
  // a string.  `dataDir` of `":memory:"` (or omitted) is in-memory;
  // `"opfs-ahp://<name>"` enables OPFS persistence.
  PGlite: new (
    dataDirOrOptions?: string | unknown,
    options?: unknown,
  ) => PgliteHandle;
  is: (value: unknown, type: unknown) => boolean;
  Table: unknown;
  getTableConfig: (t: unknown) => never;
}

interface PgliteHandle {
  exec: (sql: string) => Promise<unknown>;
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{
    rows: Array<Record<string, unknown>>;
    fields?: Array<{ name: string; dataTypeID: number }>;
    affectedRows?: number;
  }>;
  close?: () => Promise<void>;
}

let cachedPgliteWasm: WebAssembly.Module | null = null;
let cachedInitdbWasm: WebAssembly.Module | null = null;
let cachedFsBundle: Blob | null = null;

async function loadPgliteAssets(): Promise<{
  pgliteWasmModule: WebAssembly.Module;
  initdbWasmModule: WebAssembly.Module;
  fsBundle: Blob;
}> {
  if (!cachedPgliteWasm || !cachedInitdbWasm || !cachedFsBundle) {
    const [pgliteRes, initdbRes, dataRes] = await Promise.all([
      fetch(pgliteAssetUrl("pglite.wasm")),
      fetch(pgliteAssetUrl("initdb.wasm")),
      fetch(pgliteAssetUrl("pglite.data")),
    ]);
    if (!pgliteRes.ok) throw new Error(`pglite.wasm fetch failed: ${pgliteRes.status}`);
    if (!initdbRes.ok) throw new Error(`initdb.wasm fetch failed: ${initdbRes.status}`);
    if (!dataRes.ok) throw new Error(`pglite.data fetch failed: ${dataRes.status}`);
    const [pgliteMod, initdbMod, dataBlob] = await Promise.all([
      WebAssembly.compileStreaming(pgliteRes),
      WebAssembly.compileStreaming(initdbRes),
      dataRes.blob(),
    ]);
    cachedPgliteWasm = pgliteMod;
    cachedInitdbWasm = initdbMod;
    cachedFsBundle = dataBlob;
  }
  return {
    pgliteWasmModule: cachedPgliteWasm,
    initdbWasmModule: cachedInitdbWasm,
    fsBundle: cachedFsBundle,
  };
}

interface RuntimeState {
  app: { fetch: (req: Request) => Promise<Response> };
  /** Stops what `bootApp` started (timers, channel consumers, the outbox
   *  relay) — run before PGlite closes on Reset and re-boot. */
  stop: () => Promise<void>;
  pglite: PgliteHandle;
  ddl: string;
  /** The plan the boot migrated with — what Reset rebuilds the schema from. */
  migrations: MigrationPlan;
  /** Blob URL the bundle was loaded from.  Tracked here so we can
   *  revoke on reset and on the next boot — without this, every
   *  successful Boot leaks one URL for the worker's lifetime. */
  bundleUrl: string;
  /** Cached `mod.PGlite` ctor for `wipe()` to reuse.  We could
   *  instead `mod.drizzle(state.pglite, ...)` to rebuild the app,
   *  but DROP+CREATE inside the existing PGlite is simpler. */
  PGlite: BundleModule["PGlite"];
  drizzle: BundleModule["drizzle"];
  schema: BundleModule["schema"];
  createApp: BundleModule["createApp"];
}

let state: RuntimeState | null = null;

// Default cap on a single dispatch.  A generated op with an
// infinite loop or a runaway query would otherwise hang the worker
// forever — every subsequent dispatch queues behind it and the
// UI looks frozen with no recovery path.
const DEFAULT_DISPATCH_TIMEOUT_MS = 30_000;

async function tearDownState(): Promise<void> {
  if (!state) return;
  try {
    await state.stop();
  } catch {
    // best-effort
  }
  try {
    await state.pglite.close?.();
  } catch {
    // best-effort
  }
  try {
    URL.revokeObjectURL(state.bundleUrl);
  } catch {
    // best-effort
  }
  state = null;
}

async function boot(
  bundleCode: string,
  migrations: MigrationPlan,
  dataDir?: string,
  fresh = false,
): Promise<BootResult> {
  const start = performance.now();
  // Tear down a previous boot if present (close PGlite + revoke its
  // bundle URL).
  await tearDownState();

  progress("import-bundle");
  const blob = new Blob([bundleCode], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  let mod: BundleModule;
  try {
    mod = (await import(/* @vite-ignore */ url)) as unknown as BundleModule;
  } catch (err) {
    URL.revokeObjectURL(url);
    return {
      ok: false,
      message: `Bundle import failed: ${errText(err)}`,
    };
  }
  // Keep the blob URL alive for the lifetime of the module — some
  // browsers re-fetch sub-resources lazily.  Stored on `state` so
  // tearDownState can revoke it on reset / next boot.

  // Try the requested persistent backend first; fall back to
  // in-memory if the browser refuses (Safari < 17, restrictive
  // iframe sandboxing, etc.).  `persistent` flag flows back to the
  // UI so the badge can say "in-memory" instead of misleadingly
  // claiming "persisted" when storage is actually ephemeral.
  let pglite;
  let persistent = false;
  try {
    progress("pglite-assets");
    const assets = await loadPgliteAssets();
    // NOT "init": measured, `new PGlite(...)` is 0.7 ms and does nothing.
    // Postgres' real startup — WASM instantiation, initdb, materialising the
    // data dir — is deferred to the FIRST exec, i.e. `ddl-meta` below, which
    // took 5469 ms against 5.9 ms for the second exec.  Naming this "init"
    // cost a diagnosis cycle: a field report showed it passing and we read
    // that as "PGlite is up", when it only meant the constructor returned.
    progress("pglite-construct");
    if (dataDir && dataDir !== ":memory:") {
      try {
        pglite = new mod.PGlite(dataDir, assets);
        persistent = true;
      } catch (err) {
        console.warn(
          `[runtime] persistent dataDir "${dataDir}" rejected, falling back to :memory:`,
          err,
        );
        pglite = new mod.PGlite(assets);
      }
    } else {
      pglite = new mod.PGlite(assets);
    }
  } catch (err) {
    return {
      ok: false,
      message: `PGlite boot failed: ${errText(err)}`,
    };
  }

  // The explicit reset: drop every user schema and the bookkeeping right
  // after PGlite opens, before anything reads it, so the migration below
  // starts from a blank database.  The recovery path for a database the
  // chain cannot describe, or one that fails every boot — the normal Reset
  // needs a booted instance, which such a boot never produces.
  if (fresh) {
    try {
      progress("ddl-drop");
      await pglite.exec(dropUserSchemasSql(true));
    } catch (err) {
      return {
        ok: false,
        message: `Reset of stored data failed: ${errText(err)}`,
      };
    }
  }

  let migrated: { ddl: string; applied: string[] } | BootFail;
  try {
    migrated =
      migrations.kind === "chain"
        ? await migrateToHead(pglite, migrations)
        : await migrateUnversioned(pglite, mod);
  } catch (err) {
    return { ok: false, message: errText(err) };
  }
  if ("ok" in migrated) return migrated;

  let app: BundleModule["createApp"] extends (db: unknown) => infer R ? R : never;
  let stop = async (): Promise<void> => {};
  try {
    const db = mod.drizzle(pglite, { schema: mod.schema });
    progress("create-app");
    if (mod.bootApp) {
      // The deployed start-up sequence minus `serve()`: seeds, verifier,
      // dispatchers, channel consumers, outbox relay, timers.  The preview
      // reaches no IdP, no broker and no second Postgres connection, so it
      // takes the dev-stub verifier and the in-process broker + cron.
      const booted = await mod.bootApp(db, { verifier: "dev-stub", infra: "in-process" });
      app = booted.app;
      stop = booted.stop;
    } else {
      app = mod.createApp(db);
    }
  } catch (err) {
    return {
      ok: false,
      message: `${mod.bootApp ? "bootApp" : "createApp"} failed: ${errText(err)}`,
    };
  }

  state = {
    app,
    stop,
    pglite,
    ddl: migrated.ddl,
    migrations,
    bundleUrl: url,
    PGlite: mod.PGlite,
    drizzle: mod.drizzle,
    schema: mod.schema,
    createApp: mod.createApp,
  };
  return {
    ok: true,
    ddl: migrated.ddl,
    durationMs: Math.round(performance.now() - start),
    persistent,
    applied: migrated.applied,
  };
}

/** A boot that stops at a state the recorded chain cannot migrate past; the
 *  database is left as it was. */
function blocked(pending: BlockingMigrationState): BootFail {
  return { ok: false, message: blockingMessage(pending), pending };
}

/** Bring the database to the recorded chain's head (see `migrate.ts`). */
async function migrateToHead(
  pglite: PgliteHandle,
  plan: Extract<MigrationPlan, { kind: "chain" }>,
): Promise<{ ddl: string; applied: string[] } | BootFail> {
  const scale = `${plan.units.length} recorded migration unit${plan.units.length === 1 ? "" : "s"}`;
  // The first statement PGlite runs is where Postgres really starts up.
  progress("ddl-meta", scale);
  const res = await migrateChain(pglite, plan, (units) =>
    progress("ddl-apply", `${units.length} of ${scale}`),
  );
  if ("blocked" in res) return blocked(res.blocked);
  return { ddl: chainDdl(plan.units), applied: res.applied };
}

/** A source without a system has no chain: its schema is the bundle's
 *  Drizzle-derived DDL, applied to an empty database and recorded by hash.
 *  A database built from a different DDL is left as it is. */
async function migrateUnversioned(
  pglite: PgliteHandle,
  mod: BundleModule,
): Promise<{ ddl: string; applied: string[] } | BootFail> {
  progress("ddl-synth");
  let ddl: string;
  try {
    ddl = synthDDL(mod.schema, {
      is: mod.is,
      Table: mod.Table,
      getTableConfig: mod.getTableConfig,
    });
  } catch (err) {
    return { ok: false, message: `DDL synth failed: ${errText(err)}` };
  }
  const scale = `${ddl.split(";").length - 1} stmts, ${Math.round(ddl.length / 1024)}KB`;
  progress("ddl-meta", scale);
  const hash = fnv1a32(ddl);
  const measured = unversionedState(await readSchemaMeta(pglite), hash);
  if (blocksBoot(measured)) return blocked(measured);
  if (measured.kind === "recorded-not-applied") {
    progress("ddl-apply", scale);
    try {
      if (ddl.trim().length > 0) await pglite.exec(ddl);
      await recordDdlHash(pglite, hash);
    } catch (err) {
      return { ok: false, message: `DDL execution failed: ${errText(err)}\n--- DDL ---\n${ddl}` };
    }
  }
  return { ddl, applied: [] };
}

async function dispatch(req: SerializedRequest): Promise<DispatchResult> {
  if (!state) {
    return { ok: false, message: "Runtime not booted — call /boot first." };
  }
  const start = performance.now();
  try {
    const request = new Request(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body ?? undefined,
    });
    // Race the dispatch against a timeout so a hung handler
    // (infinite loop, deadlock in user logic, network in the
    // generated app waiting forever) doesn't wedge the worker.
    // The user can interrupt by reset; without the race, every
    // subsequent dispatch queues behind the hung one and the UI
    // never recovers.
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<Response>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`dispatch timed out after ${DEFAULT_DISPATCH_TIMEOUT_MS} ms`));
      }, DEFAULT_DISPATCH_TIMEOUT_MS);
    });
    let response: Response;
    try {
      response = await Promise.race([state.app.fetch(request), timeoutPromise]);
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
    const headers: Record<string, string> = {};
    response.headers.forEach((v, k) => {
      headers[k] = v;
    });
    const body = await response.text();
    const out: SerializedResponse = {
      status: response.status,
      statusText: response.statusText,
      headers,
      body,
    };
    return { ok: true, response: out, durationMs: Math.round(performance.now() - start) };
  } catch (err) {
    return {
      ok: false,
      message: errText(err),
    };
  }
}

// Run an arbitrary SQL statement against the booted PGlite for the
// Database console.  Single-statement (PGlite's `query` runs one
// parameterless statement) — enough for SELECT browsing and ad-hoc
// INSERT/UPDATE/DELETE.  The same timeout race as `dispatch` guards
// against a runaway query wedging the worker.
async function query(sql: string): Promise<QueryResult> {
  if (!state) {
    return { ok: false, message: "Runtime not booted — boot first." };
  }
  const start = performance.now();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`query timed out after ${DEFAULT_DISPATCH_TIMEOUT_MS} ms`));
      }, DEFAULT_DISPATCH_TIMEOUT_MS);
    });
    const res = await Promise.race([state.pglite.query(sql), timeoutPromise]);
    return {
      ok: true,
      fields: (res.fields ?? []).map((f) => f.name),
      rows: res.rows ?? [],
      affectedRows: res.affectedRows ?? 0,
      durationMs: Math.round(performance.now() - start),
    };
  } catch (err) {
    return {
      ok: false,
      message: errText(err),
    };
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

async function reset(): Promise<{ ok: true }> {
  await tearDownState();
  return { ok: true };
}

// The explicit "Reset database": drop every user schema and rebuild the
// schema from the plan the boot migrated with — every recorded unit, from the
// start of the chain.  The rows are gone; the tables keep their shape.  Works
// the same for in-memory and OPFS-backed PGlite.  No-op when not booted.
async function wipe(): Promise<{ ok: boolean; message?: string }> {
  if (!state) {
    return { ok: false, message: "Runtime not booted — nothing to wipe." };
  }
  try {
    if (state.migrations.kind === "chain") {
      await rebuildChain(state.pglite, state.migrations.units);
    } else {
      await state.pglite.exec(dropUserSchemasSql(false));
      if (state.ddl.trim().length > 0) await state.pglite.exec(state.ddl);
    }
    // The drizzle db + Hono app are still bound to the same
    // PGlite instance, so they keep working without a rebuild.
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      message: errText(err),
    };
  }
}

self.onmessage = async (ev: MessageEvent<RuntimeRpcRequest>) => {
  const req = ev.data;
  const response: RuntimeRpcResponse = { id: req.id };
  const logs: LogLine[] = [];
  // Route this RPC's console output (incl. the bundle's pino lines) into
  // `logs` for the duration of the call.
  setLogSink(logs);
  try {
    switch (req.method) {
      case "boot":
        response.result = await boot(
          req.params.bundleCode,
          req.params.migrations,
          req.params.dataDir,
          req.params.fresh,
        );
        break;
      case "dispatch":
        response.result = await dispatch(req.params);
        break;
      case "query":
        response.result = await query(req.params.sql);
        break;
      case "reset":
        response.result = await reset();
        break;
      case "wipe":
        response.result = await wipe();
        break;
      default:
        response.error = {
          message: `Unknown method: ${(req as { method: string }).method}`,
        };
    }
  } catch (err) {
    // Surface the stack in the Backend log stream — the RPC error
    // message itself only carries `err.message`.
    logs.push({
      level: "error",
      text: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
    response.error = {
      message: errText(err),
    };
  } finally {
    setLogSink(null);
  }
  if (logs.length > 0) response.logs = logs;
  self.postMessage(response);
};
