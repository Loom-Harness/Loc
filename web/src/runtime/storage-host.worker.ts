/// <reference lib="webworker" />
// One storage's database: a PGlite instance, served to every deployable worker
// bound to the storage over a storage port each (`storage-server.ts`; the
// deployables hold a `StorageClient`, see `storage-client.ts`).
//
// Spawned and owned by the infra worker, one per storage, which drives it
// with `HostRequest`s: attach / detach a deployable's port, migrate, the
// Database console's query, Reset.  Every one of them, and every statement a
// deployable sends, runs through the server's scheduler — the one place that
// decides whose turn it is on PGlite's single session.

import { pgliteAssetUrl, pgliteModuleUrl, RUNTIME_VERSIONS } from "../bundle/plugin.js";
import { fnv1a32 } from "../util/hash.js";
import type {
  HostInitOptions,
  HostProgress,
  HostRequest,
  HostResponse,
  StorageSchemaPlan,
} from "./infra-protocol.js";
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
import { dropSnapshot, opfsClusterExists, readSnapshot, writeSnapshot } from "./pglite-snapshot.js";
import type { QueryResult, WipeResult } from "./protocol.js";
import type { StorageMigrateResult } from "./infra-protocol.js";
import { type PgliteProtocolModule, type PgliteSession, pgliteEngine, StorageServer } from "./storage-server.js";

declare const self: DedicatedWorkerGlobalScope;

interface Pglite {
  exec(sql: string): Promise<unknown>;
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{
    rows: Array<Record<string, unknown>>;
    fields?: Array<{ name: string }>;
    affectedRows?: number;
  }>;
  waitReady: Promise<void>;
  close(): Promise<void>;
  dumpDataDir(compression?: "gzip" | "none"): Promise<Blob>;
}

interface PgliteModule extends PgliteProtocolModule {
  PGlite: new (dataDirOrOptions?: unknown, options?: unknown) => Pglite & PgliteSession;
}

const QUERY_TIMEOUT_MS = 30_000;
const PGLITE_VERSION = RUNTIME_VERSIONS["@electric-sql/pglite"] as string;

function progress(phase: HostProgress["phase"], note?: string): void {
  try {
    self.postMessage({ type: "loom-host-progress", phase, note } satisfies HostProgress);
  } catch {
    // never let instrumentation break a boot
  }
}

/** PGlite's WASM and seed data.  `initdb.wasm` only when this storage may run
 *  initdb — a storage started from a snapshot or reopened never does. */
async function loadAssets(withInitdb: boolean): Promise<Record<string, unknown>> {
  const [pgliteRes, dataRes, initdbRes] = await Promise.all([
    fetch(pgliteAssetUrl("pglite.wasm")),
    fetch(pgliteAssetUrl("pglite.data")),
    withInitdb ? fetch(pgliteAssetUrl("initdb.wasm")) : null,
  ]);
  if (!pgliteRes.ok) throw new Error(`pglite.wasm fetch failed: ${pgliteRes.status}`);
  if (initdbRes && !initdbRes.ok) throw new Error(`initdb.wasm fetch failed: ${initdbRes.status}`);
  if (!dataRes.ok) throw new Error(`pglite.data fetch failed: ${dataRes.status}`);
  const [pgliteWasmModule, fsBundle, initdbWasmModule] = await Promise.all([
    WebAssembly.compileStreaming(pgliteRes),
    dataRes.blob(),
    initdbRes ? WebAssembly.compileStreaming(initdbRes) : null,
  ]);
  return initdbWasmModule ? { pgliteWasmModule, initdbWasmModule, fsBundle } : { pgliteWasmModule, fsBundle };
}

interface Opened {
  pg: Pglite;
  persistent: boolean;
  server: StorageServer;
}

/** Settles once `init` has run: the open database, or why it did not open. */
let opened: Promise<Opened>;
/** What Reset rebuilds the schema from — the plan the last migrate applied. */
let schema: StorageSchemaPlan | null = null;

