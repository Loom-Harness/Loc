// The Python by-id read cache — `app/by_id_cache.py` and the read-through lines
// of a cached aggregate's `GET /{id}` route.
//
// Everything rendered here is decided by the cache plan (`src/ir/plan/cache.ts`):
// which aggregates are cached, the entry prefix, the ttl, the scope inputs of the
// fingerprint and the evicting writes.  This file only spells them in Python:
//
//   - a store per cache resource — redis-py's asyncio client for a `redis`
//     storage (the `<RESOURCE>_URL` connection, valkey in the dev compose), a
//     dict with expiry for `inMemory`;
//   - one `ByIdCache` per cached aggregate;
//   - `install_by_id_cache_eviction`, which wraps the repository class's `save`
//     and `delete` — every write of an aggregate reaches one of them, whichever
//     route or workflow wrote it — and is called once from the app's lifespan;
//   - the route: fingerprint the caller, answer a hit from the entry, and store a
//     miss's wire answer under the fingerprint.  `x-loom-cache` says which one
//     happened.
//
// A store that refuses a call never fails the request: a read falls back to the
// database, a failed write or eviction is logged and the entry expires at its ttl.

import {
  CACHE_STATUS_HEADER,
  type CachedByIdRead,
  type CacheScopeInput,
  cacheStoragesOf,
} from "../../ir/plan/cache.js";
import type { DeployableIR, SystemIR } from "../../ir/types/loom-ir.js";
import { lines } from "../../util/code-builder.js";
import { lowerFirst, snake } from "../../util/naming.js";
import { resourceEnvUrlVar, resourceSidecarUrl } from "../../util/resource-env.js";
import { PY_IMPORTS, pyModule, pyRef } from "../_imports/python.js";
import { ref } from "../_imports/symbol.js";

/** Where the module lives, relative to the project root. */
export const PY_BY_ID_CACHE_PATH = "app/by_id_cache.py";

const MODULE = "app.by_id_cache";

const C = {
  json: ref(pyModule("json")),
  os: ref(pyModule("os")),
  time: ref(pyModule("time")),
  functools: ref(pyModule("functools")),
  asdict: pyRef("dataclasses", "asdict"),
  User: pyRef("app.auth.user", "User"),
  Any: pyRef("typing", "Any"),
  Protocol: pyRef("typing", "Protocol"),
  Awaitable: pyRef("collections.abc", "Awaitable"),
  Callable: pyRef("collections.abc", "Callable"),
  Sequence: pyRef("collections.abc", "Sequence"),
  aioredis: ref(pyModule("redis.asyncio", "aioredis")),
  log: pyRef("app.obs.log", "log"),
  Response: pyRef("fastapi", "Response"),
  require_current_user: pyRef("app.auth.user", "require_current_user"),
} as const;

/** The module-level cache object of one cached aggregate. */
function cacheVar(read: Pick<CachedByIdRead, "aggregate">): string {
  return `${snake(read.aggregate)}_cache`;
}

/** The `ByIdCache` of `read`, as a derived-import marker. */
function byIdCacheRef(read: Pick<CachedByIdRead, "aggregate">): string {
  return pyRef(MODULE, cacheVar(read));
}

function storeVar(storage: string): string {
  return `_${snake(lowerFirst(storage))}_store`;
}

/** One fingerprint input as Python.  `user` is the caller's `User`. */
function scopeValue(input: CacheScopeInput): string {
  return input.kind === "principal"
    ? `${pyRef(MODULE, "principal_scope")}(user)`
    : `user.${snake(input.claim)}`;
}

/** Whether the route's fingerprint reads the principal. */
function readsPrincipal(read: CachedByIdRead): boolean {
  return read.scope.length > 0;
}

/** The lines that open a cached `GET /{id}` handler body: the fingerprint, and
 *  a hit answered from the entry.  `idExpr` is the route's id as a string. */
export function renderPyCacheHit(read: CachedByIdRead, idExpr: string): string[] {
  return [
    ...(readsPrincipal(read) ? [`    user = ${C.require_current_user}()`] : []),
    `    scope = ${pyRef(MODULE, "fingerprint")}(${read.scope.map(scopeValue).join(", ")})`,
    `    hit = await ${byIdCacheRef(read)}.read(${idExpr}, scope)`,
    "    if hit is not None:",
    `        return ${C.Response}(content=hit, media_type="application/json", headers={"${CACHE_STATUS_HEADER}": "hit"})`,
  ];
}

