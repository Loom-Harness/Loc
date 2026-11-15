// The Java by-id read cache — `config/ByIdCaches.java` and the read-through
// lines of a cached aggregate's `GET /{id}` controller action.
//
// Everything this file renders is decided by the cache plan
// (`src/ir/plan/cache.ts`): which aggregates are cached, the entry prefix, the
// ttl, the scope inputs of the fingerprint and the evicting writes.  This file
// only spells them in Java:
//
//   - a `CacheStore` per cache resource — Lettuce for a `redis` storage (the
//     `<RESOURCE>_URL` connection, valkey in the dev compose), a
//     `ConcurrentHashMap` with expiry bounded by the plan's entry limit for
//     `inMemory`;
//   - one `ByIdCache` constant per cached aggregate, one entry per id in the
//     plan's `CACHE_ENTRY` envelope, so another backend on the same redis
//     reads it; an unreadable entry is a miss;
//   - the repository impl's `save` / `delete` evict the written id once the
//     surrounding transaction has committed (immediately outside one);
//   - the controller action: fingerprint the caller, answer a hit from the
//     entry, and store a miss's wire answer under the fingerprint.  The status
//     header says which one happened.
//
// The cache is deliberately not Spring's `@Cacheable`: that keys one entry per
// argument tuple, while an eviction here must drop every scope's answer for an
// id at once.  A store that refuses a call never fails the request: a read
// falls back to the database, a failed write or eviction is logged and the
// entry expires at its ttl.  The Java routes send no entity-tag, so the
// answers they store carry a null tag; a hit replays a tag another backend
// stored.

import {
  CACHE_ENTRY,
  CACHE_ETAG_HEADER,
  CACHE_STATUS_HEADER,
  type CachedByIdRead,
  type CacheEvictingWrite,
  type CacheScopeInput,
  cacheStoragesOf,
  IN_MEMORY_CACHE_MAX_ENTRIES,
} from "../../../ir/plan/cache.js";
import type { DeployableIR, SystemIR } from "../../../ir/types/loom-ir.js";
import { lines } from "../../../util/code-builder.js";
import { snake } from "../../../util/naming.js";
import { resourceEnvUrlVar, resourceSidecarUrl } from "../../../util/resource-env.js";
import { javaLogEvent } from "../../_obs/render-java.js";

/** The class the cache constants and stores live in (package `<base>.config`). */
export const BY_ID_CACHES_CLASS = "ByIdCaches";

/** The constant holding one cached aggregate's `ByIdCache`. */
function cacheConstant(read: Pick<CachedByIdRead, "aggregate">): string {
  return snake(read.aggregate).toUpperCase();
}

function storeConstant(storage: string): string {
  return `STORE_${snake(storage).toUpperCase()}`;
}

/** `ByIdCaches.<CONSTANT>`, the cache of `read`'s aggregate. */
function javaByIdCacheRef(read: Pick<CachedByIdRead, "aggregate">): string {
  return `${BY_ID_CACHES_CLASS}.${cacheConstant(read)}`;
}

/** One fingerprint input as Java; `user` is the caller's `User`. */
function scopeValue(input: CacheScopeInput, user: string): string {
  return input.kind === "principal" ? user : `${user}.${input.claim}()`;
}

/** True when the fingerprint reads the principal (the controller then needs
 *  the `CurrentUserAccessor`). */
export function cacheScopeReadsPrincipal(read: Pick<CachedByIdRead, "scope">): boolean {
  return read.scope.length > 0;
}

/** The lines that open a cached `GET /{id}` action: a hit answers here.
 *  `idExpr` is the route's raw id, `mapper` the injected JSON mapper and
 *  `accessor` the injected `CurrentUserAccessor`. */
export function renderJavaCacheHit(
  read: CachedByIdRead,
  idExpr: string,
  mapper: string,
  accessor: string,
  responseType: string,
): string[] {
  const user = "__user";
  const inputs = read.scope.map((s) => `(Object) ${scopeValue(s, user)}`).join(", ");
  return [
    ...(cacheScopeReadsPrincipal(read) ? [`        var ${user} = ${accessor}.user();`] : []),
    read.scope.length === 0
      ? `        var __scope = "[]";`
      : `        var __scope = ${mapper}.writeValueAsString(java.util.Arrays.asList(${inputs}));`,
    `        var __hit = ${javaByIdCacheRef(read)}.read(String.valueOf(${idExpr}), __scope);`,
    // Answered as the route's declared response type, so the route keeps its
    // typed OpenAPI contract; a body that does not decode is a miss.
    `        var __hitBody = __hit == null ? null : ${BY_ID_CACHES_CLASS}.decode(__hit, ${mapper}, ${responseType}.class);`,
    `        if (__hitBody != null) {`,
    `            var __res = ResponseEntity.ok().header("${CACHE_STATUS_HEADER}", "hit");`,
    `            if (__hit.${CACHE_ENTRY.etag}() != null) {`,
    `                __res.header("${CACHE_ETAG_HEADER}", __hit.${CACHE_ENTRY.etag}());`,
    `            }`,
    `            return __res.body(__hitBody);`,
    `        }`,
  ];
}

