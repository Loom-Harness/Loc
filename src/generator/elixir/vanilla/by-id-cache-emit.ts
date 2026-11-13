// The Phoenix by-id read cache — `lib/<app>/by_id_cache.ex` and the read-through
// lines of a cached aggregate's `GET /{id}` action.
//
// Everything this file renders is decided by the cache plan
// (`src/ir/plan/cache.ts`): which aggregates are cached, the entry prefix, the
// ttl, the scope inputs of the fingerprint and the evicting writes.  This file
// only spells them in Elixir:
//
//   - one store per cache storage — a named Redix connection (the
//     `<RESOURCE>_URL` connection, valkey in the dev compose) for a `redis`
//     storage, a named ETS table with expiry owned by a small GenServer for
//     `inMemory`;
//   - `<App>.ByIdCache`, the store-agnostic read / write / evict, and one
//     `<App>.ByIdCache.<Aggregate>` module per cached aggregate carrying its
//     plan facts;
//   - the controller's `show` reads through `<App>.ByIdCache.<Aggregate>`: a
//     hit answers the stored body, a miss stores the wire answer it serialised;
//     `x-loom-cache` says which one happened;
//   - the repository's writing functions pipe their result through
//     `evict_written/1`, which evicts the written id's whole entry once the
//     write commits (`<App>.PostCommit.run/1` — now outside a transaction,
//     after the commit inside a transactional workflow).
//
// A store that refuses a call never fails the request: a read falls back to the
// database, a failed write or eviction is logged and the entry expires at its
// ttl.  Cachex is not used: an ETS table with an expiry sweep is the whole
// in-process store, and keeps the dependency set to what the wired storages
// need (Redix, which the redis channel transport already pins).

import {
  CACHE_STATUS_HEADER,
  type CachedByIdRead,
  type CacheScopeInput,
  cacheStoragesOf,
} from "../../../ir/plan/cache.js";
import type { DeployableIR, SystemIR } from "../../../ir/types/loom-ir.js";
import { snake, upperFirst } from "../../../util/naming.js";
import { resourceEnvUrlVar, resourceSidecarUrl } from "../../../util/resource-env.js";
import { renderPhoenixLogCall } from "../../_obs/render-phoenix.js";

/** The cached reads of one context, by aggregate name. */
export type ByIdCacheReads = ReadonlyMap<string, CachedByIdRead>;

/** The redix release the generated project pins (shared with the channel
 *  transport, so a project wiring both never carries two requirements). */
export const BY_ID_CACHE_REDIX_VERSION = '"1.10.0"';

/** The store-agnostic module of the project. */
export function byIdCacheModule(appModule: string): string {
  return `${appModule}.ByIdCache`;
}

/** The per-aggregate module of one cached read. */
function byIdCacheAggregateModule(appModule: string, read: CachedByIdRead): string {
  return `${byIdCacheModule(appModule)}.${upperFirst(read.aggregate)}`;
}

/** The cached reads of `reads` that belong to context `contextName`, by aggregate. */
export function byIdCacheReadsOf(
  reads: readonly CachedByIdRead[],
  contextName: string,
): ByIdCacheReads {
  return new Map(reads.filter((r) => r.context === contextName).map((r) => [r.aggregate, r]));
}

/** The registered name of one storage's store process. */
function storeName(appName: string, storage: string): string {
  return `:${appName}_${snake(storage)}_by_id`;
}

/** One fingerprint input as Elixir.  `current_user` is the request principal
 *  map the auth plug assigns (nil on an unauthenticated read). */
function scopeValue(input: CacheScopeInput): string {
  return input.kind === "principal"
    ? "current_user"
    : `current_user && Map.get(current_user, :${snake(input.claim)})`;
}

/** Does the read's fingerprint read the principal? */
export function byIdCacheScopeReadsPrincipal(read: CachedByIdRead): boolean {
  return read.scope.length > 0;
}

/** The lines that serve a cached aggregate's `show` after its authorization
 *  gate.  `loadArgs` is the argument list of the context getter; the caller has
 *  bound `current_user` whenever `byIdCacheScopeReadsPrincipal`. */
