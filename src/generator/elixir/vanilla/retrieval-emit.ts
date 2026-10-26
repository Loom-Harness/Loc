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

import type { BoundedContextIR, RetrievalIR, SortTermIR } from "../../../ir/types/loom-ir.js";
import { exprUsesCurrentUser } from "../../../ir/types/loom-ir.js";
import { elixirLocal, snake, upperFirst } from "../../../util/naming.js";
import { type RenderCtx, renderExpr } from "../render-expr.js";

/** Per-context fan-out: emit one Ecto query module per retrieval. */
export function emitVanillaRetrievals(
  appName: string,
  appModule: string,
  ctx: BoundedContextIR,
  out: Map<string, string>,
): void {
  const retrievals = ctx.retrievals ?? [];
  if (retrievals.length === 0) return;
  const ctxSnake = snake(ctx.name);
  const contextModule = `${appModule}.${upperFirst(ctx.name)}`;
  for (const r of retrievals) {
    if (r.targetType.kind !== "entity") continue;
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
    out.set(
      `lib/${appName}/${ctxSnake}/retrievals/${snake(r.name)}.ex`,
      renderRetrievalModule(r, contextModule, appModule, ownPrincipal, !!target),
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
  const argList = args.length > 0 ? `${args.join(", ")}, opts \\\\ []` : "opts \\\\ []";
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
  pipeline.push(
    `    {:ok, Repo.all(query, current_user: opts[:current_user], skip_filters: opts[:skip_filters])}`,
  );

  // `opts` is always referenced (the if/else above) — no unused-var
  // warning even when params are empty.  Params themselves are referenced
  // in `whereExpr` whenever the retrieval is well-formed (the validator
  // would already have errored on a stray param).
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
${pipeline.join("\n")}
  end
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
