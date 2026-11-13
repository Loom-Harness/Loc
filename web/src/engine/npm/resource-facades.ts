// Bundle-time facades for the generated `resources/<sourceType>.ts` clients.
// They hold no state: each forwards to a service in the infra worker through
// `globalThis.__loomInfra` (installed by `runtime/resource-fakes.ts`).
//
//   smtp       `nodemailer` → Mailbox        (facade package)
//   sendgrid   `@sendgrid/mail` → Mailbox    (facade package)
//   ses        real `@aws-sdk/client-ses`, its HTTP answered by the fake SES
//   s3         real `@aws-sdk/client-s3` + presigner, HTTP answered by the fake S3
//   localDisk  `node:fs` → the infra worker's disk
//   restApi    `fetch(new URL(…))` → the httpMock service
//   cache      `ioredis` → the cache service    (facade package; one keyspace per server URL)
//
// The AWS clients are real, so `adaptResourceSource` only supplies the
// credentials the browser SDK build cannot discover (a deployed backend reads
// them from the environment).  The fake endpoints ignore signatures.

const infra = "globalThis.__loomInfra";

const capture = (via: string, mailVar: string): string =>
  `${infra}.call("mailbox", "capture", { via: ${JSON.stringify(via)}, from: ${mailVar}.from ?? "", to: [].concat(${mailVar}.to ?? []).map(String), subject: ${mailVar}.subject ?? "", text: ${mailVar}.text ?? "", ...(${mailVar}.html ? { html: String(${mailVar}.html) } : {}) })`;

/** The `ioredis` facade: every command goes to the infra worker's cache
 *  service, keyed by the server URL the client was built with.  Pub/sub and
 *  streams are not served here — the channel drivers reach the broker through
 *  the `ChannelTransport` facade instead. */
const IOREDIS_FACADE = [
  "const serverOf = (a, b) => {",
  "  if (typeof a === 'string') return a;",
  "  const o = (a && typeof a === 'object' ? a : b) || {};",
  "  return `redis://${o.host || 'localhost'}:${o.port || 6379}/${o.db || 0}`;",
  "};",
  "const unsupported = (name) => () => Promise.reject(new Error(`ioredis.${name}: not emulated in the playground (the cache serves GET/SET/DEL/INCR/EXISTS/PTTL/FLUSHDB)`));",
  "export class Redis {",
  "  constructor(a, b) { this.server = serverOf(a, b); this.status = 'ready'; this.handlers = {}; }",
  `  call(name, ...args) { return ${infra}.call('cache', 'command', { server: this.server, name: String(name), args: args.flat().map((x) => typeof x === 'number' ? x : String(x)) }); }`,
  "  get(k) { return this.call('get', k); }",
  "  set(k, v, ...opts) { return this.call('set', k, v, ...opts); }",
  "  del(...k) { return this.call('del', ...k); }",
  "  incr(k) { return this.call('incr', k); }",
  "  exists(...k) { return this.call('exists', ...k); }",
  "  pttl(k) { return this.call('pttl', k); }",
  "  flushdb() { return this.call('flushdb'); }",
  "  async connect() {}",
  "  async quit() { this.status = 'end'; return 'OK'; }",
  "  disconnect() { this.status = 'end'; }",
  "  on() { return this; }",
  "  once() { return this; }",
  "}",
  "for (const m of ['subscribe', 'psubscribe', 'publish', 'xadd', 'xread', 'xreadgroup', 'xgroup', 'xack']) Redis.prototype[m] = unsupported(m);",
  "export default Redis;",
].join("\n");