export function renderCachedShowBody(
  appModule: string,
  read: CachedByIdRead,
  ctxModule: string,
  aggSnake: string,
  aggPascal: string,
  loadArgs: string,
): string {
  const cache = byIdCacheAggregateModule(appModule, read);
  const responder = `${byIdCacheModule(appModule)}.respond`;
  const inputs = read.scope.map(scopeValue).join(", ");
  return `    scope = ${byIdCacheModule(appModule)}.fingerprint([${inputs}])

    case ${cache}.read(id, scope) do
      {:hit, answer} ->
        ${responder}(conn, answer["body"], answer["etag"], "hit")

      :miss ->
        case ${ctxModule}.get_${aggSnake}(${loadArgs}) do
          {:ok, record} ->
            body = Jason.encode!(serialize(record))
            ${cache}.write(id, scope, %{"body" => body, "etag" => nil})
            ${responder}(conn, body, nil, "miss")

          {:error, :not_found} ->
            ProblemDetails.not_found_response(conn, "${aggPascal}", id)
        end
    end`;
}

/** The pipe stage a repository write's result goes through. */
export function renderEvictPipe(
  appModule: string,
  read: CachedByIdRead | undefined,
  indent = "    ",
): string {
  return read ? `\n${indent}|> ${byIdCacheAggregateModule(appModule, read)}.evict_written()` : "";
}

/** The `lib/<app>/by_id_cache.ex` file, the supervision children of its
 *  stores and the hex deps it needs; null when the deployable caches nothing. */