async function open(options: HostInitOptions): Promise<Opened> {
  progress("pglite-assets");
  const persistentDir = options.dataDir && options.dataDir !== ":memory:" ? options.dataDir : null;
  const snapshot = await freshSnapshot(persistentDir);
  const [mod, seededAssets] = await Promise.all([
    import(/* @vite-ignore */ pgliteModuleUrl("index.js")) as Promise<PgliteModule>,
    loadAssets(snapshot.fresh && !snapshot.blob),
  ]);
  let assets = seededAssets;
  const { PGlite } = mod;
  // The note says how the cluster comes up: unpacked from the cached
  // snapshot, initdb (then dumped as the snapshot), or an existing OPFS one.
  progress("pglite-construct", snapshot.blob ? "snapshot" : snapshot.fresh ? "initdb" : "reopen");
  const start = async (dataDir: string | null, seed: Blob | null): Promise<Pglite & PgliteSession> => {
    const opts = seed ? { ...assets, loadDataDir: seed } : assets;
    const pg = dataDir ? new PGlite(dataDir, opts) : new PGlite(opts);
    await pg.waitReady;
    return pg;
  };
  let pg: Pglite & PgliteSession;
  let persistent = false;
  let seeded = snapshot.blob;
  if (persistentDir) {
    try {
      pg = await start(persistentDir, seeded);
      persistent = true;
    } catch (err) {
      // A browser that refuses OPFS (Safari < 17, a sandboxed iframe) still
      // gets a database; `persistent` tells the UI it will not survive.
      console.warn(`[storage] data dir "${persistentDir}" refused, using memory`, err);
      if (!("initdbWasmModule" in assets)) assets = await loadAssets(true);
      pg = await start(null, null);
      seeded = null;
    }
  } else {
    try {
      pg = await start(null, seeded);
    } catch (err) {
      if (!seeded) throw err;
      // A snapshot PGlite cannot start from is dropped, not retried.
      console.warn("[storage] PGlite snapshot refused, running initdb", err);
      await dropSnapshot(PGLITE_VERSION);
      assets = await loadAssets(true);
      pg = await start(null, null);
      seeded = null;
    }
  }
  // The cluster initdb just made, before any migration touches it: the
  // snapshot every later fresh storage starts from.
  if (snapshot.fresh && !seeded) await writeSnapshot(PGLITE_VERSION, await pg.dumpDataDir("gzip"));
  if (options.fresh) {
    progress("ddl-drop");
    await pg.exec(dropUserSchemasSql(true));
  }
  return { pg, persistent, server: new StorageServer(pgliteEngine(pg, mod)) };
}

/** Whether this storage starts a new cluster, and the snapshot to start it
 *  from.  An in-memory storage is always new; an OPFS one only while its data
 *  dir holds no cluster yet. */
async function freshSnapshot(persistentDir: string | null): Promise<{ fresh: boolean; blob: Blob | null }> {
  const fresh = persistentDir ? !(await opfsClusterExists(persistentDir)) : true;
  return { fresh, blob: fresh ? await readSnapshot(PGLITE_VERSION) : null };
}

async function migrate(pg: Pglite, plan: StorageSchemaPlan): Promise<StorageMigrateResult> {
  if (plan.kind === "chain") {
    const scale = `${plan.units.length} recorded migration unit${plan.units.length === 1 ? "" : "s"}`;
    progress("ddl-meta", scale);
    const res = await migrateChain(pg, plan, (units) =>
      progress("ddl-apply", `${units.length} of ${scale}`),
    );
    if ("blocked" in res) {
      return { ok: false, message: blockingMessage(res.blocked), pending: res.blocked };
    }
    schema = plan;
    return { ok: true, ddl: chainDdl(plan.units), applied: res.applied };
  }
  const { ddl } = plan;
  const scale = `${ddl.split(";").length - 1} stmts, ${Math.round(ddl.length / 1024)}KB`;
  progress("ddl-meta", scale);
  const hash = fnv1a32(ddl);
  const measured = unversionedState(await readSchemaMeta(pg), hash);
  if (blocksBoot(measured)) {
    return { ok: false, message: blockingMessage(measured), pending: measured };
  }
  if (measured.kind === "recorded-not-applied") {
    progress("ddl-apply", scale);
    try {
      if (ddl.trim().length > 0) await pg.exec(ddl);
      await recordDdlHash(pg, hash);
    } catch (err) {
      return { ok: false, message: `DDL execution failed: ${errText(err)}\n--- DDL ---\n${ddl}` };
    }
  }
  schema = plan;
  return { ok: true, ddl, applied: [] };
}