export const RESOURCE_FACADE_PACKAGES: Readonly<Record<string, string>> = {
  ioredis: IOREDIS_FACADE,
  nodemailer: [
    "export function createTransport() {",
    "  return {",
    `    async sendMail(m) { const r = await ${capture("smtp", "m")}; return { messageId: r.id, accepted: r.to, rejected: [], response: "250 captured by the playground Mailbox" }; },`,
    "    async verify() { return true; },",
    "    close() {},",
    "  };",
    "}",
    "export default { createTransport };",
  ].join("\n"),
  "@sendgrid/mail": [
    "export function setApiKey() {}",
    `export async function send(m) { await ${capture("sendgrid", "m")}; return [{ statusCode: 202, body: "", headers: {} }, {}]; }`,
    "export default { setApiKey, send };",
  ].join("\n"),
};

const fsVerbs = [
  "const enoent = (p) => Object.assign(new Error(`ENOENT: no such file or directory, open '${p}'`), { code: 'ENOENT' });",
  "const bytes = (d) => typeof d === 'string' ? new TextEncoder().encode(d) : new Uint8Array(d);",
  `async function mkdir(path) { await ${infra}.call('disk', 'mkdir', { path }); }`,
  `async function writeFile(path, data) { await ${infra}.call('disk', 'write', { path, data: bytes(data) }); }`,
  `async function readFile(path, opts) { const d = await ${infra}.call('disk', 'read', { path }); if (d == null) throw enoent(path); const enc = typeof opts === 'string' ? opts : opts && opts.encoding; return enc ? new TextDecoder().decode(d) : (globalThis.Buffer ? globalThis.Buffer.from(d) : d); }`,
  `async function readdir(path) { const n = await ${infra}.call('disk', 'readdir', { path }); if (n == null) throw enoent(path); return n; }`,
  `async function rm(path) { await ${infra}.call('disk', 'rm', { path }); }`,
  "const promises = { mkdir, writeFile, readFile, readdir, rm };",
].join("\n");

/** The `node:fs` facade.  `fs` exposes only `promises` (a package probing for
 *  sync verbs keeps seeing them absent); `fs/promises` exposes the verbs. */
export function fsFacade(spec: string): string {
  const promisesEntry = /^(node:)?fs\/promises$/.test(spec);
  return [
    fsVerbs,
    promisesEntry
      ? "module.exports = { mkdir, writeFile, readFile, readdir, rm, default: promises };"
      : "module.exports = { promises, default: { promises } };",
  ].join("\n");
}

/** `node:path` (posix): the generated `localDisk` client builds its data dir
 *  with `path.join(process.cwd(), …)` at module evaluation. */
export const PATH_FACADE = [
  "function normalize(p) { const abs = p.startsWith('/'); const out = []; for (const s of p.split('/')) { if (s === '' || s === '.') continue; if (s === '..') out.pop(); else out.push(s); } return (abs ? '/' : '') + out.join('/') || (abs ? '/' : '.'); }",
  "const join = (...a) => normalize(a.filter(Boolean).join('/'));",
  "const resolve = (...a) => { let r = ''; for (const p of a) r = p.startsWith('/') ? p : r + '/' + p; return normalize(r.startsWith('/') ? r : '/' + r); };",
  "const dirname = (p) => { const n = normalize(p); const i = n.lastIndexOf('/'); return i <= 0 ? (n.startsWith('/') ? '/' : '.') : n.slice(0, i); };",
  "const basename = (p) => normalize(p).split('/').pop() || '';",
  "const posix = { sep: '/', join, resolve, normalize, dirname, basename };",
  "module.exports = { ...posix, posix, default: posix };",
].join("\n");

const CREDENTIALS = `credentials: { accessKeyId: "loom-playground", secretAccessKey: "loom-playground" }, `;

/** Adapt a generated resource module for the browser worker.  Returns `null`
 *  for every other file. */
export function adaptResourceSource(path: string, text: string): string | null {
  if (/\/resources\/(s3|ses)\.ts$/.test(path)) {
    return text.replace(/new (S3Client|SESClient)\(\{/g, (m) => `${m} ${CREDENTIALS}`);
  }
  if (/\/resources\/restApi\.ts$/.test(path)) {
    return text.replace(/await fetch\(/g, `await ${infra}.restFetch(`);
  }
  return null;
}
