// The .NET by-id read cache — `Infrastructure/Caching/ByIdCache.cs`, the
// read-through lines of a cached aggregate's `GET /{id}` action, and the DI
// registration that wraps its repository with eviction.
//
// Everything this file renders is decided by the cache plan
// (`src/ir/plan/cache.ts`): which aggregates are cached, the entry prefix, the
// ttl, the scope inputs of the fingerprint and the evicting writes.  This file
// only spells them in C#:
//
//   - a `CacheStore` per cache resource — StackExchange.Redis for a `redis`
//     storage (the `<RESOURCE>_URL` connection, valkey in the dev compose), a
//     `ConcurrentDictionary` with expiry for `inMemory`;
//   - one `ByIdCache` per cached aggregate: one entry per id holding each
//     caller scope's answer;
//   - `CacheEvictingRepository<T>`, a `DispatchProxy` over the aggregate's
//     repository interface.  Every write of an aggregate reaches the
//     repository's `SaveAsync` / `DeleteAsync` whichever persistence adapter
//     built the class, so the one decorator evicts for EF Core and Dapper alike;
//   - the action: fingerprint the caller, answer a hit from the entry, store a
//     miss's wire answer under the fingerprint.  `x-loom-cache` says which one
//     happened.
//
// A store that refuses a call never fails the request: a read falls back to
// the database, a failed write or eviction is logged and the entry expires at
// its ttl.

import {
  CACHE_STATUS_HEADER,
  type CachedByIdRead,
  type CacheEvictingWrite,
  type CacheScopeInput,
  cacheStoragesOf,
} from "../../../ir/plan/cache.js";
import type { DeployableIR, SystemIR } from "../../../ir/types/loom-ir.js";
import { plural, upperFirst } from "../../../util/naming.js";
import { resourceEnvUrlVar, resourceSidecarUrl } from "../../../util/resource-env.js";
import { renderDotnetLogCall } from "../../_obs/render-dotnet.js";

/** Where the module lives, relative to the project root. */
export const BY_ID_CACHE_PATH = "Infrastructure/Caching/ByIdCache.cs";

/** The namespace the module declares. */
function cacheNs(ns: string): string {
  return `${ns}.Infrastructure.Caching`;
}

/** The `ByIdCache` subclass of one cached aggregate. */
function byIdCacheClass(read: Pick<CachedByIdRead, "aggregate">): string {
  return `${read.aggregate}ByIdCache`;
}

function storeField(storage: string): string {
  return upperFirst(storage);
}

/** The repository method each evicting write names. */
const REPOSITORY_METHOD: Record<CacheEvictingWrite, string> = {
  save: "SaveAsync",
  delete: "DeleteAsync",
};

/** One fingerprint input as C#, read off the request's principal. */
function scopeValue(input: CacheScopeInput): string {
  return input.kind === "principal" ? "_user.User" : `_user.User.${upperFirst(input.claim)}`;
}

/** True when the cached read keys on the caller. */
function cacheReadsPrincipal(read: CachedByIdRead): boolean {
  return read.scope.length > 0;
}

/** The caller's scope fingerprint: the JSON array of the plan's inputs. */
function scopeFingerprintCs(read: CachedByIdRead): string {
  return read.scope.length === 0
    ? `"[]"`
    : `System.Text.Json.JsonSerializer.Serialize(new object?[] { ${read.scope.map(scopeValue).join(", ")} })`;
}

/** The lines that open a cached `GET /{id}` action: a hit answers here. */
export function renderCacheHit(read: CachedByIdRead, idExpr: string): string[] {
  return [
    `        var __scope = ${scopeFingerprintCs(read)};`,
    `        var __hit = await _cache.ReadAsync(${idExpr}, __scope);`,
    "        if (__hit is not null)",
    "        {",
    `            Response.Headers["${CACHE_STATUS_HEADER}"] = "hit";`,
    '            return Content(__hit, "application/json");',
    "        }",
  ];
}

/** The lines that store a miss's wire answer `responseExpr` before it is
 *  returned. */
export function renderCacheStore(idExpr: string, responseExpr: string): string[] {
  return [
    `        await _cache.WriteAsync(${idExpr}, __scope, ${responseExpr});`,
    `        Response.Headers["${CACHE_STATUS_HEADER}"] = "miss";`,
  ];
}

