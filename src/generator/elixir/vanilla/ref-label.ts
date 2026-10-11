// The human label a LiveView page shows for an `X id` reference — the target
// aggregate's `derived display`, instead of the raw id.
//
// Two context-façade seams, both rendered from the SAME `displayDerived`
// expression the controller's `serialize/1` writes into the wire's `display`
// key, against the same `thisName: "record"` context — so the page and the
// REST read cannot spell one record two ways:
//
//   * `<agg>_label(record)`  — one loaded row → its label.  The id-select
//     picker maps its option list through it (it already holds the rows).
//   * `<agg>_labels(ids)`    — ONE `where id in ^ids` query for every
//     reference a page renders → `%{id => label}`.  `IdLink` reads the map, so
//     a 10-row list costs one extra query, not ten.
//
// A target with no `display` gets neither, and the page keeps rendering the id
// (the fallback every frontend shares).  The batch seam is withheld further
// from any aggregate whose READ is narrowed — a principal (tenancy) filter, a
// list `requires` gate, or a `mask unless` field — because it reads by id
// straight off the table and would otherwise print a label the record's own
// read seam refuses to serve.

import type {
  AggregateIR,
  BoundedContextIR,
  EnrichedAggregateIR,
  SystemIR,
} from "../../../ir/types/loom-ir.js";
import { exprUsesCurrentUser } from "../../../ir/types/loom-ir.js";
import { listReadGate } from "../../../ir/util/read-gates.js";
import { snake, upperFirst } from "../../../util/naming.js";
import { renderExpr } from "../render-expr.js";
import { aggregateUsesPrincipalContextFilter } from "./capability-filter.js";
import { isVanillaDocAgg } from "./document-emit.js";
import { isEventSourced } from "./eventsourced-emit.js";
import { isAbstractBase } from "./inheritance-emit.js";

/** Whether the aggregate's rows load as plain Ecto structs with one key per
 *  declared field (not a jsonb document, an event log, or a polymorphic base). */
export function isRelationalRowAgg(
  agg: AggregateIR,
  ctx: BoundedContextIR,
  sys: SystemIR | undefined,
): boolean {
  return !isEventSourced(agg) && !isAbstractBase(agg) && !isVanillaDocAgg(agg, ctx, sys);
}

/** Whether the context façade carries `<agg>_label/1`. */
export function servesRefLabel(
  agg: AggregateIR,
  ctx: BoundedContextIR,
  sys: SystemIR | undefined,
): boolean {
  const display = agg.displayDerived;
  if (!display || !isRelationalRowAgg(agg, ctx, sys)) return false;
  return !exprUsesCurrentUser(display.expr);
}

/** Whether the context façade carries the batch `<agg>_labels/1`. */
export function servesRefLabels(
  agg: AggregateIR,
  ctx: BoundedContextIR,
  sys: SystemIR | undefined,
): boolean {
  if (!servesRefLabel(agg, ctx, sys)) return false;
  if (aggregateUsesPrincipalContextFilter(agg)) return false;
  if (agg.fields.some((f) => f.maskUnless)) return false;
  const repo = (ctx.repositories ?? []).find((r) => r.aggregateName === agg.name);
  return listReadGate(repo) === undefined;
}

/** The two façade functions (empty when the aggregate has no `display`). */
export function renderRefLabelFacade(
  appModule: string,
  facadeMod: string,
  agg: AggregateIR,
  ctx: BoundedContextIR,
  sys: SystemIR | undefined,
): string {
  if (!servesRefLabel(agg, ctx, sys)) return "";
  const aggPascal = upperFirst(agg.name);
  const aggSnake = snake(agg.name);
  const schema = `${facadeMod}.${aggPascal}`;
  const label = renderExpr(agg.displayDerived!.expr, {
    thisName: "record",
    contextModule: facadeMod,
    agg: agg as EnrichedAggregateIR,
  });
  const one = `\n
  @doc "The \`display\` label of a loaded ${aggPascal} — what a page shows for a reference to it."
  def ${aggSnake}_label(%${schema}{} = record), do: ${label}`;
  if (!servesRefLabels(agg, ctx, sys)) return one;
  return `${one}

  @doc "Labels for the given ${aggPascal} ids in ONE query — \`%{id => label}\`; unknown or nil ids are absent."
  def ${aggSnake}_labels(ids) when is_list(ids) do
    import Ecto.Query, only: [from: 2]

    case ids |> Enum.reject(&is_nil/1) |> Enum.uniq() do
      [] ->
        %{}

      ids ->
        from(record in ${schema}, where: record.id in ^ids)
        |> ${appModule}.Repo.all()
        |> Map.new(fn record -> {record.id, ${aggSnake}_label(record)} end)
    end
  end`;
}
