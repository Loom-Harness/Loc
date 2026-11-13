// esbuild plugin resolving over the installed in-VFS node_modules.
// Generated project files AND installed packages live in one file
// map; bare specifiers go through the exports-aware node resolver
// (node-resolve.ts), relatives/absolutes probe the map directly.
// Reading each package's own published files (no CDN re-build) is
// what makes the drizzle `extractUsedTable` split-shard bug class
// impossible.

import type { Loader, Plugin } from "esbuild-wasm";
import { resolveBare, type FileSource } from "../node-resolve.js";
import type { TsconfigAliasEntry } from "../../bundle/plugin.js";
import { aliasCandidates } from "../../bundle/plugin.js";
import { adaptResourceSource, fsFacade, PATH_FACADE, RESOURCE_FACADE_PACKAGES } from "./resource-facades.js";

// Conditions threaded through node-resolve.  `browser` is prepended so
// `exports` maps that distinguish `browser` vs `node` (pino, ws,
// node-fetch, …) pick the browser entry — pino's browser.js bypasses
// sonic-boom entirely (no `util.inherits`, no fs writes), so the
// playground bundle doesn't try to load a Node-only transport.
// Without this, pino lands on `pino.js` and crashes at module init in
// the worker.  `default` always closes the list per Node's resolver.

const PLAYGROUND_CONDITIONS = ["browser", "import", "module", "default"] as const;

const NS = "vfs";
const EMPTY = "vfs-empty";
const EMPTY_CSS = "vfs-empty-css";

// Node builtins the curated backend may reference in branches the
// browser/PGlite path never takes (the `pg` driver tree etc.).
// Stubbed so the bundle stays self-contained and builds; B4 verifies
// the live browser entry never actually needs one.
// A synchronous SHA-256 for the `node:crypto` polyfill's `createHash`: the
// generated OIDC handshake derives its PKCE challenge with it, and WebCrypto's
// digest is async-only.
export const SYNC_SHA256 = `function sha256(bytes) {
  const K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
  const H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const n = bytes.length, padded = new Uint8Array(((n + 9 + 63) >> 6) << 6);
  padded.set(bytes); padded[n] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(n / 0x20000000)); dv.setUint32(padded.length - 4, (n << 3) >>> 0);
  const W = new Uint32Array(64), r = (x, k) => (x >>> k) | (x << (32 - k));
  for (let o = 0; o < padded.length; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) W[i] = (W[i-16] + (r(W[i-15],7) ^ r(W[i-15],18) ^ (W[i-15] >>> 3)) + W[i-7] + (r(W[i-2],17) ^ r(W[i-2],19) ^ (W[i-2] >>> 10))) >>> 0;
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (r(e,6) ^ r(e,11) ^ r(e,25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
      const t2 = ((r(a,2) ^ r(a,13) ^ r(a,22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32), odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i]);
  return out;
}`;

const NODE_BUILTINS = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster",
  "console", "constants", "crypto", "dgram", "diagnostics_channel",
  "dns", "domain", "events", "fs", "http", "http2", "https",
  "inspector", "module", "net", "os", "path", "perf_hooks",
  "process", "punycode", "querystring", "readline", "repl",
  "stream", "string_decoder", "sys", "timers", "tls", "trace_events",
  "tty", "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib",
]);

// The infrastructure client packages a generated Node backend imports for its
// broker transports and durable `cron:` timers.  None of them can run in the
// browser — they open TCP connections — and their module bodies subclass
// Node's EventEmitter at evaluation, which kills the whole bundle import in a
// worker.  The preview never constructs them: the worker boots with
// `bootApp(db, { infra: "in-process" })`, which puts every channel binding on
// an in-memory transport and runs `cron:` timers in-process.  So each is
// swapped at bundle time for a module with the same exports whose
// constructors throw, naming the package — loud if anything ever reaches one.
// An emulated broker replaces these stubs with facades over the same exports.
const unavailable = (pkg: string): string =>
  `const unavailable = (what) => { throw new Error(${JSON.stringify(pkg)} + ": " + what + " is not available in the browser preview, which boots with infra: 'in-process'"); };`;
