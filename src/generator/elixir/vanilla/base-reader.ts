// ---------------------------------------------------------------------------
// Abstract-base polymorphic reader (inheritance.md) — the repository module,
// the tagged serializer and the routing decision the controller, context and
// OpenAPI emitters share.
//
// The read is the polymorphic-read fact (`polymorphicReadFor`,
// `src/ir/enrich/read-scope.ts`) rendered on Ecto:
//
//   - TPH: ONE query over the shared table, from the ROOT's `base_query/0`.
//     The root's schema hosts its own restrictions and every concrete's own,
//     guarded by `kind` (read-scope-emit.ts), and `Repo.prepare_query/3`
//     applies them — so no restriction is spelled here.  The order (`id`) and
//     the page window are the database's, over the whole hierarchy.  Each row
//     comes back as the root schema (the union of every subtype's columns) and
//     is turned into its concrete schema by `kind`: the concrete maps the same
//     columns with the same types, so the conversion is a field projection
//     onto the concrete struct, and the concrete's own associations are then
//     preloaded like its repository's reads do.
//   - TPC: one table per concrete, so the reader runs each concrete's scoped
//     read (its `base_query/0` + `prepare_query`) up to the end of the
//     requested window and merges them in the one global `id` order before it
//     pages.  A `shape: document` concrete has no SQL read scope; its
//     repository's `list` (filtered in-app) stands in for it.
//
// Every row goes on the wire tagged with its concrete's name (`"type"`).
// ---------------------------------------------------------------------------

import { polymorphicReadFor } from "../../../ir/enrich/read-scope.js";
import { PAGED_DEFAULT_PAGE, PAGED_DEFAULT_PAGE_SIZE } from "../../../ir/stdlib/generics.js";
import type { AggregateIR, BoundedContextIR, SystemIR } from "../../../ir/types/loom-ir.js";
import { isTphBase, tpcConcretesOf, tphConcretesOf } from "../../../ir/util/inheritance.js";
import { snake, upperFirst } from "../../../util/naming.js";
import { aggregateUsesPrincipalContextFilter } from "./capability-filter.js";
import { isVanillaDocAgg } from "./document-emit.js";
import { readPreloadRels } from "./read-preload.js";
import { renderWireSerialize } from "./wire-serialize.js";

function concretesOf(base: AggregateIR, ctx: BoundedContextIR): AggregateIR[] {
  return isTphBase(base, ctx.aggregates)
    ? tphConcretesOf(base, ctx.aggregates)
    : tpcConcretesOf(base, ctx.aggregates);
}

/** True when `base`'s polymorphic read is routed (`GET /<bases>`, and on TPH
 *  `GET /<bases>/{id}`).
 *
 *  The route answers every subtype's rows, so it exists only where every
 *  subtype's own list read is open to the same caller: a concrete whose `all`
 *  carries a `requires` gate (author-written, or the `denyByDefault`
 *  synthesised one) or whose wire masks a field would have that gate or mask
 *  bypassed by the base route. */
export function routesPolymorphicRead(base: AggregateIR, ctx: BoundedContextIR): boolean {
  const read = polymorphicReadFor(base, ctx.aggregates);
  if (!read) return false;
  return read.variants.every((v) => {
    const concrete = ctx.aggregates.find((a) => a.name === v.aggregate);
    const all = (ctx.repositories ?? [])
      .find((r) => r.aggregateName === v.aggregate)
      ?.finds?.find((f) => f.name === "all");
    return !!concrete && !!all && !all.requires && !concrete.fields.some((f) => f.maskUnless);
  });
}

/** The polymorphic reader module, `<Base>Repository`: `list/3` (paged, global
 *  `id` order) and `find_by_id/2`, each returning concrete structs. */
