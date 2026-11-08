/// <reference lib="webworker" />
// One storage's database: a PGlite instance, served to every deployable worker
// bound to the storage through PGlite's stock `worker({ init })` leader half
// (the deployables connect with `PGliteWorker`, see `storage-client.ts`).
//
// Spawned and owned by the infra worker, one per storage.  Besides the stock
// handshake, the infra worker drives it with `HostRequest`s: migrate, the
// Database console's query, Reset.  Those touch PGlite directly; everything a
// deployable runs arrives over PGlite's own broadcast channel.

import { pgliteAssetUrl, pgliteModuleUrl } from "../bundle/plugin.js";
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
import type { QueryResult, WipeResult } from "./protocol.js";
import type { StorageMigrateResult } from "./infra-protocol.js";

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
}

interface PgliteModule {
  PGlite: new (dataDirOrOptions?: unknown, options?: unknown) => Pglite;
}

interface PgliteWorkerModule {
  worker(opts: { init: (options: HostInitOptions) => Promise<Pglite> }): Promise<void>;
}

const QUERY_TIMEOUT_MS = 30_000;

function progress(phase: HostProgress["phase"], note?: string): void {
  try {
    self.postMessage({ type: "loom-host-progress", phase, note } satisfies HostProgress);
  } catch {
    // never let instrumentation break a boot
  }
}

async function loadAssets(): Promise<Record<string, unknown>> {
  const [pgliteRes, initdbRes, dataRes] = await Promise.all([
    fetch(pgliteAssetUrl("pglite.wasm")),
    fetch(pgliteAssetUrl("initdb.wasm")),
    fetch(pgliteAssetUrl("pglite.data")),
  ]);
  if (!pgliteRes.ok) throw new Error(`pglite.wasm fetch failed: ${pgliteRes.status}`);
  if (!initdbRes.ok) throw new Error(`initdb.wasm fetch failed: ${initdbRes.status}`);
  if (!dataRes.ok) throw new Error(`pglite.data fetch failed: ${dataRes.status}`);
  const [pgliteWasmModule, initdbWasmModule, fsBundle] = await Promise.all([
    WebAssembly.compileStreaming(pgliteRes),
    WebAssembly.compileStreaming(initdbRes),
    dataRes.blob(),
  ]);
  return { pgliteWasmModule, initdbWasmModule, fsBundle };
}

/** Settles once `init` has run: the open database, or why it did not open. */
let opened: Promise<{ pg: Pglite; persistent: boolean }>;
/** What Reset rebuilds the schema from — the plan the last migrate applied. */
let schema: StorageSchemaPlan | null = null;

async function open(options: HostInitOptions): Promise<{ pg: Pglite; persistent: boolean }> {
  progress("pglite-assets");
  const [{ PGlite }, assets] = await Promise.all([
    import(/* @vite-ignore */ pgliteModuleUrl("index.js")) as Promise<PgliteModule>,
    loadAssets(),
  ]);
  progress("pglite-construct");
  let pg: Pglite;
  let persistent = false;
  if (options.dataDir && options.dataDir !== ":memory:") {
    try {
      pg = new PGlite(options.dataDir, assets);
      await pg.waitReady;
      persistent = true;
    } catch (err) {
      // A browser that refuses OPFS (Safari < 17, a sandboxed iframe) still
      // gets a database; `persistent` tells the UI it will not survive.
      console.warn(`[storage] data dir "${options.dataDir}" refused, using memory`, err);
      pg = new PGlite(assets);
    }
  } else {
    pg = new PGlite(assets);
  }
  // PGlite really starts up on its first statement — which, on a fresh
  // reset, is the drop below.
  if (options.fresh) {
    progress("ddl-drop");
    await pg.exec(dropUserSchemasSql(true));
  }
  await pg.waitReady;
  return { pg, persistent };
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

async function control(req: HostRequest): Promise<unknown> {
  const { pg, persistent } = await opened;
  switch (req.op) {
    case "status":
      return { persistent };
    case "migrate":
      return migrate(pg, req.plan);
    case "query":
      return query(pg, req.sql);
    case "wipe":
      return wipe(pg);
    case "close":
      await pg.close();
      return { ok: true };
  }
}

// Our own listener first: it sees the stock `init` too, and starts the open
// the stock `init` callback then hands to PGlite's leader half.
let resolveInit!: (options: HostInitOptions) => void;
const initOptions = new Promise<HostInitOptions>((resolve) => {
  resolveInit = resolve;
});
opened = initOptions.then(open);
// An open that fails is reported by the `status` the infra worker sends right
// after the handshake; keep it from also surfacing as an unhandled rejection.
opened.catch(() => undefined);

self.addEventListener("message", (ev: MessageEvent) => {
  const msg = ev.data as { type?: string; options?: HostInitOptions } | HostRequest;
  if (msg?.type === "init" && "options" in msg && msg.options) {
    resolveInit(msg.options);
    return;
  }
  if (msg?.type !== "loom-host") return;
  const req = msg as HostRequest;
  control(req).then(
    (result) => self.postMessage({ type: "loom-host-ret", id: req.id, result } satisfies HostResponse),
    (err) => self.postMessage({ type: "loom-host-ret", id: req.id, error: errText(err) } satisfies HostResponse),
  );
});

// PGlite's leader half announces `here` once loaded; the infra worker answers
// with the init options.  (No top-level await: the worker bundle's target
// predates it.)
void (async () => {
  const { worker } = (await import(
    /* @vite-ignore */ pgliteModuleUrl("worker/index.js")
  )) as PgliteWorkerModule;
  await worker({ init: async () => (await opened).pg });
})();