// `node:async_hooks` for the browser preview.  A backend keeps per-request
// state (the current user, the tenant, the request logger) in
// `AsyncLocalStorage`, and work it starts outside a request (channel
// consumers, `every:` / `cron:` timers, the outbox relay) runs its own
// `run(...)` that can interleave with a request's awaits.  Each async chain
// must therefore see its own store, as on Node.
//
// The context is one immutable map (storage → store) that is current while a
// callback runs.  It travels with the continuation: `Promise.prototype.then`,
// `queueMicrotask`, `setTimeout` and `setInterval` capture the context at the
// moment a callback is scheduled and restore it while the callback runs, and
// `Promise.resolve` runs a non-native thenable's `then` (an ORM query builder)
// in the context it was awaited from, as Node does.  A
// native `await` does not call `then`, so the backend bundle lowers
// `async`/`await` (`BACKEND_LOWERED_SYNTAX`) and every continuation goes
// through the patched `then`.  The patches install once per realm.  Host code
// outside the bundle that calls a bundle callback back after its own native
// awaits (the storage client's `transaction`) binds it on entry through
// `bindToCallerContext` (`web/src/runtime/async-context.ts`).
export const ASYNC_HOOKS_POLYFILL = [
  "const KEY = Symbol.for('loom.asyncContext');",
  "const g = globalThis;",
  "if (!g[KEY]) {",
  "  const state = { current: new Map() };",
  "  const bind = (fn, ctx) => typeof fn !== 'function' ? fn : function (...a) {",
  "    const prev = state.current; state.current = ctx;",
  "    try { return fn.apply(this, a); } finally { state.current = prev; }",
  "  };",
  "  const then = Promise.prototype.then;",
  "  Promise.prototype.then = function (f, r) { return then.call(this, bind(f, state.current), bind(r, state.current)); };",
  "  const resolve = Promise.resolve;",
  "  const later = (cb) => then.call(resolve.call(Promise), cb);",
  "  Promise.resolve = function (x) {",
  "    if (x !== null && (typeof x === 'object' || typeof x === 'function') && !(x instanceof Promise)) {",
  "      let t;",
  "      try { t = x.then; } catch (e) { return Promise.reject(e); }",
  "      if (typeof t === 'function') {",
  "        const ctx = state.current;",
  "        return new this((res, rej) => later(bind(() => { try { t.call(x, res, rej); } catch (e) { rej(e); } }, ctx)));",
  "      }",
  "    }",
  "    return resolve.call(this, x);",
  "  };",
  "  if (typeof g.queueMicrotask === 'function') { const qm = g.queueMicrotask; g.queueMicrotask = (cb) => qm.call(g, bind(cb, state.current)); }",
  "  for (const t of ['setTimeout', 'setInterval']) {",
  "    const orig = g[t];",
  "    if (typeof orig === 'function') g[t] = function (cb, ...a) { return orig.call(g, bind(cb, state.current), ...a); };",
  "  }",
  "  state.bindCurrent = (fn) => bind(fn, state.current);",
  "  g[KEY] = state;",
  "}",
  "const state = g[KEY];",
  "const withStore = (als, store) => { const next = new Map(state.current); if (store === undefined) next.delete(als); else next.set(als, store); return next; };",
  "class AsyncLocalStorage {",
  "  run(store, fn, ...a) {",
  "    const prev = state.current; state.current = withStore(this, store);",
  "    try { return fn(...a); } finally { state.current = prev; }",
  "  }",
  "  exit(fn, ...a) {",
  "    const prev = state.current; state.current = withStore(this, undefined);",
  "    try { return fn(...a); } finally { state.current = prev; }",
  "  }",
  "  getStore() { return state.current.get(this); }",
  "  enterWith(store) { state.current = withStore(this, store); }",
  "  disable() { state.current = withStore(this, undefined); }",
  "}",
  "class AsyncResource {",
  "  constructor() { this._ctx = state.current; }",
  "  runInAsyncScope(fn, that, ...a) { const prev = state.current; state.current = this._ctx; try { return fn.apply(that, a); } finally { state.current = prev; } }",
  "  emitDestroy() {}",
  "  bind(fn) { return (...a) => this.runInAsyncScope(fn, undefined, ...a); }",
  "}",
  "module.exports = { AsyncLocalStorage, AsyncResource, default: { AsyncLocalStorage, AsyncResource } };",
].join("\n");

