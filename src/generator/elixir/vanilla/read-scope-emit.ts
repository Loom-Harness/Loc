// ---------------------------------------------------------------------------
// Ecto read scope — every restriction a read of an aggregate applies, rendered
// once, where Ecto applies it to every query (the `readScope` IR fact).
//
// Two homes, split by whether a read may drop the restriction:
//
//   * `base_query/0` on the aggregate's schema module — the TPH `kind`
//     discriminator and the restrictions no `ignoring` clause can drop and that
//     read no principal (a bare `filter`, a `deny`).  Every repository read,
//     retrieval and query projection starts from it.
//   * `Repo.prepare_query/3` — the bypassable capability filters
//     (`softDeletable`, `tenantOwned`, …) and the principal-bound ones.  The
//     generated Repo dispatches on the queried schema's `__loom_filters__/0`
//     and applies each clause through `__loom_filter__/3`, so a read cannot
//     forget one.  `ignoring <Cap>` lowers to `skip_filters: [:<cap>]`,
//     `ignoring *` to `skip_filters: :all`; neither ever reaches the
//     non-bypassable `:loom_filter` clause.
//
// The principal follows Ecto's multi-tenancy-with-foreign-keys guide: a read
// passes it explicitly (`current_user:`), otherwise `default_options/1` takes
// the ambient one (`Process.get(:loom_current_user)`, set by the auth plug, a
// LiveView mount, the event-origin wrapper, or `Repo.async/1` in a spawned
// task), and a principal-bound clause raises when neither is set — fail closed,
// loudly.
//
// `prepare_query/3` does not reach joined sources, so a read that joins an
// aggregate keeps an explicit predicate for the joined binding.  Preloads are
// skipped (the parent read was already scoped), as the guide does.
// ---------------------------------------------------------------------------

import {
  type ReadBypass,
  type ReadRestriction,
  readScopeFor,
} from "../../../ir/enrich/read-scope.js";
import type { AggregateIR, ExprIR } from "../../../ir/types/loom-ir.js";
import { snake } from "../../../util/naming.js";
import { renderEctoRestriction } from "./capability-filter.js";

/** The `prepare_query` clause key of the restrictions no `ignoring` can drop
 *  but that read the principal (a bare `filter` over `currentUser`). */
const UNSKIPPABLE_FILTER_KEY = "loom_filter";

/** One `__loom_filter__/3` clause: every restriction sharing a key, conjoined. */
export interface EctoFilterClause {
  /** The `skip_filters:` atom (snake of the capability), or
   *  {@link UNSKIPPABLE_FILTER_KEY}. */
  key: string;
  /** The Ecto predicate under the `record` binding. */
  predicate: string;
  /** The predicate reads `current_user`. */
  principal: boolean;
}

export interface EctoReadScope {
  /** `base_query/0`'s `where:` predicate, or null for a bare `from`. */
  baseWhere: string | null;
  /** The `prepare_query/3` clauses, in restriction order. */
  clauses: EctoFilterClause[];
}

/** The `skip_filters:` key a capability name lowers to. */
function skipFilterKey(capability: string): string {
  return snake(capability);
}

function readsPrincipal(rendered: string): boolean {
  return /\bcurrent_user\b/.test(rendered);
}

function conjoin(preds: readonly string[]): string | null {
  if (preds.length === 0) return null;
  return preds.length === 1 ? preds[0]! : preds.map((p) => `(${p})`).join(" and ");
}

/** The aggregate's read scope as Ecto renders it.  For a TPH root the
 *  subtypes' own restrictions are hosted kind-guarded
 *  (`record.kind != "Car" or (<pred>)`), so a direct read of the root's schema
 *  applies every one of them. */
export function ectoReadScope(
  agg: AggregateIR,
  pool: readonly AggregateIR[],
  contextModule: string,
): EctoReadScope {
  const scope = readScopeFor(agg, pool);
  const base: string[] = [];
  const grouped = new Map<string, string[]>();
  const place = (r: ReadRestriction, rendered: string): void => {
    if (!r.bypassable && !readsPrincipal(rendered)) {
      base.push(rendered);
      return;
    }
    const key = r.capability ? skipFilterKey(r.capability) : UNSKIPPABLE_FILTER_KEY;
    grouped.set(key, [...(grouped.get(key) ?? []), rendered]);
  };
  for (const r of scope.restrictions) {
    if (r.kind === "discriminator") {
      base.push(`record.kind == ${JSON.stringify(r.discriminator)}`);
      continue;
    }
    place(r, renderEctoRestriction(r.predicate as ExprIR, contextModule));
  }
  for (const g of scope.subtypeRestrictions) {
    const pred = renderEctoRestriction(g.restriction.predicate as ExprIR, contextModule);
    place(g.restriction, `record.kind != ${JSON.stringify(g.discriminator)} or (${pred})`);
  }
  return {
    baseWhere: conjoin(base),
    clauses: [...grouped].map(([key, preds]) => {
      const predicate = conjoin(preds)!;
      return { key, predicate, principal: readsPrincipal(predicate) };
    }),
  };
}

