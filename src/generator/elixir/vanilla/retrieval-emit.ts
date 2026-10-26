// ---------------------------------------------------------------------------
// Vanilla foundation — `retrieval` emission (retrieval.md).
//
// A retrieval is a plain Ecto query module.  One module per retrieval at
// `lib/<app>/<ctx>/retrievals/<retrieval>.ex`:
//
//     defmodule <App>.<Ctx>.Retrievals.<Name> do
//       import Ecto.Query
//       alias <App>.Repo
//       def run(arg1, arg2, ..., opts \\ []) do
//         query = from(record in <Agg>, where: <predicate>)
//         query = if opts[:limit], do: limit(query, ^opts[:limit]), else: query
//         query = if opts[:offset], do: offset(query, ^opts[:offset]), else: query
//         query = order_by(query, [record], [asc: record.<field>, ...])
//         {:ok, Repo.all(query)}
//       end
//     end
//
// The context facade adds `defdelegate run_<retrieval>_<agg>(args..., opts \\\\ [])`
// so workflow `repo-run` lowerings (a follow-up slice) can call
// `Context.run_<ret>_<agg>(args..., page: [limit:, offset:])`.
//
// The `where` predicate uses `filterArgs: true`
// so a declared retrieval param renders as Ecto's `^name` pin form, and an
// `enum-value` is the stored string column (`"confirmed"`), not an atom
// (`:confirmed`).
// Mirrors the established vanilla repository-emit.ts shape.
// ---------------------------------------------------------------------------

import type {
  AggregateIR,
  BoundedContextIR,
  RetrievalIR,
  SortTermIR,
  SystemIR,
} from "../../../ir/types/loom-ir.js";
import { exprUsesCurrentUser } from "../../../ir/types/loom-ir.js";
import { elixirLocal, snake, upperFirst } from "../../../util/naming.js";
import { type RenderCtx, renderExpr } from "../render-expr.js";
import {
  aggregateUsesPrincipalContextFilter,
  DOC_DENY_HELPER,
  DOC_DENY_PREDICATE,
  renderDocPredicate,
  vanillaDocCapabilityFilter,
} from "./capability-filter.js";
import { docFilterLambdaArg, docPredReadsRecord, isVanillaDocAgg } from "./document-emit.js";
import { isEventSourced } from "./eventsourced-emit.js";
import { readPreloadRels } from "./read-preload.js";

/** Does retrieval `r` get an Ecto query module (and its `run_…` delegate)?
 *  Only over an aggregate with a table: an event-sourced aggregate has no Ecto
 *  schema to `from(...)` over — its reads fold the stream inside its
 *  repository, which is where a paged criterion read's synthesised
 *  `findAllBy<Criterion>` page method lives. */
export function emitsRetrievalModule(r: RetrievalIR, ctx: BoundedContextIR): boolean {
  if (r.targetType.kind !== "entity") return false;
  const name = r.targetType.name;
  const target = ctx.aggregates.find((a) => a.name === name);
  return !(target && isEventSourced(target));
}

/** Does the retrieval named `retrievalName` read the request actor
 *  (`opts[:current_user]`)?  True when its target aggregate carries a principal
 *  (tenancy) filter or its own `where` reads `currentUser` — the same decision
 *  that makes its module bind `current_user`.  A caller holding the actor passes
 *  it as the `current_user:` opt; one that does not scopes to no rows. */
export function retrievalReadsActor(retrievalName: string, ctx: BoundedContextIR): boolean {
  const r = (ctx.retrievals ?? []).find((x) => snake(x.name) === snake(retrievalName));
  if (r?.targetType.kind !== "entity") return false;
  const targetName = r.targetType.name;
  const target = ctx.aggregates.find((a) => a.name === targetName);
  return (
    (target ? aggregateUsesPrincipalContextFilter(target) : false) || exprUsesCurrentUser(r.where)
  );
}