/** The lines that store a miss's wire answer `outExpr` and return it; `model` is
 *  the route's response model, so both paths send the bytes the model emits. */
export function renderPyCacheStore(
  read: CachedByIdRead,
  idExpr: string,
  outExpr: string,
  model: string,
): string[] {
  return [
    `    body = ${model}.model_validate(${outExpr}).model_dump_json(by_alias=True)`,
    `    await ${byIdCacheRef(read)}.write(${idExpr}, scope, body)`,
    `    return ${C.Response}(content=body, media_type="application/json", headers={"${CACHE_STATUS_HEADER}": "miss"})`,
  ];
}

/** `app/by_id_cache.py`, or null when the deployable caches nothing. */
export function renderPyByIdCacheModule(
  sys: SystemIR,
  deployable: Pick<DeployableIR, "dataSourceNames">,
  reads: readonly CachedByIdRead[],
): string | null {
  if (reads.length === 0) return null;
  const stores = cacheStoragesOf(sys, deployable).filter((s) =>
    reads.some((r) => r.storage === s.storage),
  );
  const usesRedis = stores.some((s) => s.storageType === "redis");
  const storeLines = stores.map((s) => {
    if (s.storageType === "inMemory") return `${storeVar(s.storage)}: CacheStore = MemoryStore()`;
    const url = resourceSidecarUrl("redis", s.storage)!;
    const env = resourceEnvUrlVar(s.resource);
    return `${storeVar(s.storage)}: CacheStore = RedisStore(${C.os}.environ.get(${JSON.stringify(env)}, ${JSON.stringify(url)}))`;
  });
  const warn = (op: string) =>
    `${C.log}("warn", "cache_unavailable", aggregate=self._aggregate, op="${op}", error=str(err))`;
  return lines(
    `"""The by-id read cache: a \`GET /{id}\` answer per caller scope, evicted by`,
    "every write of the aggregate.  Auto-generated.",
    "",
    "One entry per id holds each caller scope's answer, so a write drops every",
    "scope's answer at once.  A store that refuses a call never fails a request:",
    "a read falls back to the database, a failed write or eviction is logged and",
    'the entry expires at its ttl."""',
    "",
    PY_IMPORTS,
    "",
    "",
    `class CacheStore(${C.Protocol}):`,
    '    """The key-value store the entries live in."""',
    "",
    "    async def get(self, key: str) -> str | None: ...",
    "",
    "    async def set(self, key: str, value: str, ttl_seconds: int) -> None: ...",
    "",
    "    async def delete(self, key: str) -> None: ...",
    "",
    "",
    "class MemoryStore:",
    '    """An in-process map with expiry."""',
    "",
    "    def __init__(self) -> None:",
    "        self._entries: dict[str, tuple[str, float]] = {}",
    "",
    "    async def get(self, key: str) -> str | None:",
    "        entry = self._entries.get(key)",
    "        if entry is None:",
    "            return None",
    `        if entry[1] <= ${C.time}.monotonic():`,
    "            del self._entries[key]",
    "            return None",
    "        return entry[0]",
    "",
    "    async def set(self, key: str, value: str, ttl_seconds: int) -> None:",
    `        self._entries[key] = (value, ${C.time}.monotonic() + ttl_seconds)`,
    "",
    "    async def delete(self, key: str) -> None:",
    "        self._entries.pop(key, None)",
    "",
    "",
    ...(usesRedis
      ? [
          "class RedisStore:",
          '    """redis-py\'s asyncio client.  It connects on first use and fails a call',
          '    quickly while the server is away, so the caller reads the database."""',
          "",
          "    def __init__(self, url: str) -> None:",
          `        self._client = ${C.aioredis}.Redis.from_url(`,
          "            url, decode_responses=True, socket_connect_timeout=1, socket_timeout=1",
          "        )",
          "",
          "    async def get(self, key: str) -> str | None:",
          "        value: str | None = await self._client.get(key)",
          "        return value",
          "",
          "    async def set(self, key: str, value: str, ttl_seconds: int) -> None:",
          "        await self._client.set(key, value, ex=ttl_seconds)",
          "",
          "    async def delete(self, key: str) -> None:",
          "        await self._client.delete(key)",
          "",
          "",
        ]
      : []),
    `def principal_scope(user: ${C.User}) -> dict[str, object]:`,
    '    """The whole principal: its declared claims and the per-request operating-org',
    '    slots, which are class attributes and so not part of `asdict`."""',
    "    return {",
    `        **${C.asdict}(user),`,
    '        "operating_org": getattr(user, "operating_org", ""),',
    '        "operating_ancestors": getattr(user, "operating_ancestors", ()),',
    "    }",
    "",
    "",
    "def fingerprint(*inputs: object) -> str:",
    '    """The caller scope: the JSON array of the principal inputs the read depends on."""',
    `    return ${C.json}.dumps(list(inputs), separators=(",", ":"), default=str, sort_keys=True)`,
    "",
    "",
    "class ByIdCache:",
    '    """The cached by-id reads of one aggregate."""',
    "",
    "    def __init__(",
    "        self, aggregate: str, store: CacheStore, entry_prefix: str, ttl_seconds: int",
    "    ) -> None:",
    "        self._aggregate = aggregate",
    "        self._store = store",
    "        self._entry_prefix = entry_prefix",
    "        self._ttl_seconds = ttl_seconds",
    "",
    "    async def read(self, entry_id: str, scope: str) -> str | None:",
    "        try:",
    "            raw = await self._store.get(self._entry_prefix + entry_id)",
    "            if raw is None:",
    "                return None",
    `            entry: dict[str, str] = ${C.json}.loads(raw)`,
    "            return entry.get(scope)",
    "        except Exception as err:",
    `            ${warn("read")}`,
    "            return None",
    "",
    "    async def write(self, entry_id: str, scope: str, body: str) -> None:",
    "        try:",
    "            key = self._entry_prefix + entry_id",
    "            raw = await self._store.get(key)",
    `            entry: dict[str, str] = {} if raw is None else ${C.json}.loads(raw)`,
    "            entry[scope] = body",
    `            await self._store.set(key, ${C.json}.dumps(entry), self._ttl_seconds)`,
    "        except Exception as err:",
    `            ${warn("write")}`,
    "",
    "    async def evict(self, entry_id: str) -> None:",
    "        try:",
    "            await self._store.delete(self._entry_prefix + entry_id)",
    "        except Exception as err:",
    `            ${warn("evict")}`,
    "",
    "",
    `def _evict_on_write(repository: type, cache: ByIdCache, methods: ${C.Sequence}[str]) -> None:`,
    '    """Every write of an aggregate reaches one of its repository\'s writing methods',
    "    (`save(aggregate)`, `delete(id)`): each evicts the written id once the write",
    '    is done."""',
    "    for method in methods:",
    "        write = getattr(repository, method, None)",
    "        if write is None:",
    "            continue",
    "        setattr(repository, method, _evicting(write, cache))",
    "",
    "",
    `def _evicting(`,
    `    write: ${C.Callable}[..., ${C.Awaitable}[${C.Any}]], cache: ByIdCache`,
    `) -> ${C.Callable}[..., ${C.Awaitable}[${C.Any}]]:`,
    `    @${C.functools}.wraps(write)`,
    `    async def wrapper(self: object, *args: ${C.Any}, **kwargs: ${C.Any}) -> ${C.Any}:`,
    "        result = await write(self, *args, **kwargs)",
    "        subject = args[0] if args else next(iter(kwargs.values()))",
    '        await cache.evict(str(getattr(subject, "id", subject)))',
    "        return result",
    "",
    "    return wrapper",
    "",
    "",
    ...storeLines,
    "",
    ...reads.map(
      (r) =>
        `${cacheVar(r)} = ByIdCache(${JSON.stringify(r.aggregate)}, ${storeVar(r.storage)}, ${JSON.stringify(r.entryPrefix)}, ${r.ttlSeconds})`,
    ),
    "",
    "_installed = False",
    "",
    "",
    "def install_by_id_cache_eviction() -> None:",
    '    """Wrap every cached aggregate\'s repository writes with its eviction.  Called',
    '    once, by the lifespan, before any repository is written through."""',
    "    global _installed",
    "    if _installed:",
    "        return",
    "    _installed = True",
    ...reads.map(
      (r) =>
        `    _evict_on_write(${pyRef(`app.db.repositories.${snake(r.aggregate)}_repository`, `${r.aggregate}Repository`)}, ${cacheVar(r)}, [${r.evictOn.map((m) => JSON.stringify(m)).join(", ")}])`,
    ),
    "",
  );
}

/** The lifespan call that installs the eviction. */
export const PY_INSTALL_BY_ID_CACHE_EVICTION = pyRef(MODULE, "install_by_id_cache_eviction");

/** Whether the cache wiring needs the redis client dependency. */
export function byIdCacheUsesRedis(reads: readonly CachedByIdRead[]): boolean {
  return reads.some((r) => r.storageType === "redis");
}
