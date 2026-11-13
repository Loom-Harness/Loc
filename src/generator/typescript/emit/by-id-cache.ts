// The node by-id read cache — `cache/by-id-cache.ts` and the read-through
// lines of a cached aggregate's `GET /{id}` route.
//
// Everything this file renders is decided by the cache plan
// (`src/ir/plan/cache.ts`): which aggregates are cached, the entry prefix, the
// ttl, the scope inputs of the fingerprint and the evicting writes.  This file
// only spells them in TypeScript:
//
//   - a `CacheStore` per cache resource — ioredis for a `redis` storage (the
//     `<RESOURCE>_URL` connection, valkey in the dev compose), a `Map` with
//     expiry for `inMemory`;
//   - one `ByIdCache` per cached aggregate;
//   - `evictOnWrite`, which wraps the repository class's `save` and `delete`
//     — every write of an aggregate reaches one of them, whichever persistence
//     adapter built the class — so the module is imported once, at app
//     construction, and every repository instance evicts;
//   - the route: fingerprint the caller, answer a hit from the entry, and
//     store a miss's wire answer under the fingerprint.  `x-loom-cache` says
//     which one happened.
//
// A store that refuses a call never fails the request: a read falls back to
// the database, a failed write or eviction is logged and the entry expires at
// its ttl.

import {
  CACHE_STATUS_HEADER,
  type CachedByIdRead,
  type CacheScopeInput,
  cacheStoragesOf,
} from "../../../ir/plan/cache.js";
import type { DeployableIR, SystemIR } from "../../../ir/types/loom-ir.js";
import { lowerFirst } from "../../../util/naming.js";
import { resourceEnvUrlVar, resourceSidecarUrl } from "../../../util/resource-env.js";
import { ref } from "../../_imports/symbol.js";
import { tsNamed } from "../../_imports/ts.js";
import { renderHonoStoreLogCall } from "../../_obs/render-hono.js";
import { T } from "../ts-symbols.js";

/** Where the module lives, relative to the project root. */
export const BY_ID_CACHE_PATH = "cache/by-id-cache.ts";

/** The exported `ByIdCache` constant of one cached aggregate. */
function byIdCacheName(read: Pick<CachedByIdRead, "aggregate">): string {
  return `${lowerFirst(read.aggregate)}Cache`;
}

function storeName(resource: string): string {
  return `${lowerFirst(resource)}Store`;
}

/** One fingerprint input as TypeScript. */
function scopeValue(input: CacheScopeInput): string {
  return input.kind === "principal"
    ? `${T.requireCurrentUser}()`
    : `${T.requireCurrentUser}().${input.claim}`;
}

/** The caller's scope fingerprint: the JSON array of the plan's inputs. */
function scopeFingerprintTs(read: CachedByIdRead): string {
  return read.scope.length === 0
    ? `"[]"`
    : `JSON.stringify([${read.scope.map(scopeValue).join(", ")}])`;
}

/** The lines that open a cached `GET /{id}` handler: a hit answers here.
 *  `idExpr` is the route's id, `indent` the handler body's indentation. */
function cacheRef(read: CachedByIdRead): string {
  return ref(tsNamed(`~/${BY_ID_CACHE_PATH.replace(/\.ts$/, "")}`, byIdCacheName(read)));
}

export function renderCacheHit(read: CachedByIdRead, idExpr: string, indent: string): string[] {
  const cache = cacheRef(read);
  return [
    `${indent}const __scope = ${scopeFingerprintTs(read)};`,
    `${indent}const __hit = await ${cache}.read(${idExpr}, __scope);`,
    `${indent}if (__hit) {`,
    `${indent}  if (__hit.etag !== null) c.header("etag", __hit.etag);`,
    `${indent}  c.header("${CACHE_STATUS_HEADER}", "hit");`,
    `${indent}  return c.body(__hit.body, 200, { "content-type": "application/json" });`,
    `${indent}}`,
  ];
}

/** The lines that store a miss's wire answer `outExpr` before it is
 *  returned.  `etagExpr` is the version tag the route sends, or `null`. */
export function renderCacheStore(
  read: CachedByIdRead,
  idExpr: string,
  outExpr: string,
  etagExpr: string,
  indent: string,
): string[] {
  return [
    `${indent}await ${cacheRef(read)}.write(${idExpr}, __scope, { body: JSON.stringify(${outExpr}), etag: ${etagExpr} });`,
    `${indent}c.header("${CACHE_STATUS_HEADER}", "miss");`,
  ];
}