export function renderPolymorphicReader(
  appModule: string,
  ctxModule: string,
  base: AggregateIR,
  ctx: BoundedContextIR,
  sys?: SystemIR,
): string {
  const contextModule = `${appModule}.${ctxModule}`;
  const baseModule = `${contextModule}.${upperFirst(base.name)}`;
  const concretes = concretesOf(base, ctx);
  const modOf = (a: AggregateIR): string => `${contextModule}.${upperFirst(a.name)}`;
  const tph = isTphBase(base, ctx.aggregates);
  const pagedEnvelope = `    {:ok,
     %{
       items: items,
       page: page,
       pageSize: page_size,
       total: total,
       totalPages: if(page_size > 0, do: ceil(total / page_size), else: 0)
     }}`;
  const listHead = `  @spec list(pos_integer(), pos_integer(), map() | nil) :: {:ok, map()} | {:error, term()}
  def list(page \\\\ ${PAGED_DEFAULT_PAGE}, page_size \\\\ ${PAGED_DEFAULT_PAGE_SIZE}, current_user \\\\ nil) do`;
  const findHead = `  @spec find_by_id(binary(), map() | nil) :: {:ok, struct()} | {:error, :not_found}
  def find_by_id(id, current_user \\\\ nil) when is_binary(id) do`;
  if (concretes.length === 0) {
    return `# Auto-generated.
defmodule ${baseModule}Repository do
  @moduledoc "Read-only polymorphic reader for the abstract ${upperFirst(base.name)} hierarchy — it has no concrete subtype, so it reads nothing."

${listHead.replace("current_user \\\\ nil", "_current_user \\\\ nil")}
    {:ok, %{items: [], page: page, pageSize: page_size, total: 0, totalPages: 0}}
  end

${findHead.replace("def find_by_id(id, current_user", "def find_by_id(_id, _current_user").replace(" when is_binary(id)", "")}
    {:error, :not_found}
  end
end
`;
  }
  const preloads = concretes.map((c) => ({ agg: c, rels: readPreloadRels(c, ctx, sys) }));
  const anyPreload = preloads.some((p) => p.rels.length > 0);
  const preloadFn = anyPreload
    ? `

  # The concrete's own associations, loaded as its repository's reads load them.
${preloads
  .map(
    (p) =>
      `  defp preload(%${modOf(p.agg)}{} = record), do: ${p.rels.length > 0 ? `Repo.preload(record, [${p.rels.join(", ")}])` : "record"}`,
  )
  .join("\n")}`
    : "";
  const finish = anyPreload ? " |> preload()" : "";

  if (tph) {
    const kinds = concretes.map((c) => `${JSON.stringify(c.name)} => ${modOf(c)}`).join(", ");
    return `# Auto-generated.
defmodule ${baseModule}Repository do
  @moduledoc """
  Read-only polymorphic reader for the abstract ${upperFirst(base.name)} hierarchy (TPH):
  one query over the shared table, from \`${upperFirst(base.name)}.base_query/0\`, whose
  read scope (the root's restrictions and each subtype's own, kind-guarded) is
  applied by \`Repo.prepare_query/3\`.  Each row loads as its concrete schema.
  """
  import Ecto.Query
  alias ${appModule}.Repo

  # Each \`kind\` of the shared table and the schema its rows load as.
  @kinds %{${kinds}}

${listHead}
    query = from(record in ${baseModule}.base_query(), where: record.kind in ^Map.keys(@kinds))
    total = Repo.aggregate(query, :count, current_user: current_user)
    offset = (page - 1) * page_size

    items =
      query
      |> order_by([record], asc: record.id)
      |> limit(^page_size)
      |> offset(^offset)
      |> Repo.all(current_user: current_user)
      |> Enum.map(&as_concrete/1)

${pagedEnvelope}
  end

${findHead}
    query =
      from(record in ${baseModule}.base_query(),
        where: record.id == ^id and record.kind in ^Map.keys(@kinds)
      )

    case Repo.one(query, current_user: current_user) do
      nil -> {:error, :not_found}
      row -> {:ok, as_concrete(row)}
    end
  end

  # One shared-table row as its concrete schema: the concrete maps the same
  # columns with the same types, so this projects the loaded fields onto it.
  defp as_concrete(%{kind: kind} = row) do
    schema = Map.fetch!(@kinds, kind)

    schema
    |> struct(Map.take(Map.from_struct(row), schema.__schema__(:fields)))
    |> Ecto.put_meta(state: :loaded)${finish}
  end${preloadFn}
end
`;
  }

  // TPC: merge each concrete's scoped read in the global `id` order.  A
  // document concrete's repository takes the actor only when a principal
  // filter scopes it.
  const actorArg = (c: AggregateIR): string =>
    aggregateUsesPrincipalContextFilter(c) ? "current_user" : "";
  const docs = new Set(concretes.filter((c) => isVanillaDocAgg(c, ctx, sys)).map((c) => c.name));
  const reads = concretes.map((c) => {
    const mod = modOf(c);
    if (docs.has(c.name)) {
      // In-app filtered: the repository's list, flattened for the merge.
      return `      fn _window ->
        {:ok, rows} = ${mod}Repository.list(${actorArg(c)})
        {length(rows), rows}
      end`;
    }
    return `      fn window ->
        query = ${mod}.base_query()

        {Repo.aggregate(query, :count, current_user: current_user),
         query |> order_by([record], asc: record.id) |> limit(^window) |> Repo.all(current_user: current_user)}
      end`;
  });
  const finds = concretes.map((c) => {
    const mod = modOf(c);
    return docs.has(c.name)
      ? `      fn -> case ${mod}Repository.find_by_id(id${actorArg(c) ? `, ${actorArg(c)}` : ""}) do
          {:ok, record} -> record
          _ -> nil
        end
      end`
      : `      fn -> Repo.one(from(record in ${mod}.base_query(), where: record.id == ^id), current_user: current_user) end`;
  });
  const usesQuery = concretes.some((c) => !docs.has(c.name));
  // Every concrete a document one with no principal filter: nothing reads the
  // actor, and an unread binding fails `--warnings-as-errors`.
  const actorName =
    usesQuery || concretes.some((c) => actorArg(c)) ? "current_user" : "_current_user";
  return `# Auto-generated.
defmodule ${baseModule}Repository do
  @moduledoc """
  Read-only polymorphic reader for the abstract ${upperFirst(base.name)} hierarchy (TPC):
  each concrete's scoped read, merged in the one global \`id\` order and then
  paged.  Each concrete's read scope is its own (\`base_query/0\` +
  \`Repo.prepare_query/3\`).
  """${usesQuery ? "\n  import Ecto.Query" : ""}
  alias ${appModule}.Repo

${listHead.replace("current_user \\\\ nil", `${actorName} \\\\ nil`)}
    window = page * page_size

    reads =
      Enum.map(
        [
${reads.join(",\n")}
        ],
        fn read -> read.(window) end
      )

    total = reads |> Enum.map(&elem(&1, 0)) |> Enum.sum()

    items =
      reads
      |> Enum.flat_map(&elem(&1, 1))
      |> Enum.sort_by(& &1.id)
      |> Enum.drop((page - 1) * page_size)
      |> Enum.take(page_size)${anyPreload ? "\n      |> Enum.map(&preload/1)" : ""}

${pagedEnvelope}
  end

${findHead.replace("current_user \\\\ nil", `${actorName} \\\\ nil`)}
    [
${finds.join(",\n")}
    ]
    |> Enum.find_value(fn read -> read.() end)
    |> case do
      nil -> {:error, :not_found}
      record -> {:ok, record${finish}}
    end
  end${preloadFn}
end
`;
}