/** The read-scope functions appended to an aggregate's schema module. */
export function renderSchemaReadScope(scope: EctoReadScope): string {
  const baseQuery = scope.baseWhere
    ? `Ecto.Query.from(record in __MODULE__, where: ${scope.baseWhere})`
    : "Ecto.Query.from(record in __MODULE__)";
  const filters = scope.clauses.map((c) => `{:${c.key}, ${c.principal}}`).join(", ");
  const clauseFns = scope.clauses.map(
    (c) =>
      `  def __loom_filter__(query, :${c.key}, ${c.principal ? "" : "_"}current_user),\n    do: Ecto.Query.where(query, [record], ${c.predicate})`,
  );
  return `
  require Ecto.Query

  @doc """
  Every read of this aggregate starts here: its discriminator and the
  restrictions no \`ignoring\` clause can drop.  The bypassable ones are
  applied by \`Repo.prepare_query/3\` through \`__loom_filters__/0\`.
  """
  @spec base_query() :: Ecto.Query.t()
  def base_query, do: ${baseQuery}

  @doc false
  # {skip_filters key, reads the principal?} — applied by Repo.prepare_query/3.
  def __loom_filters__, do: [${filters}]
${
  clauseFns.length > 0
    ? `
  @doc false
${clauseFns.join("\n\n")}
`
    : ""
}`;
}

/** The `skip_filters:` Repo option an `ignoring` clause lowers to, or null when
 *  the read drops nothing. */
export function skipFiltersOption(bypass: ReadBypass | undefined): string | null {
  if (!bypass) return null;
  if (bypass.bypassAll) return "skip_filters: :all";
  const caps = bypass.bypassCaps ?? [];
  if (caps.length === 0) return null;
  return `skip_filters: [${caps.map((c) => `:${skipFilterKey(c)}`).join(", ")}]`;
}

/** The Repo options of one read: the explicit principal (when the read has one
 *  in scope) and the `ignoring` clause.  Empty string when there are none. */
export function readOpts(opts: { principal?: string; bypass?: ReadBypass }): string {
  const parts = [
    ...(opts.principal ? [`current_user: ${opts.principal}`] : []),
    ...(skipFiltersOption(opts.bypass) ? [skipFiltersOption(opts.bypass)!] : []),
  ];
  return parts.join(", ");
}

/** The read-scope half of the generated Repo: `default_options/1` reads the
 *  ambient principal, `prepare_query/3` applies the queried schema's filters,
 *  and `async/1` carries the principal into a spawned task. */
export function renderRepoReadScope(): string {
  return `
  @principal_key :loom_current_user

  @doc """
  Run \`fun\` in a \`Task.async\` that carries the caller's ambient principal,
  so a scoped read in the task sees the caller's tenant.  A bare
  \`Task.async\` starts without one, and its first principal-scoped read raises.
  """
  def async(fun) when is_function(fun, 0) do
    principal = Process.get(@principal_key)

    Task.async(fn ->
      if principal != nil, do: Process.put(@principal_key, principal)
      fun.()
    end)
  end

  @impl true
  def default_options(_operation), do: [loom_principal: Process.get(@principal_key)]

  @impl true
  def prepare_query(operation, query, opts) when operation in [:all, :stream] do
    {apply_read_scope(query, opts), opts}
  end

  def prepare_query(_operation, query, opts), do: {query, opts}

  defp apply_read_scope(%Ecto.Query{from: %{source: {_, schema}}} = query, opts)
       when is_atom(schema) and not is_nil(schema) do
    if opts[:ecto_query] in [:preload, :schema_migration] || opts[:schema_migration] ||
         !(Code.ensure_loaded?(schema) and function_exported?(schema, :__loom_filters__, 0)) do
      query
    else
      skip = Keyword.get(opts, :skip_filters, [])

      Enum.reduce(schema.__loom_filters__(), query, fn {key, principal?}, acc ->
        if skipped?(key, skip) do
          acc
        else
          schema.__loom_filter__(acc, key, if(principal?, do: principal!(opts, schema, key)))
        end
      end)
    end
  end

  defp apply_read_scope(query, _opts), do: query

  defp skipped?(:${UNSKIPPABLE_FILTER_KEY}, _skip), do: false
  defp skipped?(_key, :all), do: true
  defp skipped?(key, skip) when is_list(skip), do: key in skip
  defp skipped?(_key, _skip), do: false

  defp principal!(opts, schema, key) do
    opts[:current_user] || opts[:loom_principal] ||
      raise ArgumentError,
            "#{inspect(schema)} is read under its #{inspect(key)} filter, but no principal is set: " <>
              "pass current_user: to the read, run it in a request or a LiveView, " <>
              "or start the task with Repo.async/1"
  end
`;
}