/** `cache/by-id-cache.ts`, or null when the deployable caches nothing. */
export function renderByIdCacheModule(
  sys: SystemIR,
  deployable: Pick<DeployableIR, "dataSourceNames">,
  reads: readonly CachedByIdRead[],
): string | null {
  if (reads.length === 0) return null;
  const stores = cacheStoragesOf(sys, deployable).filter((s) =>
    reads.some((r) => r.storage === s.storage),
  );
  const usesRedis = stores.some((s) => s.storageType === "redis");
  const warn = (op: string) =>
    renderHonoStoreLogCall(
      "cacheUnavailable",
      `aggregate: this.aggregate, op: "${op}", error: String(err)`,
    );
  const storeLines = stores.flatMap((s) => {
    const resource = reads.find((r) => r.storage === s.storage)!.resource;
    if (s.storageType === "inMemory") {
      return [`const ${storeName(s.storage)}: CacheStore = new MemoryStore();`];
    }
    const url = resourceSidecarUrl("redis", s.storage)!;
    const env = resourceEnvUrlVar(resource);
    return [
      `const ${storeName(s.storage)}: CacheStore = new RedisStore(process.env.${env} ?? ${JSON.stringify(url)});`,
    ];
  });
  return [
    "// Auto-generated.  Do not edit by hand.",
    "//",
    "// The by-id read cache: a `GET /{id}` answer per caller scope, evicted by",
    "// every write of the aggregate.",
    `import { requestLog } from "../obs/als";`,
    "",
    "/** The key-value store the entries live in. */",
    "interface CacheStore {",
    "  get(key: string): Promise<string | null>;",
    "  set(key: string, value: string, ttlSeconds: number): Promise<void>;",
    "  del(key: string): Promise<void>;",
    "}",
    "",
    ...(usesRedis
      ? [
          "class RedisStore implements CacheStore {",
          `  private readonly client: ${T.Redis};`,
          "  constructor(url: string) {",
          "    // Connects on first use, and fails a call instead of queueing it while",
          "    // the server is away: the caller then reads the database.",
          `    this.client = new ${T.Redis}(url, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });`,
          "  }",
          "  async get(key: string): Promise<string | null> {",
          "    await this.connected();",
          "    return this.client.get(key);",
          "  }",
          "  async set(key: string, value: string, ttlSeconds: number): Promise<void> {",
          "    await this.connected();",
          `    await this.client.set(key, value, "EX", ttlSeconds);`,
          "  }",
          "  async del(key: string): Promise<void> {",
          "    await this.connected();",
          "    await this.client.del(key);",
          "  }",
          "  private async connected(): Promise<void> {",
          `    if (this.client.status === "wait") await this.client.connect();`,
          "  }",
          "}",
          "",
        ]
      : []),
    "class MemoryStore implements CacheStore {",
    "  private readonly entries = new Map<string, { value: string; expiresAt: number }>();",
    "  async get(key: string): Promise<string | null> {",
    "    const entry = this.entries.get(key);",
    "    if (!entry) return null;",
    "    if (entry.expiresAt <= Date.now()) {",
    "      this.entries.delete(key);",
    "      return null;",
    "    }",
    "    return entry.value;",
    "  }",
    "  async set(key: string, value: string, ttlSeconds: number): Promise<void> {",
    "    this.entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });",
    "  }",
    "  async del(key: string): Promise<void> {",
    "    this.entries.delete(key);",
    "  }",
    "}",
    "",
    "/** One by-id answer as the route served it. */",
    "export interface CachedAnswer {",
    "  body: string;",
    "  etag: string | null;",
    "}",
    "",
    "/** The cached by-id reads of one aggregate: one entry per id, holding each",
    " *  caller scope's answer. */",
    "export class ByIdCache {",
    "  constructor(",
    "    private readonly aggregate: string,",
    "    private readonly store: CacheStore,",
    "    private readonly entryPrefix: string,",
    "    private readonly ttlSeconds: number,",
    "  ) {}",
    "",
    "  async read(id: string, scope: string): Promise<CachedAnswer | undefined> {",
    "    try {",
    "      const raw = await this.store.get(this.entryPrefix + id);",
    "      if (raw === null) return undefined;",
    "      return (JSON.parse(raw) as Record<string, CachedAnswer>)[scope];",
    "    } catch (err) {",
    `      ${warn("read")}`,
    "      return undefined;",
    "    }",
    "  }",
    "",
    "  async write(id: string, scope: string, answer: CachedAnswer): Promise<void> {",
    "    try {",
    "      const key = this.entryPrefix + id;",
    "      const raw = await this.store.get(key);",
    "      const entry = raw === null ? {} : (JSON.parse(raw) as Record<string, CachedAnswer>);",
    "      await this.store.set(key, JSON.stringify({ ...entry, [scope]: answer }), this.ttlSeconds);",
    "    } catch (err) {",
    `      ${warn("write")}`,
    "    }",
    "  }",
    "",
    "  async evict(id: string): Promise<void> {",
    "    try {",
    "      await this.store.del(this.entryPrefix + id);",
    "    } catch (err) {",
    `      ${warn("evict")}`,
    "    }",
    "  }",
    "}",
    "",
    "/** Every write of an aggregate reaches one of its repository's writing",
    " *  methods (`save(aggregate)`, `delete(id)`): each evicts the written id once",
    " *  the write is done. */",
    "function evictOnWrite(repository: { prototype: unknown }, cache: ByIdCache, methods: readonly string[]): void {",
    "  const proto = repository.prototype as Record<string, (...args: unknown[]) => Promise<unknown>>;",
    "  for (const method of methods) {",
    "    const write = proto[method];",
    "    if (!write) continue;",
    "    proto[method] = async function (this: unknown, ...args: unknown[]) {",
    "      const result = await write.apply(this, args);",
    "      const subject = args[0];",
    '      const id = typeof subject === "object" && subject !== null && "id" in subject ? subject.id : subject;',
    "      await cache.evict(String(id));",
    "      return result;",
    "    };",
    "  }",
    "}",
    "",
    ...storeLines,
    "",
    ...reads.map(
      (r) =>
        `export const ${byIdCacheName(r)} = new ByIdCache(${JSON.stringify(r.aggregate)}, ${storeName(r.storage)}, ${JSON.stringify(r.entryPrefix)}, ${r.ttlSeconds});`,
    ),
    "",
    "let installed = false;",
    "",
    "/** Wrap every cached aggregate's repository writes with its eviction.  Called",
    " *  once, by `createApp`, before any repository is written through. */",
    "export function installByIdCacheEviction(): void {",
    "  if (installed) return;",
    "  installed = true;",
    ...reads.map(
      (r) =>
        `  evictOnWrite(${ref(tsNamed(`~/db/repositories/${lowerFirst(r.aggregate)}-repository`, `${r.aggregate}Repository`))}, ${byIdCacheName(r)}, ${JSON.stringify(r.evictOn)});`,
    ),
    "}",
    "",
  ].join("\n");
}
