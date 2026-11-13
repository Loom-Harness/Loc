// Write-time reference admission on the vanilla repository's write seam
// (docs/tenancy.md → "Reference admission"; the decision lives in
// `src/ir/plan/ref-scope.ts`).
//
// Before a row is written, every reference the plan marks `row-tenant` or
// `tenant-registry` is probed by reading the target through its own read
// scope: `Repo.prepare_query/3` applies the target's tenant floor (or the
// registry's self-scope) under the ambient principal, exactly as any read of
// that target does.  A reference the probe does not find is refused with the
// changeset error a foreign-key violation produces (`constraint: :foreign`),
// so the existing changeset arm of every controller answers it as it answers a
// reference to a row that does not exist.

import { aggregateTableName } from "../../../ir/enrich/storage-names.js";
import { admittedReferences } from "../../../ir/plan/ref-scope.js";
import type { AggregateIR, BoundedContextIR } from "../../../ir/types/loom-ir.js";
import { outboundReferenceFields } from "../../../ir/util/aggregate-flags.js";
import { snake, upperFirst } from "../../../util/naming.js";

/** True when the aggregate's write seam probes at least one reference. */
export function hasAdmittedReferences(
  agg: AggregateIR,
  ctx: BoundedContextIR | undefined,
): boolean {
  return ctx !== undefined && admittedReferences(agg, ctx.aggregates).length > 0;
}

/** The pipe step that runs the probes on a changeset; empty when the
 *  aggregate admits no reference. */
export function refAdmissionPipe(agg: AggregateIR, ctx: BoundedContextIR | undefined): string {
  return hasAdmittedReferences(agg, ctx) ? "\n    |> __admit_references()" : "";
}

/** `foreign_key_constraint` steps for the operation seam's changeset, which
 *  carries none of its own: a reference the database itself rejects answers
 *  as a changeset error there too.  Empty when no reference is admitted. */
export function refConstraintPipe(agg: AggregateIR, ctx: BoundedContextIR | undefined): string {
  if (!ctx || !hasAdmittedReferences(agg, ctx)) return "";
  const table = aggregateTableName(agg, ctx.aggregates);
  return outboundReferenceFields(agg.fields, new Set(ctx.aggregates.map((a) => a.name)))
    .map(
      (f) =>
        `\n    |> Ecto.Changeset.foreign_key_constraint(:${snake(f.name)}, name: ${JSON.stringify(`${table}_${snake(f.name)}_fkey`)})`,
    )
    .join("");
}

/** The private functions the repository declares; empty when the aggregate
 *  admits no reference. */
export function refAdmissionHelpers(
  appModule: string,
  ctxModule: string,
  agg: AggregateIR,
  ctx: BoundedContextIR | undefined,
): string {
  if (!ctx) return "";
  const refs = admittedReferences(agg, ctx.aggregates);
  if (refs.length === 0) return "";
  const table = aggregateTableName(agg, ctx.aggregates);
  const calls = refs.map((r) => {
    const target = ctx.aggregates.find((a) => a.name === r.target)!;
    const schema = `${appModule}.${ctxModule}.${upperFirst(target.name)}`;
    const via = `[${r.via.map((s) => `:${snake(s.contain)}`).join(", ")}]`;
    // A part's reference is reported on the root's containment field, with the
    // part's own field as the path tail.
    const field = r.via.length === 0 ? snake(r.field) : snake(r.via[0]!.contain);
    const path = r.via.length === 0 ? "[]" : `[:${snake(r.field)}]`;
    const constraint = `${table}_${snake(r.field)}_fkey`;
    return `    |> __admit(:${field}, ${path}, ${JSON.stringify(constraint)}, ${schema}, __ref_values(record, ${via}, :${snake(r.field)}))`;
  });
  return `

  # Reference admission: each reference must be visible through the target's
  # own read scope under the ambient principal, or it is refused as a reference
  # to a row that does not exist.
  defp __admit_references(%Ecto.Changeset{valid?: false} = changeset), do: changeset

  defp __admit_references(changeset) do
    record = Ecto.Changeset.apply_changes(changeset)

    changeset
${calls.join("\n")}
  end

  defp __admit(changeset, field, path, constraint, schema, values) do
    ids = values |> Enum.reject(&is_nil/1) |> Enum.map(&String.downcase(to_string(&1))) |> Enum.uniq()

    if ids == [] or __admit_count(schema, ids) == length(ids) do
      changeset
    else
      opts = [constraint: :foreign, constraint_name: constraint]
      opts = if path == [], do: opts, else: opts ++ [loom_path: path]
      Ecto.Changeset.add_error(changeset, field, "does not exist", opts)
    end
  end

  defp __admit_count(schema, ids) do
    case Process.get(:loom_current_user) do
      nil ->
        0

      principal ->
        query = schema.base_query()
        Repo.aggregate(from(r in query, where: r.id in ^ids), :count, :id, current_user: principal)
    end
  end

  defp __ref_values(record, via, field) do
    via
    |> Enum.reduce([record], fn contain, owners ->
      Enum.flat_map(owners, &__contained(Map.get(&1, contain)))
    end)
    |> Enum.flat_map(&__held(Map.get(&1, field)))
  end

  defp __contained(list) when is_list(list), do: list
  defp __contained(%Ecto.Association.NotLoaded{}), do: []
  defp __contained(nil), do: []
  defp __contained(one), do: [one]

  defp __held(list) when is_list(list), do: Enum.map(list, &__ref_id/1)
  defp __held(%Ecto.Association.NotLoaded{}), do: []
  defp __held(nil), do: []
  defp __held(value), do: [value]

  defp __ref_id(%{id: id}), do: id
  defp __ref_id(id), do: id
`;
}