async function query(pg: Pglite, sql: string): Promise<QueryResult> {
  const start = performance.now();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`query timed out after ${QUERY_TIMEOUT_MS} ms`)),
        QUERY_TIMEOUT_MS,
      );
    });
    const res = await Promise.race([pg.query(sql), timeout]);
    return {
      ok: true,
      fields: (res.fields ?? []).map((f) => f.name),
      rows: res.rows ?? [],
      affectedRows: res.affectedRows ?? 0,
      durationMs: Math.round(performance.now() - start),
    };
  } catch (err) {
    return { ok: false, message: errText(err) };
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

/** Reset: drop every user schema and rebuild it from the plan the last
 *  migrate applied.  The rows are gone; the tables keep their shape, and the
 *  deployables stay connected. */
async function wipe(pg: Pglite): Promise<WipeResult> {
  if (!schema) return { ok: false, message: "Storage not migrated — nothing to wipe." };
  try {
    if (schema.kind === "chain") {
      await rebuildChain(pg, schema.units);
    } else {
      await pg.exec(dropUserSchemasSql(false));
      if (schema.ddl.trim().length > 0) await pg.exec(schema.ddl);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: errText(err) };
  }
}

async function control(req: HostRequest, ports: readonly MessagePort[]): Promise<unknown> {
  const { pg, persistent, server } = await opened;
  switch (req.op) {
    case "status":
      return { persistent };
    case "attach": {
      const port = ports[0];
      if (!port) throw new Error("attach needs a transferred MessagePort.");
      server.attach(req.client, port);
      return { ok: true };
    }
    case "detach":
      server.detach(req.client);
      return { ok: true };
    // Host jobs wait their turn like any client's statement: never inside
    // a deployable's open transaction.
    case "migrate":
      return server.scheduler.exclusive(() => migrate(pg, req.plan));
    case "query":
      return server.scheduler.exclusive(() => query(pg, req.sql));
    case "wipe":
      return server.scheduler.exclusive(() => wipe(pg));
    case "close":
      // Every deployable is cut off first, so the no-op host job below is
      // the last job: once it ran, nothing is left in flight.
      server.detachAll();
      await server.scheduler.exclusive(async () => undefined);
      await pg.close();
      return { ok: true };
  }
}

let resolveInit!: (options: HostInitOptions) => void;
const initOptions = new Promise<HostInitOptions>((resolve) => {
  resolveInit = resolve;
});
opened = initOptions.then(open);
// An open that fails is reported by the `status` the infra worker sends right
// after `init`; keep it from also surfacing as an unhandled rejection.
opened.catch(() => undefined);

self.addEventListener("message", (ev: MessageEvent) => {
  const msg = ev.data as { type?: string; options?: HostInitOptions } | HostRequest;
  if (msg?.type === "init" && "options" in msg && msg.options) {
    resolveInit(msg.options);
    return;
  }
  if (msg?.type !== "loom-host") return;
  const req = msg as HostRequest;
  control(req, ev.ports).then(
    (result) => self.postMessage({ type: "loom-host-ret", id: req.id, result } satisfies HostResponse),
    (err) => self.postMessage({ type: "loom-host-ret", id: req.id, error: errText(err) } satisfies HostResponse),
  );
});

// Loaded: ask the infra worker for the init options.
self.postMessage({ type: "here" });