/** The base controller's `serialize/1`: one clause per concrete, each the
 *  concrete's own wire body tagged with its name (`"type"`), plus every
 *  concrete's helpers.  Suffixed per concrete, so same-named parts or value
 *  objects of two subtypes cannot collide. */
export function renderPolymorphicSerialize(
  appModule: string,
  ctxModule: string,
  base: AggregateIR,
  ctx: BoundedContextIR,
  sys?: SystemIR,
): string {
  const contextModule = `${appModule}.${ctxModule}`;
  const clauses: string[] = [];
  const helperTexts = new Set<string>();
  for (const c of concretesOf(base, ctx)) {
    const suffix = snake(c.name);
    const mod = `${contextModule}.${upperFirst(c.name)}`;
    const doc = isVanillaDocAgg(c, ctx, sys);
    const wire = doc
      ? renderWireSerialize(c, ctx, {
          headVar: "row",
          bind: "    record = row.data",
          idExpr: "row.id",
          versionExpr: "row.version",
          contextModule,
          nameSuffix: suffix,
        })
      : renderWireSerialize(c, ctx, { contextModule, nameSuffix: suffix });
    clauses.push(
      `  defp serialize(%${mod}{} = record),\n    do: Map.put(serialize_${suffix}(record), "type", ${JSON.stringify(c.name)})`,
    );
    helperTexts.add(wire.serialize);
    for (const h of wire.helpers) helperTexts.add(h);
  }
  if ([...helperTexts].some((h) => h.includes("__ref_ids("))) {
    helperTexts.add(
      `  defp __ref_ids(%Ecto.Association.NotLoaded{}), do: []\n` +
        `  defp __ref_ids(records) when is_list(records), do: Enum.map(records, & &1.id)\n` +
        `  defp __ref_ids(_), do: []`,
    );
  }
  return [clauses.join("\n\n"), ...helperTexts].join("\n\n");
}
