// Parent ↔ preview-sandbox bridge.
//
// Replaces the Service-Worker transport (`public/preview-sw.js` +
// `sw-host.ts`).  The preview iframe loads a static stub from
// `SANDBOX_ORIGIN`; this class hands that stub the synthesised
// document plus ONE `MessagePort`, then answers the runtime requests
// the stub's `fetch` shim forwards over that port.
//
// Capability, not origin: the port is the channel.  We still pin
// `postMessage` to `SANDBOX_ORIGIN` and filter by `event.source`, so
// the handshake is correct same-origin (now) and cross-origin (after
// the origin flip) alike.
//
// Lifecycle is deterministic — no SW revival.  The bridge lives as
// long as the iframe element; a new bundle remounts the iframe, which
// re-runs the stub → ready → init handshake.

import type {
  DispatchResult,
  SerializedRequest,
} from "../../runtime/protocol.js";
import type { LogLine } from "../../util/log-line.js";

/** Runtime request the stub forwards (one per intercepted `fetch`). */
interface RuntimeForward {
  kind: "runtime";
  rid: number;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

/** A request the preview sent to a fake cloud endpoint (a presigned S3 URL). */
interface InfraHttpForward {
  kind: "infra-http";
  rid: number;
  service: "s3";
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

/** What an infra service answered (`HttpResponseData` of the infra worker). */
export interface InfraHttpResult {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

/** Console / uncaught-error line the preview's console bridge forwards. */
interface AppLogForward {
  kind: "console" | "error";
  level: LogLine["level"];
  text: string;
}

/** The element the user clicked while select mode was armed — its nearest
 *  `data-testid`, or `null` when nothing up the tree carried one. */
interface SelectedForward {
  kind: "selected";
  testid: string | null;
}

/** A navigation the preview cancelled because it led into the runtime base
 *  (the generated app's `signIn()` / `signOut()`), with the backend path. */
interface NavigateForward {
  kind: "navigate";
  url: string;
}

/** The persona the preview's login page signed in as (null: cancelled). */
interface LoginPickForward {
  kind: "login-pick";
  persona: string | null;
}

/** Reply posted back over the port for a `RuntimeForward`. */
type RuntimeReply =
  | {
      rid: number;
      ok: true;
      status: number;
      statusText: string;
      headers: Record<string, string>;
      body: string;
    }
  | {
      rid: number;
      ok: true;
      status: number;
      statusText: string;
      headers: Record<string, string>;
      body: Uint8Array;
    }
  | { rid: number; ok: false; message: string };

/** Pushed to the preview's reload controller after a rebuild. */
interface ReloadPayload {
  js: string;
  css?: string;
}

export class SandboxBridge {
  private port: MessagePort | null = null;
  private readyListener: ((e: MessageEvent) => void) | null = null;
  private disposed = false;
  /** A reload requested before the handshake completed — flushed once
   *  the port connects so an edit that lands during boot isn't lost. */
  private pendingReload: ReloadPayload | null = null;
  /** The open login page's answer. */
  private loginPick: ((persona: string | null) => void) | null = null;

  constructor(
    private readonly iframe: HTMLIFrameElement,
    private readonly targetOrigin: string,
    private readonly dispatch: (
      req: SerializedRequest,
    ) => Promise<DispatchResult>,
    /** Notified with the parent-side port once the handshake completes,
     *  and with null on dispose — so the UI test runner can drive the
     *  sandbox-hosted executor over the same channel. */
    private readonly onPort?: (port: MessagePort | null) => void,
    /** Notified for each `console.*` / uncaught-error line the preview's
     *  console bridge forwards — feeds the Output panel's "App" stream. */
    private readonly onAppLog?: (line: LogLine) => void,
    /** Notified with the clicked element's `data-testid` (or null) when
     *  select mode fires — M-T8.20 slice 4. */
    private readonly onSelected?: (testid: string | null) => void,
    /** Answers a presigned-URL request from the preview with the infra
     *  worker's object store; absent → the preview gets a 502. */
    private readonly infraHttp?: (
      req: Omit<InfraHttpForward, "kind" | "rid">,
    ) => Promise<InfraHttpResult>,
    /** Notified with the backend path of a navigation the preview cancelled
     *  (see `NavigateForward`). */
    private readonly onNavigate?: (url: string) => void,
  ) {}

  /** Show the identity provider's login page in the preview; resolves with
   *  the persona picked, or null when the user cancels. */
  showLogin(issuer: string, personas: readonly string[]): Promise<string | null> {
    this.loginPick?.(null);
    return new Promise((resolve) => {
      if (!this.port) {
        resolve(null);
        return;
      }
      this.loginPick = resolve;
      this.port.postMessage({ kind: "login", issuer, personas: [...personas] });
    });
  }