/** esbuild `supported` overrides for a backend bundle: lower `async` / `await`
 *  onto generators so each continuation runs through `Promise.prototype.then`,
 *  which carries the `ASYNC_HOOKS_POLYFILL` context. */
export const BACKEND_LOWERED_SYNTAX: Record<string, boolean> = {
  "async-await": false,
  "async-generator": false,
  "for-await": false,
};

export const BROWSER_STUBBED_PACKAGES: Record<string, string> = {
  ioredis: [
    unavailable("ioredis"),
    "export class Redis { constructor() { unavailable('new Redis()'); } }",
    "export default Redis;",
  ].join("\n"),
  kafkajs: [
    unavailable("kafkajs"),
    "export class Kafka { constructor() { unavailable('new Kafka()'); } }",
    "export const logLevel = { NOTHING: 0, ERROR: 1, WARN: 2, INFO: 4, DEBUG: 5 };",
  ].join("\n"),
  amqplib: [
    unavailable("amqplib"),
    "export function connect() { return unavailable('connect()'); }",
    "export default { connect };",
  ].join("\n"),
  "pg-boss": [
    unavailable("pg-boss"),
    "export class PgBoss { constructor() { unavailable('new PgBoss()'); } }",
    "export default PgBoss;",
  ].join("\n"),
};
const STUBBED = "vfs-stubbed-package";
// The resource facades (nodemailer, @sendgrid/mail) are stubbed packages too.
Object.assign(BROWSER_STUBBED_PACKAGES, RESOURCE_FACADE_PACKAGES);

/** A node builtin: `node:*`, an exact name, or a subpath like
 *  `fs/promises` / `stream/promises` (head segment is a builtin). */
function isNodeBuiltin(spec: string): boolean {
  if (spec.startsWith("node:")) return true;
  return NODE_BUILTINS.has(spec.split("/")[0]);
}

function dirOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}

function joinPosix(...parts: string[]): string {
  const segs: string[] = [];
  for (const part of parts.join("/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") segs.pop();
    else segs.push(part);
  }
  return "/" + segs.join("/");
}

const EXTS = [".ts", ".tsx", ".mjs", ".js", ".cjs", ".json"];
const INDEX = ["index.ts", "index.tsx", "index.js", "index.mjs", "index.cjs"];

function probe(base: string, src: FileSource): string | null {
  if (src.exists(base)) return base;
  // Generated TS uses `.js`-suffixed ESM specifiers for `.ts` files.
  if (base.endsWith(".js")) {
    for (const e of [".ts", ".tsx"]) {
      const p = base.slice(0, -3) + e;
      if (src.exists(p)) return p;
    }
  }
  for (const e of EXTS) if (src.exists(base + e)) return base + e;
  for (const i of INDEX) {
    const p = joinPosix(base, i);
    if (src.exists(p)) return p;
  }
  return null;
}

/** Keep react/react-dom (and their subpaths: jsx-runtime,
 *  react-dom/client, …) external so the iframe importmap supplies a
 *  single instance.  Must be done IN the plugin: esbuild's `external`
 *  option is overridden by this catch-all onResolve, so relying on it
 *  alone silently bundles a second React. */
const REACT_RUNTIME_RE = /^(react|react-dom)(\/|$)/;

// shadcn globals.css does `@import "tailwindcss"` (+ optionally
// `@import "tw-animate-css"`).  esbuild's CSS loader would try to
// resolve those into JS (tailwindcss/dist/lib.mjs) and fail; instead
// leave them external so the directive survives into the bundled CSS,
// where the iframe's `@tailwindcss/browser` compiles it at runtime.
const TAILWIND_CSS_RE = /^tailwindcss($|\/)|^tw-animate-css$/;

// `data:` / `http:` / `https:` / `blob:` / … — anything carrying a URL
// scheme.  An npm package name can never contain `:`, so this can't
// shadow a real specifier.  See the onResolve arm for why it's needed.
const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/** A package's `browser` field as a per-file map (`{ "./dist-es/runtimeConfig":
 *  "./dist-es/runtimeConfig.browser" }`): the AWS SDK's clients pick their
 *  fetch-based runtime config this way, and the node one it replaces reads
 *  `process` and node-only packages at module evaluation.  A string-valued
 *  top-level `browser` is handled by the resolver; `false` (an empty module)
 *  entries are left alone. */