export function renderByIdCache(
  appName: string,
  appModule: string,
  sys: SystemIR,
  deployable: Pick<DeployableIR, "dataSourceNames">,
  reads: readonly CachedByIdRead[],
): { path: string; content: string; children: string[]; usesRedis: boolean } | null {
  if (reads.length === 0) return null;
  const stores = cacheStoragesOf(sys, deployable).filter((s) =>
    reads.some((r) => r.storage === s.storage),
  );
  const usesRedis = stores.some((s) => s.storageType === "redis");
  const usesMemory = stores.some((s) => s.storageType === "inMemory");
  const cacheMod = byIdCacheModule(appModule);

  const storeOf = (read: CachedByIdRead): string =>
    `{${read.storageType === "redis" ? ":redis" : ":memory"}, ${storeName(appName, read.storage)}}`;

  const children = stores.map((s) => {
    const name = storeName(appName, s.storage);
    if (s.storageType === "inMemory") {
      return `Supervisor.child_spec({${cacheMod}.Memory, ${name}}, id: ${name})`;
    }
    const resource = reads.find((r) => r.storage === s.storage)!.resource;
    const env = JSON.stringify(resourceEnvUrlVar(resource));
    const fallback = JSON.stringify(resourceSidecarUrl("redis", s.storage)!);
    return `Supervisor.child_spec({Redix, {System.get_env(${env}) || ${fallback}, [name: ${name}]}}, id: ${name})`;
  });

  const warn = renderPhoenixLogCall("cacheUnavailable", [
    { name: "aggregate", valueExpr: "cache.aggregate" },
    { name: "op", valueExpr: "op" },
    { name: "error", valueExpr: "inspect(reason)" },
  ]);

  const getClauses = [
    ...(usesMemory
      ? [
          `  defp store_get({:memory, table}, key) do
    case :ets.lookup(table, key) do
      [{^key, value, expires_at}] ->
        if expires_at > System.monotonic_time(:millisecond) do
          {:ok, value}
        else
          :ets.delete(table, key)
          {:ok, nil}
        end

      [] ->
        {:ok, nil}
    end
  end`,
        ]
      : []),
    ...(usesRedis
      ? [`  defp store_get({:redis, conn}, key), do: Redix.command(conn, ["GET", key])`]
      : []),
  ];
  const setClauses = [
    ...(usesMemory
      ? [
          `  defp store_set({:memory, table}, key, value, ttl_seconds) do
    :ets.insert(table, {key, value, System.monotonic_time(:millisecond) + ttl_seconds * 1000})
    {:ok, :ok}
  end`,
        ]
      : []),
    ...(usesRedis
      ? [
          `  defp store_set({:redis, conn}, key, value, ttl_seconds),
    do: Redix.command(conn, ["SET", key, value, "EX", Integer.to_string(ttl_seconds)])`,
        ]
      : []),
  ];
  const delClauses = [
    ...(usesMemory
      ? [
          `  defp store_del({:memory, table}, key) do
    :ets.delete(table, key)
    {:ok, :ok}
  end`,
        ]
      : []),
    ...(usesRedis
      ? [`  defp store_del({:redis, conn}, key), do: Redix.command(conn, ["DEL", key])`]
      : []),
  ];

  const memoryModule = usesMemory
    ? `
defmodule ${cacheMod}.Memory do
  @moduledoc false
  # The in-process store: a named public ETS table of \`{key, value, expires_at}\`
  # rows, owned by this process.  A row is dropped when a read finds it expired,
  # and the sweep drops the ones nobody reads again.
  use GenServer

  @sweep_ms 60_000

  def start_link(table), do: GenServer.start_link(__MODULE__, table)

  @impl true
  def init(table) do
    :ets.new(table, [:named_table, :public, :set, read_concurrency: true])
    Process.send_after(self(), :sweep, @sweep_ms)
    {:ok, table}
  end

  @impl true
  def handle_info(:sweep, table) do
    now = System.monotonic_time(:millisecond)
    :ets.select_delete(table, [{{:_, :_, :"$1"}, [{:<, :"$1", now}], [true]}])
    Process.send_after(self(), :sweep, @sweep_ms)
    {:noreply, table}
  end
end
`
    : "";

  const aggregateModules = reads
    .map(
      (r) => `
defmodule ${byIdCacheAggregateModule(appModule, r)} do
  @moduledoc false

  @cache %{
    aggregate: ${JSON.stringify(r.aggregate)},
    store: ${storeOf(r)},
    prefix: ${JSON.stringify(r.entryPrefix)},
    ttl_seconds: ${r.ttlSeconds}
  }

  def read(id, scope), do: ${cacheMod}.read(@cache, id, scope)
  def write(id, scope, answer), do: ${cacheMod}.write(@cache, id, scope, answer)
  def evict(id), do: ${cacheMod}.evict(@cache, id)

  @doc "Pipe stage of a repository write (${r.evictOn.join(", ")}): evicts the written id's entry once the write commits."
  def evict_written({:ok, %{id: id}} = result), do: evict_after_commit(id, result)
  def evict_written(%{id: id} = record), do: evict_after_commit(id, record)
  def evict_written(other), do: other

  defp evict_after_commit(id, result) do
    ${appModule}.PostCommit.run(fn -> evict(to_string(id)) end)
    result
  end
end
`,
    )
    .join("");

  const content = `# Auto-generated.  Do not edit by hand.
#
# The by-id read cache: a \`GET /{id}\` answer per caller scope, evicted by
# every write of the aggregate.
defmodule ${cacheMod} do
  @moduledoc false
  require Logger
  import Plug.Conn

  @doc "The caller's scope fingerprint: the JSON array of the plan's inputs."
  def fingerprint(inputs) when is_list(inputs), do: Jason.encode!(inputs)

  @doc "The answer cached for \`id\` under \`scope\`: \`{:hit, answer}\` or \`:miss\`."
  def read(cache, id, scope) do
    with {:ok, raw} when is_binary(raw) <-
           guarded(cache, "read", fn -> store_get(cache.store, cache.prefix <> id) end),
         {:ok, %{^scope => answer}} <- Jason.decode(raw) do
      {:hit, answer}
    else
      _ -> :miss
    end
  end

  @doc "Store \`answer\` under \`scope\` in the id's entry, keeping the other scopes' answers."
  def write(cache, id, scope, answer) do
    key = cache.prefix <> id

    guarded(cache, "write", fn ->
      with {:ok, raw} <- store_get(cache.store, key) do
        entry = Map.put(decode_entry(raw), scope, answer)
        store_set(cache.store, key, Jason.encode!(entry), cache.ttl_seconds)
      end
    end)

    :ok
  end

  @doc "Drop the id's whole entry: every scope's answer goes at once."
  def evict(cache, id) do
    guarded(cache, "evict", fn -> store_del(cache.store, cache.prefix <> id) end)
    :ok
  end

  @doc "Send one by-id answer, marked \`hit\` or \`miss\`."
  def respond(conn, body, etag, status) do
    conn = if etag, do: put_resp_header(conn, "etag", etag), else: conn

    conn
    |> put_resp_header(${JSON.stringify(CACHE_STATUS_HEADER)}, status)
    |> put_resp_content_type("application/json")
    |> send_resp(200, body)
  end

  defp decode_entry(nil), do: %{}

  defp decode_entry(raw) do
    case Jason.decode(raw) do
      {:ok, %{} = entry} -> entry
      _ -> %{}
    end
  end

  # A store that refuses a call (or is away) is logged and read as a miss.
  defp guarded(cache, op, fun) do
    case fun.() do
      {:ok, _} = ok -> ok
      {:error, reason} -> unavailable(cache, op, reason)
    end
  rescue
    reason -> unavailable(cache, op, reason)
  catch
    kind, reason -> unavailable(cache, op, {kind, reason})
  end

  defp unavailable(cache, op, reason) do
    ${warn}
    :error
  end

${getClauses.join("\n\n")}

${setClauses.join("\n\n")}

${delClauses.join("\n\n")}
end
${memoryModule}${aggregateModules}`;

  return { path: `lib/${appName}/by_id_cache.ex`, content, children, usesRedis };
}