/** The lines that answer a miss: store `outExpr`'s wire form, then serve it. */
export function renderJavaCacheStore(
  read: CachedByIdRead,
  idExpr: string,
  outExpr: string,
  mapper: string,
): string[] {
  return [
    `        var __out = ${outExpr};`,
    `        ${javaByIdCacheRef(read)}.write(String.valueOf(${idExpr}), __scope, ${mapper}.writeValueAsString(__out), null);`,
    `        return ResponseEntity.ok().header("${CACHE_STATUS_HEADER}", "miss").body(__out);`,
  ];
}

/** The line a repository impl's `method` runs once the row is written, or
 *  null when the plan does not evict on that method. */
export function renderJavaCacheEvict(
  read: CachedByIdRead,
  method: CacheEvictingWrite,
  idExpr: string,
): string | null {
  if (!read.evictOn.includes(method)) return null;
  return `        ${javaByIdCacheRef(read)}.evictAfterCommit(String.valueOf(${idExpr}));`;
}

/** True when some cached read of the deployable uses a `redis` storage. */
export function cachesOnRedis(reads: readonly CachedByIdRead[]): boolean {
  return reads.some((r) => r.storageType === "redis");
}

/** `config/ByIdCaches.java`, or null when the deployable caches nothing. */
export function renderJavaByIdCaches(
  sys: SystemIR,
  deployable: Pick<DeployableIR, "dataSourceNames">,
  reads: readonly CachedByIdRead[],
  basePkg: string,
): string | null {
  if (reads.length === 0) return null;
  const stores = cacheStoragesOf(sys, deployable).filter((s) =>
    reads.some((r) => r.storage === s.storage),
  );
  const usesRedis = stores.some((s) => s.storageType === "redis");
  const storeLines = stores.map((s) => {
    if (s.storageType === "inMemory") {
      return `    private static final CacheStore ${storeConstant(s.storage)} = new MemoryStore();`;
    }
    const resource = reads.find((r) => r.storage === s.storage)!.resource;
    const url = resourceSidecarUrl("redis", s.storage)!;
    const env = resourceEnvUrlVar(resource);
    const fromEnv = `java.util.Optional.ofNullable(System.getenv(${JSON.stringify(env)})).orElse(${JSON.stringify(url)})`;
    return `    private static final CacheStore ${storeConstant(s.storage)} = new RedisStore(${fromEnv});`;
  });
  return lines(
    `package ${basePkg}.config;`,
    ``,
    `import java.util.Map;`,
    `import java.util.concurrent.ConcurrentHashMap;`,
    ``,
    ...(usesRedis
      ? [
          `import io.lettuce.core.ClientOptions;`,
          `import io.lettuce.core.RedisClient;`,
          `import io.lettuce.core.SocketOptions;`,
          `import io.lettuce.core.TimeoutOptions;`,
          `import io.lettuce.core.api.StatefulRedisConnection;`,
        ]
      : []),
    `import org.springframework.transaction.support.TransactionSynchronization;`,
    `import org.springframework.transaction.support.TransactionSynchronizationManager;`,
    `import tools.jackson.core.type.TypeReference;`,
    `import tools.jackson.databind.json.JsonMapper;`,
    ``,
    `/** The by-id read cache: a \`GET /{id}\` answer per caller scope, evicted by`,
    ` *  every write of the aggregate.  An entry is one JSON map from the scope`,
    ` *  fingerprint to the wire answer, so one eviction drops every scope. */`,
    `public final class ${BY_ID_CACHES_CLASS} {`,
    `    private ${BY_ID_CACHES_CLASS}() {`,
    `    }`,
    ``,
    `    private static final JsonMapper JSON = JsonMapper.builder().build();`,
    `    private static final TypeReference<Map<String, Object>> ENTRY = new TypeReference<>() {`,
    `    };`,
    ``,
    `    /** One scope's answer as stored: the wire body's JSON text and its tag. */`,
    `    public record Answer(String ${CACHE_ENTRY.body}, String ${CACHE_ENTRY.etag}) {`,
    `    }`,
    ``,
    `    /** The stored entry, or an empty one when it is not a JSON object. */`,
    `    static Map<String, Object> entryOf(String raw) {`,
    `        var entry = new java.util.LinkedHashMap<String, Object>();`,
    `        if (raw != null) {`,
    `            try {`,
    `                entry.putAll(JSON.readValue(raw, ENTRY));`,
    `            } catch (RuntimeException e) {`,
    `                // Unreadable: replaced by the next write.`,
    `            }`,
    `        }`,
    `        return entry;`,
    `    }`,
    ``,
    `    /** \`answer\` when it is a readable answer, else null. */`,
    `    static Answer readable(Object answer) {`,
    `        if (!(answer instanceof Map<?, ?> a)) {`,
    `            return null;`,
    `        }`,
    `        var body = a.get(${JSON.stringify(CACHE_ENTRY.body)});`,
    `        var etag = a.get(${JSON.stringify(CACHE_ENTRY.etag)});`,
    `        if (!(body instanceof String b) || !(etag == null || etag instanceof String)) {`,
    `            return null;`,
    `        }`,
    `        return new Answer(b, (String) etag);`,
    `    }`,
    ``,
    `    /** The answer's body as \`type\`, or null when it does not decode (a miss). */`,
    `    public static <T> T decode(Answer answer, tools.jackson.databind.ObjectMapper mapper, Class<T> type) {`,
    `        try {`,
    `            return mapper.readValue(answer.${CACHE_ENTRY.body}(), type);`,
    `        } catch (RuntimeException e) {`,
    `            return null;`,
    `        }`,
    `    }`,
    ``,
    `    /** The key-value store the entries live in. */`,
    `    interface CacheStore {`,
    `        String get(String key);`,
    ``,
    `        void set(String key, String value, int ttlSeconds);`,
    ``,
    `        void del(String key);`,
    `    }`,
    ``,
    ...(usesRedis
      ? [
          `    /** Lettuce.  Connects on first use and fails a call (instead of queueing it)`,
          `     *  while the server is away: the caller then reads the database. */`,
          `    static final class RedisStore implements CacheStore {`,
          `        private final RedisClient client;`,
          `        private StatefulRedisConnection<String, String> connection;`,
          ``,
          `        RedisStore(String url) {`,
          `            this.client = RedisClient.create(url);`,
          `            this.client.setOptions(ClientOptions.builder()`,
          `                .socketOptions(SocketOptions.builder().connectTimeout(java.time.Duration.ofSeconds(1)).build())`,
          `                .timeoutOptions(TimeoutOptions.enabled(java.time.Duration.ofSeconds(1)))`,
          `                .disconnectedBehavior(ClientOptions.DisconnectedBehavior.REJECT_COMMANDS)`,
          `                .build());`,
          `        }`,
          ``,
          `        private synchronized StatefulRedisConnection<String, String> connected() {`,
          `            if (connection == null || !connection.isOpen()) {`,
          `                connection = client.connect();`,
          `            }`,
          `            return connection;`,
          `        }`,
          ``,
          `        @Override`,
          `        public String get(String key) {`,
          `            return connected().sync().get(key);`,
          `        }`,
          ``,
          `        @Override`,
          `        public void set(String key, String value, int ttlSeconds) {`,
          `            connected().sync().setex(key, ttlSeconds, value);`,
          `        }`,
          ``,
          `        @Override`,
          `        public void del(String key) {`,
          `            connected().sync().del(key);`,
          `        }`,
          `    }`,
          ``,
        ]
      : []),
    `    /** An in-process map with expiry, holding at most \`MAX_ENTRIES\` entries: a`,
    `     *  write that finds it full drops the expired entries, and is skipped when it`,
    `     *  is still full. */`,
    `    static final class MemoryStore implements CacheStore {`,
    `        static final int MAX_ENTRIES = ${IN_MEMORY_CACHE_MAX_ENTRIES};`,
    ``,
    `        private record Entry(String value, long expiresAt) {`,
    `        }`,
    ``,
    `        private final ConcurrentHashMap<String, Entry> entries = new ConcurrentHashMap<>();`,
    ``,
    `        @Override`,
    `        public String get(String key) {`,
    `            var entry = entries.get(key);`,
    `            if (entry == null) {`,
    `                return null;`,
    `            }`,
    `            if (entry.expiresAt() <= System.currentTimeMillis()) {`,
    `                entries.remove(key, entry);`,
    `                return null;`,
    `            }`,
    `            return entry.value();`,
    `        }`,
    ``,
    `        @Override`,
    `        public void set(String key, String value, int ttlSeconds) {`,
    `            if (!entries.containsKey(key) && entries.size() >= MAX_ENTRIES) {`,
    `                var now = System.currentTimeMillis();`,
    `                entries.values().removeIf(e -> e.expiresAt() <= now);`,
    `                if (entries.size() >= MAX_ENTRIES) {`,
    `                    return;`,
    `                }`,
    `            }`,
    `            entries.put(key, new Entry(value, System.currentTimeMillis() + ttlSeconds * 1000L));`,
    `        }`,
    ``,
    `        @Override`,
    `        public void del(String key) {`,
    `            entries.remove(key);`,
    `        }`,
    `    }`,
    ``,
    `    /** The cached by-id reads of one aggregate: one entry per id, holding each`,
    `     *  caller scope's answer. */`,
    `    public static final class ByIdCache {`,
    `        private final String aggregate;`,
    `        private final CacheStore store;`,
    `        private final String entryPrefix;`,
    `        private final int ttlSeconds;`,
    ``,
    `        ByIdCache(String aggregate, CacheStore store, String entryPrefix, int ttlSeconds) {`,
    `            this.aggregate = aggregate;`,
    `            this.store = store;`,
    `            this.entryPrefix = entryPrefix;`,
    `            this.ttlSeconds = ttlSeconds;`,
    `        }`,
    ``,
    `        /** The answer stored for \`id\` under \`scope\`; an unreadable one is a miss. */`,
    `        public Answer read(String id, String scope) {`,
    `            String raw;`,
    `            try {`,
    `                raw = store.get(entryPrefix + id);`,
    `            } catch (RuntimeException e) {`,
    `                unavailable("read", e);`,
    `                return null;`,
    `            }`,
    `            return readable(entryOf(raw).get(scope));`,
    `        }`,
    ``,
    `        /** Store \`body\` (the wire answer's JSON text) under \`scope\`, keeping the`,
    `         *  other scopes' answers; an entry that does not parse is replaced. */`,
    `        public void write(String id, String scope, String body, String etag) {`,
    `            try {`,
    `                var key = entryPrefix + id;`,
    `                var entry = entryOf(store.get(key));`,
    `                var answer = new java.util.LinkedHashMap<String, Object>();`,
    `                answer.put(${JSON.stringify(CACHE_ENTRY.body)}, body);`,
    `                answer.put(${JSON.stringify(CACHE_ENTRY.etag)}, etag);`,
    `                entry.put(scope, answer);`,
    `                store.set(key, JSON.writeValueAsString(entry), ttlSeconds);`,
    `            } catch (RuntimeException e) {`,
    `                unavailable("write", e);`,
    `            }`,
    `        }`,
    ``,
    `        /** Drop \`id\`'s whole entry — every scope's answer. */`,
    `        public void evict(String id) {`,
    `            try {`,
    `                store.del(entryPrefix + id);`,
    `            } catch (RuntimeException e) {`,
    `                unavailable("evict", e);`,
    `            }`,
    `        }`,
    ``,
    `        /** Evict once the write's transaction has committed (a reader between the`,
    `         *  write and the commit must not repopulate the entry from the old row);`,
    `         *  outside a transaction the write is already done. */`,
    `        public void evictAfterCommit(String id) {`,
    `            if (TransactionSynchronizationManager.isSynchronizationActive()) {`,
    `                TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {`,
    `                    @Override`,
    `                    public void afterCommit() {`,
    `                        evict(id);`,
    `                    }`,
    `                });`,
    `            } else {`,
    `                evict(id);`,
    `            }`,
    `        }`,
    ``,
    `        private void unavailable(String op, RuntimeException e) {`,
    `            CatalogLog.event(${javaLogEvent("cacheUnavailable")}, "aggregate", aggregate, "op", op, "error", String.valueOf(e));`,
    `        }`,
    `    }`,
    ``,
    ...storeLines,
    ``,
    ...reads.map(
      (r) =>
        `    public static final ByIdCache ${cacheConstant(r)} = new ByIdCache(${JSON.stringify(r.aggregate)}, ${storeConstant(r.storage)}, ${JSON.stringify(r.entryPrefix)}, ${r.ttlSeconds});`,
    ),
    `}`,
    ``,
  );
}