/** Packages whose `browser` map must NOT apply: the browser build parses XML
 *  with `DOMParser`, which a worker lacks; the node build's pure-JS parser runs. */
const BROWSER_MAP_SKIP = new Set(["/node_modules/@aws-sdk/xml-builder"]);

export function remapBrowserFile(abs: string, read: (p: string) => string | undefined, cache: Map<string, Record<string, string> | null>): string {
  const m = /^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\/(.+)$/.exec(abs);
  if (!m) return abs;
  const root = m[1] as string;
  if (BROWSER_MAP_SKIP.has(root)) return abs;
  let map = cache.get(root);
  if (map === undefined) {
    map = null;
    try {
      const pkg = JSON.parse(read(`${root}/package.json`) ?? "null") as { browser?: unknown } | null;
      if (pkg && typeof pkg.browser === "object" && pkg.browser !== null) {
        map = Object.fromEntries(
          Object.entries(pkg.browser as Record<string, unknown>).filter(
            (e): e is [string, string] => typeof e[1] === "string",
          ),
        );
      }
    } catch {
      /* unreadable package.json: no remap */
    }
    cache.set(root, map);
  }
  if (!map) return abs;
  const strip = (f: string): string => f.replace(/\.(c|m)?js$/, "");
  const rel = strip(`./${m[2]}`);
  for (const [from, to] of Object.entries(map)) {
    if (strip(from) === rel) return joinPosix(root, to);
  }
  return abs;
}

