/// <reference lib="webworker" />
// FIRST import, ahead of everything: a worker has its own global scope, so
// the main thread's polyfill (main.tsx) does nothing here.  The generated
// bundle imported below reads `Buffer` while pg-protocol's module bodies
// evaluate — see buffer-polyfill.ts for the specific lines.
import "../buffer-polyfill";
import { synthDDL } from "./ddl";
import type { LogLine } from "../util/log-line.js";
import { installConsoleTee, setBackgroundFlush, setLogSink } from "./console-tee.js";
import { errText } from "./migrate.js";
import { BrokerClient, type ChannelBindingLike, type ChannelTransport } from "./broker-facade.js";
import { InfraPort } from "./infra-port.js";
import { serviceFetch } from "./service-fetch.js";
import { keepCookieHeaders } from "./cookie-headers.js";
import { connectResourceFakes, prepareResourceFakes, setOidcIssuer, setRoutedHosts } from "./resource-fakes.js";
import { StorageClient } from "./storage-client.js";
import type {
  DispatchResult,
  HttpCall,
  HttpReply,
  LoadResult,
  RuntimeBackgroundLogs,
  RuntimeProgress,
  RuntimeRpcRequest,
  RuntimeRpcResponse,
  SerializedRequest,
  SerializedResponse,
  StartResult,
  Verifier,
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
// Lines logged between RPCs (a channel consumer, the outbox relay, a timer)
// reach the Backend log stream as unasked batches.
setBackgroundFlush((lines) => {
  try {
    self.postMessage({ backgroundLogs: lines } satisfies RuntimeBackgroundLogs);
  } catch {
    // never let log delivery break the deployable
  }
});
prepareResourceFakes();
keepCookieHeaders();

interface BundleModule {
  createApp: (db: unknown) => { fetch: (req: Request) => Promise<Response> };
  /** The generated start-up sequence (`boot.ts`) — absent from a bundle whose
   *  backend emits none, which then boots through bare `createApp`. */
  bootApp?: (
    db: unknown,
    opts: {
      verifier: Verifier;
      infra: "in-process";
      /** Read only by a backend that wires channels. */
      channelTransport?: (binding: ChannelBindingLike) => ChannelTransport;
    },
  ) => Promise<{ app: { fetch: (req: Request) => Promise<Response> }; stop: () => Promise<void> }>;
  schema: Record<string, unknown>;
  drizzle: (client: unknown, opts: { schema: Record<string, unknown> }) => unknown;
  is: (value: unknown, type: unknown) => boolean;
  Table: unknown;
  getTableConfig: (t: unknown) => never;
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
  /** Stops what `bootApp` started (timers, channel consumers, the outbox
   *  relay) — run before the storage connection closes on Reset and
   *  re-boot. */
  stop: () => Promise<void>;
  storage: StorageClient;
  /** The line to the infra services (the broker) — closed after `stop`. */
  infra: InfraPort | null;
}

/** The network `fetch`, kept before `load` wraps it. */
const realFetch: typeof fetch = globalThis.fetch.bind(globalThis);

/** Backend→backend calls awaiting the main thread's `httpReply`. */
const pendingHttp = new Map<number, (r: DispatchResult) => void>();
let nextHttpCall = 1;

/** Hand a request for another deployable to the main thread, which owns every
 *  worker and runs it through that deployable's app. */
function forwardHttp(host: string, request: SerializedRequest): Promise<DispatchResult> {
  return new Promise((resolve) => {
    const httpCall = nextHttpCall++;
    pendingHttp.set(httpCall, resolve);
    self.postMessage({ httpCall, host, request } satisfies HttpCall);
  });
}

/** Give the bundle this deployable's env and its route to the others, before
 *  it is imported: the generated clients read `process.env.<X>_URL` and call
 *  `fetch` while the module's top level runs.  A worker is one deployable, so
 *  the env is per deployable by construction.  The postprocess shim in the
 *  bundle fills in the rest of `process` around this `env`. */
function installEnv(env: Record<string, string> | undefined, hosts: readonly string[]): void {
  const g = globalThis as unknown as { process?: { env?: Record<string, string> } };
  g.process = { ...(g.process ?? {}), env: { ...(env ?? {}) } };
  globalThis.fetch = serviceFetch(new Set(hosts), forwardHttp, realFetch);
  setRoutedHosts(new Set(hosts));
  setOidcIssuer(env?.OIDC_ISSUER ?? null);
}

let loaded: Loaded | null = null;
/** The verifier the loaded bundle boots with. */
let verifier: Verifier = "dev-stub";
let started: Started | null = null;

// Default cap on a single dispatch.  A generated op with an
// infinite loop or a runaway query would otherwise hang the worker
// forever — every subsequent dispatch queues behind it and the
// UI looks frozen with no recovery path.
const DEFAULT_DISPATCH_TIMEOUT_MS = 30_000;

async function tearDown(): Promise<void> {
  if (started) {
    try {
      await started.stop();
    } catch {
      // best-effort
    }
    try {
      await started.storage.close();
    } catch {
      // best-effort
    }
    started.infra?.close();
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
async function load(
  bundleCode: string,
  synthDdl: boolean,
  env?: Record<string, string>,
  serviceHosts: readonly string[] = [],
  verifierChoice: Verifier = "dev-stub",
): Promise<LoadResult> {
  await tearDown();
  installEnv(env, serviceHosts);
  verifier = verifierChoice;
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

/** Connect to the storage over `storagePort` and start the app on it.
 *  `infraPort`, when the engine attached the deployable to the infra
 *  services, carries the channel bindings to the emulated broker. */
async function start(storagePort: MessagePort | undefined, infraPort: MessagePort | undefined): Promise<StartResult> {
  const infra = infraPort ? new InfraPort(infraPort) : null;
  if (!loaded || !storagePort) {
    infra?.close();
    storagePort?.close();
    return { ok: false, message: loaded ? "No storage port — attach first." : "No bundle loaded — load first." };
  }
  const { mod } = loaded;
  progress("storage-connect");
  connectResourceFakes(infra);
  const storage = new StorageClient(storagePort);
  try {
    await storage.waitReady;
  } catch (err) {
    infra?.close();
    await storage.close();
    return { ok: false, message: `Storage connection failed: ${errText(err)}` };
  }
  try {
    const db = mod.drizzle(storage, { schema: mod.schema });
    progress("create-app");
    if (mod.bootApp) {
      // The deployed start-up sequence minus `serve()`: seeds, verifier,
      // dispatchers, channel consumers, outbox relay, timers.  The verifier is
      // the engine's choice: the configured one (under `auth { oidc }`, the
      // generated OIDC verifier against the infra worker's fake identity
      // provider) or the dev stub.  Its brokers are the infra worker's
      // emulated ones (one facade per binding), and `cron:` runs in-process.
      const broker = infra ? new BrokerClient(infra) : null;
      const booted = await mod.bootApp(db, {
        verifier,
        infra: "in-process",
        ...(broker ? { channelTransport: (b: ChannelBindingLike) => broker.transportFor(b) } : {}),
      });
      started = { app: booted.app, stop: booted.stop, storage, infra };
    } else {
      started = { app: mod.createApp(db), stop: async () => {}, storage, infra };
    }
    return { ok: true };
  } catch (err) {
    infra?.close();
    await storage.close().catch(() => undefined);
    return { ok: false, message: `${mod.bootApp ? "bootApp" : "createApp"} failed: ${errText(err)}` };
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
    const setCookies = response.headers.getSetCookie?.() ?? [];
    const out: SerializedResponse = {
      status: response.status,
      statusText: response.statusText,
      headers,
      ...(setCookies.length > 0 ? { setCookies } : {}),
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

/** The RPC being served; the next one waits for it.  One RPC at a time is
 *  what keeps the module-level slots honest: the log sink below and the
 *  bundle's `AsyncLocalStorage` polyfill, whose single store would otherwise
 *  hand one request's principal to another's continuation. */
let serving: Promise<void> = Promise.resolve();

self.onmessage = (ev: MessageEvent<RuntimeRpcRequest>) => {
  const req = ev.data;
  // An answer, not an RPC: settle the call and leave the log sink alone —
  // a dispatch is awaiting it.
  if (req.method === "httpReply") {
    const reply: HttpReply = req.params;
    pendingHttp.get(reply.httpCall)?.(reply.result);
    pendingHttp.delete(reply.httpCall);
    return;
  }
  // Reset is the way out of a hung dispatch: it does not queue behind it.
  if (req.method === "reset") {
    void serve(ev);
    return;
  }
  serving = serving.then(() => serve(ev)).catch(() => undefined);
};

async function serve(ev: MessageEvent<RuntimeRpcRequest>): Promise<void> {
  const req = ev.data;
  if (req.method === "httpReply") return;
  const response: RuntimeRpcResponse = { id: req.id };
  const logs: LogLine[] = [];
  // Route this RPC's console output (incl. the bundle's pino lines) into
  // `logs` for the duration of the call.
  setLogSink(logs);
  try {
    switch (req.method) {
      case "load":
        response.result = await load(
          req.params.bundleCode,
          req.params.synthDdl,
          req.params.env,
          req.params.serviceHosts,
          req.params.verifier,
        );
        break;
      case "start":
        response.result = await start(ev.ports[0], ev.ports[1]);
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
}
