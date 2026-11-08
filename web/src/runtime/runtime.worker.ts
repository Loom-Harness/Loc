/// <reference lib="webworker" />
// FIRST import, ahead of everything: a worker has its own global scope, so
// the main thread's polyfill (main.tsx) does nothing here.  The generated
// bundle imported below reads `Buffer` while pg-protocol's module bodies
// evaluate — see buffer-polyfill.ts for the specific lines.
import "../buffer-polyfill";
import { synthDDL } from "./ddl";
import type { LogLine } from "../util/log-line.js";
import { installConsoleTee, setLogSink } from "./console-tee.js";
import { errText } from "./migrate.js";
import { StorageHostHandle } from "./storage-client.js";
import type {
  DispatchResult,
  LoadResult,
  RuntimeProgress,
  RuntimeRpcRequest,
  RuntimeRpcResponse,
  SerializedRequest,
  SerializedResponse,
  StartResult,
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

interface BundleModule {
  createApp: (db: unknown) => { fetch: (req: Request) => Promise<Response> };
  schema: Record<string, unknown>;
  drizzle: (client: unknown, opts: { schema: Record<string, unknown> }) => unknown;
  /** `@electric-sql/pglite/worker`'s client: the deployable's connection to
   *  its storage, which runs in the infra worker (see storage-client.ts). */
  PGliteWorker: new (worker: unknown, options?: unknown) => StorageConnection;
  is: (value: unknown, type: unknown) => boolean;
  Table: unknown;
  getTableConfig: (t: unknown) => never;
}

interface StorageConnection {
  waitReady: Promise<void>;
  close(): Promise<void>;
}

/** The imported bundle, between `load` and `start`. */
interface Loaded {
  mod: BundleModule;
  /** Blob URL the bundle was imported from — revoked on reset and on the
   *  next load, or every boot would leak one for the worker's lifetime. */
  bundleUrl: string;
}

interface Started {
  app: { fetch: (req: Request) => Promise<Response> };
  storage: StorageConnection;
}

let loaded: Loaded | null = null;
let started: Started | null = null;

// Default cap on a single dispatch.  A generated op with an
// infinite loop or a runaway query would otherwise hang the worker
// forever — every subsequent dispatch queues behind it and the
// UI looks frozen with no recovery path.
const DEFAULT_DISPATCH_TIMEOUT_MS = 30_000;

async function tearDown(): Promise<void> {
  if (started) {
    try {
      await started.storage.close();
    } catch {
      // best-effort
    }
    started = null;
  }
  if (loaded) {
    try {
      URL.revokeObjectURL(loaded.bundleUrl);
    } catch {
      // best-effort
    }
    loaded = null;
  }
}

/** Import the deployable's bundle.  `synthDdl` also derives the schema from
 *  its Drizzle tables — the schema of a source without a system, which the
 *  storage then applies. */
async function load(bundleCode: string, synthDdl: boolean): Promise<LoadResult> {
  await tearDown();
  progress("import-bundle");
  const blob = new Blob([bundleCode], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  let mod: BundleModule;
  try {
    mod = (await import(/* @vite-ignore */ url)) as unknown as BundleModule;
  } catch (err) {
    URL.revokeObjectURL(url);
    return { ok: false, message: `Bundle import failed: ${errText(err)}` };
  }
  // The blob URL stays alive with the module — some browsers re-fetch
  // sub-resources lazily.
  loaded = { mod, bundleUrl: url };
  if (!synthDdl) return { ok: true };
  progress("ddl-synth");
  try {
    return {
      ok: true,
      ddl: synthDDL(mod.schema, { is: mod.is, Table: mod.Table, getTableConfig: mod.getTableConfig }),
    };
  } catch (err) {
    return { ok: false, message: `DDL synth failed: ${errText(err)}` };
  }
}

/** Connect to the storage and start the app on it. */
async function start(channel: string): Promise<StartResult> {
  if (!loaded) return { ok: false, message: "No bundle loaded — load first." };
  const { mod } = loaded;
  progress("storage-connect");
  let storage: StorageConnection;
  try {
    storage = new mod.PGliteWorker(new StorageHostHandle(channel));
    await storage.waitReady;
  } catch (err) {
    return { ok: false, message: `Storage connection failed: ${errText(err)}` };
  }
  try {
    const db = mod.drizzle(storage, { schema: mod.schema });
    progress("create-app");
    // The app's boot call — the one line a generated boot sequence replaces.
    const app = mod.createApp(db);
    started = { app, storage };
    return { ok: true };
  } catch (err) {
    await storage.close().catch(() => undefined);
    return { ok: false, message: `createApp failed: ${errText(err)}` };
  }
}

async function dispatch(req: SerializedRequest): Promise<DispatchResult> {
  if (!started) {
    return { ok: false, message: "Runtime not booted — call /boot first." };
  }
  const begin = performance.now();
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
      response = await Promise.race([started.app.fetch(request), timeoutPromise]);
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
    return { ok: true, response: out, durationMs: Math.round(performance.now() - begin) };
  } catch (err) {
    return {
      ok: false,
      message: errText(err),
    };
  }
}

async function reset(): Promise<{ ok: true }> {
  await tearDown();
  return { ok: true };
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
      case "load":
        response.result = await load(req.params.bundleCode, req.params.synthDdl);
        break;
      case "start":
        response.result = await start(req.params.channel);
        break;
      case "dispatch":
        response.result = await dispatch(req.params);
        break;
      case "reset":
        response.result = await reset();
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
