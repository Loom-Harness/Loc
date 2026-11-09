import type {
  DispatchResult,
  HttpCall,
  LoadRequest,
  LoadResult,
  RuntimeBackgroundLogs,
  RuntimeProgress,
  RuntimeRpcRequest,
  RuntimeRpcResponse,
  SerializedRequest,
  StartResult,
} from "./protocol.js";
import type { LogLine } from "../util/log-line.js";
import { type DiagPhase, markPhase } from "../util/diagnostics.js";

export interface LoomRuntimeClientOptions {
  /** Optional callback fired every time `respawn` terminates the
   *  worker and creates a fresh one — including when an external
   *  trigger (App.tsx's visibilitychange handler) decides the
   *  backgrounded worker was likely killed.  Used by the
   *  playground to surface "runtime was reset, click Boot again"
   *  in the UI: the booted app belongs to the old worker and can't be
   *  recovered. */
  onRespawn?: () => void;
  /** Fired with the `console.*` / stack lines the worker captured
   *  while running an RPC (boot / dispatch / …) — drives the
   *  playground's "Backend" log stream. */
  onLog?: (lines: LogLine[]) => void;
  /** A request this deployable's code sent to another deployable's compose
   *  address.  The engine owns every worker, so it answers. */
  onHttpCall?: (host: string, request: SerializedRequest) => Promise<DispatchResult>;
  /** The deployable this worker runs; stamped on every captured line so the
   *  Output panel can tell the backends of one system apart. */
  source?: string;
  /** Fired whenever this client terminates its worker (respawn, dispose), so
   *  the engine can tell the infra worker at once: a storage transaction the
   *  worker left open must roll back before anyone else's statement runs. */
  onTerminate?: () => void;
}

export class LoomRuntimeClient {
  private worker!: Worker;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private readonly onRespawn?: () => void;
  private readonly onLog?: (lines: LogLine[]) => void;
  private readonly onHttpCall?: LoomRuntimeClientOptions["onHttpCall"];
  private readonly source?: string;
  private readonly onTerminate?: () => void;
  private disposed = false;

  constructor(opts: LoomRuntimeClientOptions = {}) {
    this.onRespawn = opts.onRespawn;
    this.onLog = opts.onLog;
    this.onHttpCall = opts.onHttpCall;
    this.source = opts.source;
    this.onTerminate = opts.onTerminate;
    this.spawn();
  }

  /** Create a fresh worker and wire its `onmessage`.  Extracted so
   *  `respawn` can recreate the worker without duplicating
   *  constructor logic. */
  private spawn(): void {
    this.worker = new Worker(new URL("./runtime.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (ev: MessageEvent<RuntimeRpcResponse | RuntimeProgress | RuntimeBackgroundLogs | HttpCall>) => {
      // Progress note, not a response: no `id`, carries `phase`.  Written
      // through synchronously here because a worker has no localStorage —
      // this is what makes a mid-boot renderer kill attributable to a step
      // rather than to "boot".  See diagnostics.ts → PHASE MARKERS.
      if ("phase" in ev.data) {
        markPhase(`boot:${ev.data.phase}` as DiagPhase, ev.data.note);
        return;
      }
      if ("httpCall" in ev.data) {
        void this.answerHttp(ev.data);
        return;
      }
      if ("backgroundLogs" in ev.data) {
        this.emitLogs(ev.data.backgroundLogs);
        return;
      }
      const msg = ev.data;
      if (msg.logs && msg.logs.length > 0) this.emitLogs(msg.logs);
      const slot = this.pending.get(msg.id);
      if (!slot) return;
      this.pending.delete(msg.id);
      if (msg.error) slot.reject(new Error(msg.error.message));
      else slot.resolve(msg.result ?? null);
    };
  }

  /** Hand captured lines to `onLog`, tagged with this deployable. */
  private emitLogs(lines: LogLine[]): void {
    const source = this.source;
    this.onLog?.(source ? lines.map((l) => ({ ...l, source })) : lines);
  }

  /** Run a backend→backend request through the main thread's router and send
   *  the result back to the worker that is awaiting it. */
  private async answerHttp(call: HttpCall): Promise<void> {
    const worker = this.worker;
    let result: DispatchResult;
    try {
      result = this.onHttpCall
        ? await this.onHttpCall(call.host, call.request)
        : { ok: false, message: "No router for backend-to-backend requests." };
    } catch (err) {
      result = { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
    // A respawn while the call was in flight replaced the worker; the old one
    // is gone and the new one never asked.
    if (worker === this.worker && !this.disposed) {
      worker.postMessage({ id: 0, method: "httpReply", params: { httpCall: call.httpCall, result } });
    }
  }

  private send<T>(req: Omit<RuntimeRpcRequest, "id">, transfer: Transferable[] = []): Promise<T> {
    if (this.disposed) {
      return Promise.reject(new Error("LoomRuntimeClient: disposed"));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      });
      this.worker.postMessage({ id, ...req } as RuntimeRpcRequest, transfer);
    });
  }

  /** Import the deployable's bundle (and, for a source without a system,
   *  derive its schema). */
  load(req: LoadRequest): Promise<LoadResult> {
    return this.send<LoadResult>({ method: "load", params: req });
  }

  /** Connect to the storage over `storagePort` and start the app.
   *  `infraPort` is the deployable's end of its line to the infra services.
   *  Both are transferred. */
  start(storagePort: MessagePort, infraPort?: MessagePort): Promise<StartResult> {
    return this.send<StartResult>(
      { method: "start", params: {} },
      infraPort ? [storagePort, infraPort] : [storagePort],
    );
  }

  dispatch(req: SerializedRequest): Promise<DispatchResult> {
    return this.send<DispatchResult>({
      method: "dispatch",
      params: req,
    });
  }

  reset(): Promise<{ ok: true }> {
    return this.send<{ ok: true }>({
      method: "reset",
      params: {},
    });
  }

  /** Terminate the current worker and start a fresh one.  Used by
   *  App.tsx's visibilitychange handler after a backgrounded tab
   *  returns to the foreground — mobile Safari (and any desktop
   *  browser under memory pressure) silently kills idle workers,
   *  and a follow-up `dispatch()` against a dead worker would hang
   *  indefinitely instead of failing fast.
   *
   *  Unlike the build worker, the runtime worker owns
   *  unrecoverable state (the dynamically-imported bundle module, the
   *  app and its storage connection).  The `onRespawn` callback
   *  lets the parent flip its pipeline back into a "needs Boot"
   *  state so the user sees a clear affordance instead of a
   *  silent next-request failure.
   *
   *  Pending RPCs are rejected with a labelled error; callers that
   *  care can retry.
   *
   *  `silent` skips the `onRespawn` callback — used by the engine, which
   *  reports the loss once for all its workers, and by its
   *  `restore()` recovery path, which respawns the worker and
   *  immediately re-boots, so the parent must NOT be told the
   *  runtime was "lost". */
  respawn(silent = false): void {
    if (this.disposed) return;
    try {
      this.worker.terminate();
    } catch {
      /* terminate on a dead worker can throw; ignore */
    }
    for (const slot of this.pending.values()) {
      slot.reject(new Error("Runtime worker respawned; retry the operation."));
    }
    this.pending.clear();
    this.onTerminate?.();
    this.spawn();
    if (!silent) this.onRespawn?.();
  }

  dispose(): void {
    this.disposed = true;
    try {
      this.worker.terminate();
    } catch {
      /* ignore */
    }
    for (const slot of this.pending.values()) {
      slot.reject(new Error("Runtime client disposed"));
    }
    this.pending.clear();
    this.onTerminate?.();
  }
}