/** Per-context fan-out: emit one Ecto query module per retrieval. */
export function emitVanillaRetrievals(
  appName: string,
  appModule: string,
  ctx: BoundedContextIR,
  out: Map<string, string>,
  sys?: SystemIR,
): void {
  const retrievals = ctx.retrievals ?? [];
  if (retrievals.length === 0) return;
  const ctxSnake = snake(ctx.name);
  const contextModule = `${appModule}.${upperFirst(ctx.name)}`;
  for (const r of retrievals) {
    if (!emitsRetrievalModule(r, ctx) || r.targetType.kind !== "entity") continue;
    // The retrieval reads its target aggregate, so it honours that aggregate's
    // capability filter (soft-delete / scoping) just like the CRUD reads.
    const targetName = r.targetType.name;
    const target = ctx.aggregates.find((a) => a.name === targetName);
    // A retrieval whose OWN `where:` reads `currentUser` binds the actor from
    // `opts[:current_user]` — the rendered `^(current_user && …)` pin otherwise
    // names a variable `run/1` never bound.  The target's own restrictions need
    // no binding here: `Repo.prepare_query/3` applies them, with the caller's
    // `current_user:` (or the ambient principal) and `skip_filters:` options.
    const ownPrincipal = exprUsesCurrentUser(r.where);
    // A `shape: document` target keeps its fields in the jsonb embed: it has no
    // `base_query/0` and no columns to query, so the retrieval filters in-app
    // over the rehydrated embed, exactly as its repository's reads do.
    if (target && isVanillaDocAgg(target, ctx, sys)) {
      out.set(
        `lib/${appName}/${ctxSnake}/retrievals/${snake(r.name)}.ex`,
        renderDocRetrievalModule(r, target, contextModule, appModule),
      );
      continue;
    }
    out.set(
      `lib/${appName}/${ctxSnake}/retrievals/${snake(r.name)}.ex`,
      renderRetrievalModule(
        r,
        contextModule,
        appModule,
        ownPrincipal,
        !!target,
        // The rows are returned as aggregate structs the callers serialise
        // through the wireShape, so every collection association the REST read
        // preloads is preloaded here too — an unloaded `has_many` is
        // `%Ecto.Association.NotLoaded{}`, which the serializer cannot map.
        target ? readPreloadRels(target, ctx, sys) : [],
      ),
    );
  }
}

function renderRetrievalModule(
  r: RetrievalIR,
  contextModule: string,
  appModule: string,
  /** The retrieval's own `where` reads `currentUser`. */
  ownPrincipal: boolean,
  /** The target is an aggregate of this context, with a `base_query/0`. */
  scoped: boolean,
  preloadRels: readonly string[] = [],
): string {
  const aggName = (r.targetType as { kind: "entity"; name: string }).name;
  const moduleName = `${contextModule}.Retrievals.${upperFirst(r.name)}`;
  const aggModule = `${contextModule}.${upperFirst(aggName)}`;
  const renderCtx: RenderCtx = {
    thisName: "record",
    contextModule,
    // Retrieval params bind via Ecto pin syntax (`^needle`) inside the
    // `from ... where: ...` macro.
    filterArgs: true,
  };
  const args = r.params.map((p) => elixirLocal(p.name));
  // The retrieval's own `where` predicate, over the target's `base_query/0`.
  const ownWhere = renderExpr(r.where, renderCtx);
  const source = scoped ? `${aggModule}.base_query()` : aggModule;
  const sortClause = renderSortClause(r.sort);

  // Build the Ecto pipeline in stages.  `from(...)` opens, conditional
  // `limit`/`offset` apply pagination opts (`page: [limit: 10, offset: 0]`
  // surfaces as `opts[:limit]` / `opts[:offset]` at the call site), then
  // `order_by` closes when a `sort:` clause is declared.  Each stage is a
  // pipe step so the source compiles cleanly even when pagination opts
  // are absent.
  const pipeline: string[] = [];
  if (ownPrincipal) pipeline.push(`    current_user = opts[:current_user]`);
  pipeline.push(`    query = from(record in ${source}, where: ${ownWhere})`);
  pipeline.push(`    query = if opts[:limit], do: limit(query, ^opts[:limit]), else: query`);
  pipeline.push(`    query = if opts[:offset], do: offset(query, ^opts[:offset]), else: query`);
  if (sortClause) pipeline.push(`    query = ${sortClause}`);
  // A call-site `ignoring` arrives as `skip_filters:` and the actor as
  // `current_user:`; `Repo.prepare_query/3` reads both.
  const read =
    "Repo.all(query, current_user: opts[:current_user], skip_filters: opts[:skip_filters])";
  pipeline.push(
    preloadRels.length > 0
      ? `    {:ok, query |> ${read.replace("Repo.all(query, ", "Repo.all(")} |> Repo.preload([${preloadRels.join(", ")}])}`
      : `    {:ok, ${read}}`,
  );

  // `opts` is always referenced (the if/else above) — no unused-var
  // warning even when params are empty.  A declared parameter the predicate
  // never reads (`criterion C(final: bool, label: string) of T = this.label ==
  // label`) is bound and unread, which `mix compile --warnings-as-errors`
  // refuses: the arity stays (callers pass every parameter positionally) and
  // the unread NAME underscores, as on the repository's find heads.
  const body = pipeline.join("\n");
  const head = args.map((n) => (new RegExp(`\\b${n}\\b`).test(body) ? n : `_${n}`));
  const argList = head.length > 0 ? `${head.join(", ")}, opts \\\\ []` : "opts \\\\ []";
  return `# Auto-generated.
defmodule ${moduleName} do
  @moduledoc """
  Retrieval: ${upperFirst(r.name)}

  Source aggregate: ${upperFirst(aggName)}
  Foundation: vanilla (plain Ecto).
  """

  import Ecto.Query
  alias ${appModule}.Repo

  @doc "Execute the retrieval; returns {:ok, [aggregate]}."
  def run(${argList}) do
${body}
  end
end
`;
}