/** The controller constructor parameters + field assignments a cached read adds. */
export function cacheControllerMembers(
  read: CachedByIdRead,
  ns: string,
): { usings: string[]; fields: string[]; ctorParams: string[]; ctorBody: string[] } {
  const principal = cacheReadsPrincipal(read);
  return {
    usings: [`using ${cacheNs(ns)};`, ...(principal ? [`using ${ns}.Auth;`] : [])],
    fields: [
      `    private readonly ${byIdCacheClass(read)} _cache;`,
      ...(principal ? ["    private readonly ICurrentUserAccessor _user;"] : []),
    ],
    ctorParams: [
      `${byIdCacheClass(read)} cache`,
      ...(principal ? ["ICurrentUserAccessor user"] : []),
    ],
    ctorBody: ["_cache = cache;", ...(principal ? ["_user = user;"] : [])],
  };
}

/** The DI lines of a cached aggregate: its cache, the concrete repository and
 *  the interface binding that wraps the repository with eviction. */
export function renderCacheRepositoryRegistration(
  read: CachedByIdRead,
  ns: string,
  repoInterface: string,
  repoImpl: string,
): string {
  const cache = `${cacheNs(ns)}.${byIdCacheClass(read)}`;
  return [
    `builder.Services.AddSingleton<${cache}>();`,
    `builder.Services.AddScoped<${repoImpl}>();`,
    `builder.Services.AddScoped<${repoInterface}>(sp => ${cacheNs(ns)}.CacheEvictingRepository.Wrap<${repoInterface}>(sp.GetRequiredService<${repoImpl}>(), sp.GetRequiredService<${cache}>()));`,
  ].join("\n");
}