  /** Point the preview's history at the app route `path` (before a reload
   *  remounts the app there). */
  showRoute(path: string): void {
    this.port?.postMessage({ kind: "route", path });
  }

  /** The parent-side port, available after the handshake; null before
   *  connect or after dispose. */
  getPort(): MessagePort | null {
    return this.port;
  }

  /** Begin the handshake: listen for the stub's `loom-stub-ready`,
   *  then post the document + a transferred port.  Idempotent per
   *  bridge instance — the listener detaches after the first init. */
  start(html: string): void {
    const onMessage = (e: MessageEvent): void => {
      if (e.source !== this.iframe.contentWindow) return;
      const data = e.data as { type?: string } | undefined;
      if (data?.type !== "loom-stub-ready") return;
      window.removeEventListener("message", onMessage);
      this.readyListener = null;
      if (this.disposed) return;
      this.connect(html);
    };
    this.readyListener = onMessage;
    window.addEventListener("message", onMessage);
  }

  private connect(html: string): void {
    const win = this.iframe.contentWindow;
    if (!win) return;
    const channel = new MessageChannel();
    this.port = channel.port1;
    channel.port1.onmessage = (ev): void => {
      void this.onRuntimeForward(ev);
    };
    win.postMessage({ type: "loom-init", html }, this.targetOrigin, [
      channel.port2,
    ]);
    this.onPort?.(this.port);
    if (this.pendingReload) {
      const r = this.pendingReload;
      this.pendingReload = null;
      this.port.postMessage({ kind: "reload", js: r.js, css: r.css });
    }
  }

  /** Turn the preview's element-select mode on or off (M-T8.20 slice 4).
   *  A no-op before the handshake — select mode is a deliberate user
   *  action, so there is nothing worth queueing: the toggle is only
   *  reachable once the preview is up. */
  setSelectMode(on: boolean): void {
    this.port?.postMessage({ kind: "select-mode", on });
  }

  /** Hot-swap the running preview's bundle in place (no iframe remount,
   *  no document rewrite — the route and page shell survive).  Queued
   *  if the stub handshake hasn't completed yet. */
  pushReload(payload: ReloadPayload): void {
    if (this.disposed) return;
    if (!this.port) {
      this.pendingReload = payload;
      return;
    }
    this.port.postMessage({ kind: "reload", js: payload.js, css: payload.css });
  }

  private async onRuntimeForward(ev: MessageEvent): Promise<void> {
    const data = ev.data as
      | RuntimeForward
      | InfraHttpForward
      | AppLogForward
      | SelectedForward
      | NavigateForward
      | LoginPickForward
      | undefined;
    if (data && data.kind === "navigate") {
      this.onNavigate?.(data.url);
      return;
    }
    if (data && data.kind === "login-pick") {
      const pick = this.loginPick;
      this.loginPick = null;
      pick?.(data.persona);
      return;
    }
    if (data && (data.kind === "console" || data.kind === "error")) {
      this.onAppLog?.({ level: data.level, text: data.text });
      return;
    }
    if (data && data.kind === "selected") {
      // The in-frame controller disarms itself on the click, so the parent's
      // toggle has to follow — `null` means "clicked something with no test
      // id", which the caller reports rather than silently ignoring.
      this.onSelected?.(data.testid);
      return;
    }
    if (data && data.kind === "infra-http") {
      let reply: RuntimeReply;
      try {
        if (!this.infraHttp) throw new Error("No object store is running — boot the backend first.");
        const { kind: _k, rid: _r, ...req } = data;
        const res = await this.infraHttp(req);
        reply = { rid: data.rid, ok: true, status: res.status, statusText: "", headers: res.headers, body: res.body };
      } catch (err) {
        reply = { rid: data.rid, ok: false, message: err instanceof Error ? err.message : String(err) };
      }
      this.port?.postMessage(reply);
      return;
    }
    const m = data as RuntimeForward | undefined;
    if (!m || m.kind !== "runtime" || typeof m.rid !== "number") return;
    let reply: RuntimeReply;
    try {
      const result = await this.dispatch({
        url: m.url,
        method: m.method,
        headers: m.headers,
        body: m.body,
      });
      reply = result.ok
        ? {
            rid: m.rid,
            ok: true,
            status: result.response.status,
            statusText: result.response.statusText,
            headers: result.response.headers,
            body: result.response.body,
          }
        : { rid: m.rid, ok: false, message: result.message };
    } catch (err) {
      reply = {
        rid: m.rid,
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
    this.port?.postMessage(reply);
  }

  dispose(): void {
    this.disposed = true;
    this.loginPick?.(null);
    this.loginPick = null;
    if (this.readyListener) {
      window.removeEventListener("message", this.readyListener);
      this.readyListener = null;
    }
    this.port?.close();
    this.port = null;
    this.onPort?.(null);
  }
}