export function makeVfsNpmPlugin(
  files: Map<string, string | Uint8Array>,
  nmRoot = "/node_modules",
  externalReact = false,
  /** tsconfig `paths` aliases (e.g. shadcn's `@/* → src/*`).  Targets
   *  are absolute VFS paths (harvested against the "/"-keyed map);
   *  matched before bare-package resolution so `@/components/ui/button`
   *  resolves to a real file instead of being treated as a package. */
  aliases: TsconfigAliasEntry[] = [],
  /** C2: externalise the whole vendor (every bare specifier left
   *  after aliases) so esbuild bundles ONLY the generated app —
   *  the prebuilt vendor + iframe importmap supply the rest.  Bare
   *  CSS imports (e.g. `@mantine/core/styles.css`) become empty
   *  stubs since the prebuilt vendor.css covers them. */
  externalizeVendor = false,
): Plugin {
  const td = new TextDecoder();
  const asText = (v: string | Uint8Array): string =>
    typeof v === "string" ? v : td.decode(v);
  const src: FileSource = {
    read: (p) => {
      const v = files.get(p);
      return v == null ? undefined : asText(v);
    },
    exists: (p) => files.has(p),
  };

  const browserMaps = new Map<string, Record<string, string> | null>();

  return {
    name: "loom-vfs-npm",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const spec = args.path;
        if (TAILWIND_CSS_RE.test(spec)) {
          // Keep `@import "tailwindcss"` in the output CSS for the
          // iframe's Tailwind browser runtime to compile.
          return { path: spec, external: true };
        }
        if (externalReact && REACT_RUNTIME_RE.test(spec)) {
          return { path: spec, external: true };
        }
        if (isNodeBuiltin(spec)) {
          return { path: spec, namespace: EMPTY };
        }
        if (Object.hasOwn(BROWSER_STUBBED_PACKAGES, spec)) {
          return { path: spec, namespace: STUBBED };
        }
        // A URL is not a module specifier — pass it through verbatim.
        // esbuild routes CSS `url()` tokens through onResolve, so an
        // inlined icon (`url("data:image/svg+xml,…")`) or a remote asset
        // (`url("https://…")`) in any bundled stylesheet reaches this
        // catch-all; without this it falls all the way to bare-package
        // resolution and fails with `vfs: bare "data:image/svg+xml,…" not
        // in installed node_modules`.  `external` keeps the original token
        // in the emitted CSS, which is what a data URI wants (it is already
        // self-contained) and the only thing a remote URL can do.
        // Ordered AFTER the builtin check so `node:fs` still stubs out.
        if (URL_SCHEME_RE.test(spec) || spec.startsWith("//")) {
          return { path: spec, external: true };
        }
        if (spec.startsWith("/") || spec.startsWith("./") || spec.startsWith("../")) {
          const fromDir =
            args.importer && args.importer.startsWith("/")
              ? dirOf(args.importer)
              : args.resolveDir || "/";
          const abs = spec.startsWith("/")
            ? joinPosix(spec)
            : joinPosix(fromDir, spec);
          const r = probe(remapBrowserFile(abs, src.read, browserMaps), src);
          return r
            ? { path: r, namespace: NS }
            : { errors: [{ text: `vfs: cannot resolve ${spec} from ${args.importer || "<entry>"}` }] };
        }
        // tsconfig path aliases (`@/...`) before bare resolution.
        for (const a of aliases) {
          const candidates = aliasCandidates(spec, a);
          if (!candidates) continue;
          for (const c of candidates) {
            const hit = probe(c, src);
            if (hit) return { path: hit, namespace: NS };
          }
        }
        const r = resolveBare(spec, src, nmRoot, PLAYGROUND_CONDITIONS);
        if (r) return { path: r, namespace: NS };
        // Vendor-externalise: a bare specifier with no app-side
        // resolution is vendor — externalise it (JS) or stub it
        // (CSS, covered by the prebuilt vendor.css).  esbuild then
        // bundles only the app; the iframe importmap resolves these.
        if (externalizeVendor) {
          return spec.endsWith(".css")
            ? { path: spec, namespace: EMPTY_CSS }
            : { path: spec, external: true };
        }
        return { errors: [{ text: `vfs: bare "${spec}" not in installed node_modules` }] };
      });

      build.onLoad({ filter: /.*/, namespace: STUBBED }, (args) => ({
        contents: BROWSER_STUBBED_PACKAGES[args.path],
        loader: "js",
      }));

      build.onLoad({ filter: /.*/, namespace: EMPTY_CSS }, () => ({
        contents: "",
        loader: "css",
      }));

      build.onLoad({ filter: /.*/, namespace: EMPTY }, (args) => {
        const name = args.path.replace(/^node:/, "").split("/")[0];
        // fs — localDisk's `fs.promises` verbs, forwarded to the infra
        // worker's disk (see resource-facades.ts).
        if (name === "path") return { contents: PATH_FACADE, loader: "js" };
        if (name === "fs") return { contents: fsFacade(args.path), loader: "js" };
        // crypto is the one builtin the live browser/PGlite backend
        // path actually uses (generated repos call randomUUID for
        // ids).  Back it by Web Crypto.  CJS form so esbuild does
        // runtime property access — no static "no matching export"
        // for arbitrary named imports from the empty stubs.
        if (name === "crypto") {
          return {
            contents: [
              "const c = globalThis.crypto;",
              "const toBuf = (u8) => (globalThis.Buffer ? globalThis.Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength) : u8);",
              "const randomUUID = () => c.randomUUID();",
              "const getRandomValues = (a) => c.getRandomValues(a);",
              "const randomBytes = (n) => toBuf(c.getRandomValues(new Uint8Array(n)));",
              SYNC_SHA256,
              "function createHash(alg) {",
              "  if (String(alg).toLowerCase() !== 'sha256') throw new Error('crypto.createHash: only sha256 is available in the browser preview');",
              "  const parts = [];",
              "  const h = {",
              "    update(d) { parts.push(typeof d === 'string' ? new TextEncoder().encode(d) : new Uint8Array(d.buffer ? d.buffer : d, d.byteOffset || 0, d.byteLength === undefined ? d.length : d.byteLength)); return h; },",
              "    digest(enc) {",
              "      const len = parts.reduce((n, p) => n + p.length, 0);",
              "      const all = new Uint8Array(len); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }",
              "      const out = toBuf(sha256(all));",
              "      return enc ? out.toString(enc) : out;",
              "    },",
              "  };",
              "  return h;",
              "}",
              "module.exports = { randomUUID, getRandomValues, randomBytes, createHash, webcrypto: c, default: c };",
            ].join("\n"),
            loader: "js",
          };
        }
        // async_hooks — generated obs/als.ts constructs
        // `new AsyncLocalStorage()`; see ASYNC_HOOKS_POLYFILL.
        if (name === "async_hooks") {
          return { contents: ASYNC_HOOKS_POLYFILL, loader: "js" };
        }
        // util — pino/sonic-boom depend on `util.inherits` (and
        // `util.format`).  The empty stub returns undefined for both,
        // which makes the generated backend crash at boot in the
        // playground with `inherits is not a function`.  Polyfill just
        // enough so common older Node patterns work; everything else
        // stays undefined-but-safe.
        if (name === "util") {
          return {
            contents: [
              "function inherits(ctor, sup) {",
              "  if (sup) {",
              "    ctor.super_ = sup;",
              "    Object.setPrototypeOf(ctor.prototype, sup.prototype);",
              "  }",
              "}",
              // Best-effort format: `%s`/`%d`/`%j` placeholders.  Falls
              // back to space-joined String() for unsupported tokens —
              // pino/sonic-boom only use it for very simple messages
              // along the error path, so a coarse impl is fine.
              "function format(f) {",
              "  if (typeof f !== 'string') return Array.from(arguments).map(String).join(' ');",
              "  const args = Array.prototype.slice.call(arguments, 1);",
              "  let i = 0;",
              "  return f.replace(/%[sdj%]/g, (m) => {",
              "    if (m === '%%') return '%';",
              "    if (i >= args.length) return m;",
              "    const a = args[i++];",
              "    if (m === '%s') return String(a);",
              "    if (m === '%d') return Number(a).toString();",
              "    try { return JSON.stringify(a); } catch { return String(a); }",
              "  });",
              "}",
              "function promisify(fn) { return (...a) => new Promise((res, rej) => fn(...a, (e, v) => e ? rej(e) : res(v))); }",
              "function inspect(v) { try { return JSON.stringify(v); } catch { return String(v); } }",
              "const types = { isPromise: (v) => v && typeof v.then === 'function' };",
              "module.exports = { inherits, format, promisify, inspect, types, default: { inherits, format, promisify, inspect, types } };",
            ].join("\n"),
            loader: "js",
          };
        }
        // buffer — the companion to the global installed by the runtime
        // worker (buffer-polyfill.ts).  An explicit `import { Buffer } from
        // "buffer"` (pg-protocol and friends do both) must resolve to that
        // same implementation, or the empty stub hands back `undefined` and
        // the module dies on `Buffer.allocUnsafe` exactly as if the global
        // were missing.
        if (name === "buffer") {
          return {
            contents: [
              "const B = globalThis.Buffer;",
              "module.exports = { Buffer: B, kMaxLength: 0x7fffffff, INSPECT_MAX_BYTES: 50, default: { Buffer: B } };",
            ].join("\n"),
            loader: "js",
          };
        }
        // process — `require("process")` must be the SAME object as the
        // global one the bundle prefix installs (see
        // `npm/postprocess.ts`), not a fresh `{}`.  prom-client's
        // `processOpenFileDescriptors` does exactly this require and then
        // reads `process.platform`; an empty stub silently re-opens the
        // hole the global shim just closed.
        if (name === "process") {
          return {
            // Assign the live object, don't copy or decorate it — the smoke
            // script runs this same bundler in Node, where `globalThis.process`
            // is the REAL process and must not grow stray properties.
            contents: "module.exports = globalThis.process;",
            loader: "js",
          };
        }
        return { contents: "module.exports = {};", loader: "js" };
      });

      build.onLoad({ filter: /.*/, namespace: NS }, (args) => {
        const v = files.get(args.path);
        if (v == null) return { errors: [{ text: `vfs: missing ${args.path}` }] };
        const ext = args.path.slice(args.path.lastIndexOf("."));
        const loader: Loader =
          ext === ".ts"
            ? "ts"
            : ext === ".tsx"
              ? "tsx"
              : ext === ".json"
                ? "json"
                : ext === ".css"
                  ? "css"
                  : "js";
        const text = asText(v);
        return { contents: adaptResourceSource(args.path, text) ?? text, loader, resolveDir: dirOf(args.path) };
      });
    },
  };
}