/** `Infrastructure/Caching/ByIdCache.cs`, or null when the deployable caches nothing. */
export function renderByIdCacheModule(
  sys: SystemIR,
  deployable: Pick<DeployableIR, "dataSourceNames">,
  reads: readonly CachedByIdRead[],
  ns: string,
): string | null {
  if (reads.length === 0) return null;
  const stores = cacheStoragesOf(sys, deployable).filter((s) =>
    reads.some((r) => r.storage === s.storage),
  );
  const usesRedis = stores.some((s) => s.storageType === "redis");
  const warn = (op: string) =>
    renderDotnetLogCall("cacheUnavailable", [
      { name: "aggregate", valueExpr: "_aggregate" },
      { name: "op", valueExpr: `"${op}"` },
      { name: "error", valueExpr: "err.Message" },
    ]);
  const storeLines = stores.map((s) => {
    if (s.storageType === "inMemory") {
      return `    public static readonly ICacheStore ${storeField(s.storage)} = new MemoryCacheStore();`;
    }
    const url = resourceSidecarUrl("redis", s.storage)!;
    const env = resourceEnvUrlVar(s.resource);
    return `    public static readonly ICacheStore ${storeField(s.storage)} = new RedisCacheStore(Environment.GetEnvironmentVariable(${JSON.stringify(env)}) ?? ${JSON.stringify(url)});`;
  });
  const subclasses = reads.map((r) =>
    [
      `public sealed class ${byIdCacheClass(r)} : ByIdCache`,
      "{",
      `    private static readonly string[] EvictingWrites = { ${r.evictOn.map((w) => JSON.stringify(REPOSITORY_METHOD[w])).join(", ")} };`,
      "",
      `    public ${byIdCacheClass(r)}(ILoggerFactory loggers, IOptions<JsonOptions> json)`,
      `        : base(${JSON.stringify(r.aggregate)}, CacheStores.${storeField(r.storage)}, ${JSON.stringify(r.entryPrefix)}, ${r.ttlSeconds}, EvictingWrites, json.Value.JsonSerializerOptions, loggers.CreateLogger<${byIdCacheClass(r)}>()) { }`,
      "}",
      "",
    ].join("\n"),
  );
  return [
    "// Auto-generated.  Do not edit by hand.",
    "//",
    "// The by-id read cache: a `GET /{id}` answer per caller scope, evicted by",
    "// every write of the aggregate.",
    "using System.Collections.Concurrent;",
    "using System.Reflection;",
    "using System.Runtime.ExceptionServices;",
    "using System.Text.Json;",
    "using Microsoft.AspNetCore.Mvc;",
    "using Microsoft.Extensions.Logging;",
    "using Microsoft.Extensions.Options;",
    ...(usesRedis ? ["using StackExchange.Redis;"] : []),
    "",
    `namespace ${cacheNs(ns)};`,
    "",
    "/// <summary>The key-value store the entries live in.</summary>",
    "public interface ICacheStore",
    "{",
    "    Task<string?> GetAsync(string key);",
    "    Task SetAsync(string key, string value, int ttlSeconds);",
    "    Task RemoveAsync(string key);",
    "}",
    "",
    ...(usesRedis
      ? [
          "public sealed class RedisCacheStore : ICacheStore",
          "{",
          "    private readonly Lazy<Task<ConnectionMultiplexer>> _connection;",
          "",
          "    public RedisCacheStore(string url)",
          "    {",
          "        // redis://[:pass@]host:port; the client wants host:port with the",
          "        // requirepass credential as a password= option.",
          '        var config = url.StartsWith("redis://", StringComparison.Ordinal) ? url["redis://".Length..] : url;',
          "        var at = config.LastIndexOf('@');",
          "        if (at >= 0)",
          "        {",
          "            var userinfo = config[..at];",
          "            var pass = userinfo.StartsWith(':') ? userinfo[1..] : userinfo[(userinfo.IndexOf(':') + 1)..];",
          '            config = $"{config[(at + 1)..]},password={Uri.UnescapeDataString(pass)}";',
          "        }",
          "        // Connects on first use and fails a call instead of retrying forever while",
          "        // the server is away: the caller then reads the database.",
          "        var options = ConfigurationOptions.Parse(config);",
          "        options.AbortOnConnectFail = false;",
          "        options.ConnectTimeout = 1000;",
          "        options.SyncTimeout = 1000;",
          "        options.AsyncTimeout = 1000;",
          "        _connection = new(() => ConnectionMultiplexer.ConnectAsync(options));",
          "    }",
          "",
          "    public async Task<string?> GetAsync(string key)",
          "    {",
          "        var db = (await _connection.Value).GetDatabase();",
          "        var value = await db.StringGetAsync(key);",
          "        return value.IsNull ? null : (string?)value;",
          "    }",
          "",
          "    public async Task SetAsync(string key, string value, int ttlSeconds)",
          "    {",
          "        var db = (await _connection.Value).GetDatabase();",
          "        await db.StringSetAsync(key, value, TimeSpan.FromSeconds(ttlSeconds));",
          "    }",
          "",
          "    public async Task RemoveAsync(string key)",
          "    {",
          "        var db = (await _connection.Value).GetDatabase();",
          "        await db.KeyDeleteAsync(key);",
          "    }",
          "}",
          "",
        ]
      : []),
    "public sealed class MemoryCacheStore : ICacheStore",
    "{",
    "    private readonly ConcurrentDictionary<string, (string Value, DateTime ExpiresAt)> _entries = new();",
    "",
    "    public Task<string?> GetAsync(string key)",
    "    {",
    "        if (!_entries.TryGetValue(key, out var entry)) return Task.FromResult<string?>(null);",
    "        if (entry.ExpiresAt <= DateTime.UtcNow)",
    "        {",
    "            _entries.TryRemove(key, out _);",
    "            return Task.FromResult<string?>(null);",
    "        }",
    "        return Task.FromResult<string?>(entry.Value);",
    "    }",
    "",
    "    public Task SetAsync(string key, string value, int ttlSeconds)",
    "    {",
    "        _entries[key] = (value, DateTime.UtcNow.AddSeconds(ttlSeconds));",
    "        return Task.CompletedTask;",
    "    }",
    "",
    "    public Task RemoveAsync(string key)",
    "    {",
    "        _entries.TryRemove(key, out _);",
    "        return Task.CompletedTask;",
    "    }",
    "}",
    "",
    "/// <summary>The stores of this deployable's cache resources, one per storage.</summary>",
    "public static class CacheStores",
    "{",
    ...storeLines,
    "}",
    "",
    "/// <summary>The cached by-id reads of one aggregate: one entry per id, holding each",
    "/// caller scope's answer.</summary>",
    "public abstract class ByIdCache",
    "{",
    "    private readonly string _aggregate;",
    "    private readonly ICacheStore _store;",
    "    private readonly string _entryPrefix;",
    "    private readonly int _ttlSeconds;",
    "    private readonly JsonSerializerOptions _json;",
    "    private readonly ILogger _log;",
    "",
    "    /// <summary>The repository methods whose completion evicts an entry.</summary>",
    "    public IReadOnlyCollection<string> EvictingMethods { get; }",
    "",
    "    protected ByIdCache(string aggregate, ICacheStore store, string entryPrefix, int ttlSeconds,",
    "        IReadOnlyCollection<string> evictingMethods, JsonSerializerOptions json, ILogger log)",
    "    {",
    "        _aggregate = aggregate;",
    "        _store = store;",
    "        _entryPrefix = entryPrefix;",
    "        _ttlSeconds = ttlSeconds;",
    "        EvictingMethods = evictingMethods;",
    "        _json = json;",
    "        _log = log;",
    "    }",
    "",
    "    public async Task<string?> ReadAsync(string id, string scope)",
    "    {",
    "        try",
    "        {",
    "            var raw = await _store.GetAsync(_entryPrefix + id);",
    "            if (raw is null) return null;",
    "            var entry = JsonSerializer.Deserialize<Dictionary<string, string>>(raw);",
    "            return entry is not null && entry.TryGetValue(scope, out var body) ? body : null;",
    "        }",
    "        catch (Exception err)",
    "        {",
    `            ${warn("read")}`,
    "            return null;",
    "        }",
    "    }",
    "",
    "    public async Task WriteAsync(string id, string scope, object response)",
    "    {",
    "        try",
    "        {",
    "            var key = _entryPrefix + id;",
    "            var raw = await _store.GetAsync(key);",
    "            var entry = raw is null",
    "                ? new Dictionary<string, string>()",
    "                : JsonSerializer.Deserialize<Dictionary<string, string>>(raw) ?? new Dictionary<string, string>();",
    "            entry[scope] = JsonSerializer.Serialize(response, response.GetType(), _json);",
    "            await _store.SetAsync(key, JsonSerializer.Serialize(entry), _ttlSeconds);",
    "        }",
    "        catch (Exception err)",
    "        {",
    `            ${warn("write")}`,
    "        }",
    "    }",
    "",
    "    public async Task EvictAsync(string id)",
    "    {",
    "        try",
    "        {",
    "            await _store.RemoveAsync(_entryPrefix + id);",
    "        }",
    "        catch (Exception err)",
    "        {",
    `            ${warn("evict")}`,
    "        }",
    "    }",
    "}",
    "",
    ...subclasses,
    "/// <summary>Every write of an aggregate reaches one of its repository's writing",
    "/// methods (<c>SaveAsync(aggregate)</c>, <c>DeleteAsync(aggregate)</c>): each evicts",
    "/// the written id once the write is done.</summary>",
    "public static class CacheEvictingRepository",
    "{",
    "    public static T Wrap<T>(T inner, ByIdCache cache) where T : class",
    "    {",
    "        var proxy = DispatchProxy.Create<T, CacheEvictingProxy<T>>();",
    "        var self = (CacheEvictingProxy<T>)(object)proxy;",
    "        self.Bind(inner, cache);",
    "        return proxy;",
    "    }",
    "}",
    "",
    "public class CacheEvictingProxy<T> : DispatchProxy where T : class",
    "{",
    "    private T _inner = null!;",
    "    private ByIdCache _cache = null!;",
    "",
    "    internal void Bind(T inner, ByIdCache cache)",
    "    {",
    "        _inner = inner;",
    "        _cache = cache;",
    "    }",
    "",
    "    protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)",
    "    {",
    "        object? result;",
    "        try",
    "        {",
    "            result = targetMethod!.Invoke(_inner, args);",
    "        }",
    "        catch (TargetInvocationException err) when (err.InnerException is not null)",
    "        {",
    "            ExceptionDispatchInfo.Capture(err.InnerException).Throw();",
    "            throw;",
    "        }",
    "        if (result is Task write && args is { Length: > 0 } && _cache.EvictingMethods.Contains(targetMethod.Name))",
    "            return EvictAfter(write, args[0]);",
    "        return result;",
    "    }",
    "",
    "    private async Task EvictAfter(Task write, object? subject)",
    "    {",
    "        await write;",
    '        var id = subject?.GetType().GetProperty("Id")?.GetValue(subject);',
    "        if (id is not null) await _cache.EvictAsync(id.ToString()!);",
    "    }",
    "}",
    "",
  ].join("\n");
}

/** The repository interface and implementation a cached aggregate registers. */
export function cachedRepositoryTypes(
  read: Pick<CachedByIdRead, "aggregate">,
  ns: string,
): { iface: string; impl: string } {
  return {
    iface: `${ns}.Domain.${plural(read.aggregate)}.I${read.aggregate}Repository`,
    impl: `${ns}.Infrastructure.Repositories.${read.aggregate}Repository`,
  };
}