/** A retrieval over a `shape: document` aggregate: load the rows in `id`
 *  order, keep those the retrieval's own predicate AND the aggregate's
 *  restrictions admit — both evaluated in-app over `record = row.data` — then
 *  sort and window in memory. */
function renderDocRetrievalModule(
  r: RetrievalIR,
  target: AggregateIR,
  contextModule: string,
  appModule: string,
): string {
  const moduleName = `${contextModule}.Retrievals.${upperFirst(r.name)}`;
  const aggModule = `${contextModule}.${upperFirst(target.name)}`;
  const own = renderDocPredicate(r.where, target, contextModule, "row");
  const cap = vanillaDocCapabilityFilter(target, contextModule, "row", { actor: true });
  const pred = cap ? `(${own}) and (${cap})` : own;
  const needsActor = /\bcurrent_user\b/.test(pred);
  // Stable sorts applied last term first give the declared multi-key order.
  const sorts = [...r.sort]
    .reverse()
    .map(
      (t) =>
        `    rows = Enum.sort_by(rows, fn row -> row.data.${t.path.map((s) => snake(s.name)).join(".")} end, :${t.direction})`,
    );
  const pipeline = [
    ...(needsActor ? ["    current_user = opts[:current_user]"] : []),
    "    rows =",
    `      ${aggModule}`,
    "      |> Ecto.Query.order_by([r], r.id)",
    "      |> Repo.all()",
    `      |> Enum.filter(fn ${docFilterLambdaArg(pred)} ->`,
    ...(docPredReadsRecord(pred) ? ["        record = row.data"] : []),
    `        ${pred}`,
    "      end)",
    ...sorts,
    "    rows = if opts[:offset], do: Enum.drop(rows, opts[:offset]), else: rows",
    "    rows = if opts[:limit], do: Enum.take(rows, opts[:limit]), else: rows",
    "    {:ok, rows}",
  ];
  const body = pipeline.join("\n");
  const args = r.params.map((p) => elixirLocal(p.name));
  const head = args.map((n) => (new RegExp(`\\b${n}\\b`).test(body) ? n : `_${n}`));
  const argList = head.length > 0 ? `${head.join(", ")}, opts \\\\ []` : "opts \\\\ []";
  const denyHelper = pred.includes(DOC_DENY_PREDICATE) ? `\n\n${DOC_DENY_HELPER}` : "";
  return `# Auto-generated.
defmodule ${moduleName} do
  @moduledoc """
  Retrieval: ${upperFirst(r.name)}

  Source aggregate: ${upperFirst(target.name)} (document shape — filtered in-app)
  Foundation: vanilla (plain Ecto).
  """

  require Ecto.Query
  alias ${appModule}.Repo

  @doc "Execute the retrieval; returns {:ok, [aggregate]}."
  def run(${argList}) do
${body}
  end${denyHelper}
end
`;
}

function renderSortClause(sort: SortTermIR[]): string | undefined {
  if (sort.length === 0) return undefined;
  // Render each term as `asc: record.<field>` / `desc: record.<field>`.
  // Nested paths (`order.customer.name`) lower to a `record.customer.name`
  // chain — Ecto's `order_by` accepts the dotted form when the path is
  // through preloaded relations.  Retrievals don't yet declare `loads:`,
  // so today every sort term is a single-segment field; the dotted form
  // still parses cleanly for the future case.
  const terms = sort.map((t) => {
    const path = t.path.map((seg) => snake(seg.name)).join(".");
    return `${t.direction}: record.${path}`;
  });
  return `order_by(query, [record], [${terms.join(", ")}])`;
}
