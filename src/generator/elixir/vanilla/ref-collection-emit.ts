// ---------------------------------------------------------------------------
// Vanilla reference-collection (`X id[]`) support — the runtime side of the
// already-correct join-table migration.
//
// A `party: Pokemon id[]` field is NOT a stored `{:array, :binary_id}` column
// on the owner table (the migration emits no such column — only a
// `trainer_party` join table).  It is an Ecto `many_to_many` relationship
// through that join table, projected to the id-array wire field.
//
// This module owns the small structural query (`refCollFields`) plus the four
// runtime fragments the schema / changeset / repository / controller emitters
// each need so they stay in lockstep:
//   - the `many_to_many` schema line                       (schema-emit)
//   - the `Repo.preload([...])` read list                  (repository / context)
//   - the `put_assoc` create/update wiring                 (repository / context)
//   - the `serialize` id-array projection                  (api-emit)
//
// The IR already carries everything: each field lives in `agg.fields` as an
// `array`-of-`id`, and is mirrored in `agg.associations` (AssociationIR —
// joinTable / ownerFk / targetFk / targetAgg), populated by enrichment.  We're
// wiring the schema/runtime layer to the same metadata the join migration
// already consumes for DDL.
// ---------------------------------------------------------------------------

import type {
  AggregateIR,
  AssociationIR,
  EnrichedAggregateIR,
  ExprIR,
  FieldIR,
} from "../../../ir/types/loom-ir.js";
import { refCollectionFieldName } from "../../../ir/util/ref-collection.js";
import { snake, upperFirst } from "../../../util/naming.js";
import { ectoIdType } from "../dispatch-emit.js";

/** One reference-collection field paired with its enriched association. */
export interface RefCollField {
  field: FieldIR;
  assoc: AssociationIR;
}

/** Is this field an `X id[]` reference collection (array-of-id)? */
export function isRefCollField(f: { type: { kind: string; element?: { kind: string } } }): boolean {
  return f.type.kind === "array" && f.type.element?.kind === "id";
}

/** The aggregate's reference-collection fields, each paired with the
 *  AssociationIR enrichment derived for it.  A field without a matching
 *  association (shouldn't happen — enrichment derives one per array-of-id
 *  field) is skipped. */
export function refCollFields(agg: AggregateIR): RefCollField[] {
  const associations = (agg as EnrichedAggregateIR).associations ?? [];
  const out: RefCollField[] = [];
  for (const f of agg.fields) {
    if (!isRefCollField(f)) continue;
    const assoc = associations.find((a) => a.fieldName === f.name);
    if (assoc) out.push({ field: f, assoc });
  }
  return out;
}

/** The set of ref-collection field names (snake) — used by emitters to drop
 *  these fields from plain `field`/`cast`/`validate_required` handling. */
export function refCollFieldNames(agg: AggregateIR): Set<string> {
  return new Set(refCollFields(agg).map((rc) => snake(rc.field.name)));
}

/** Is `<fieldSnake>` (a snake-cased field name) a reference collection on
 *  `agg`?  Used by the named-operation body renderer to route `party += x` /
 *  `party -= x` writes to id-list normalisation + `put_assoc`. */
export function isRefCollFieldName(agg: AggregateIR, fieldSnake: string): boolean {
  return refCollFieldNames(agg).has(fieldSnake);
}

/** The `put_assoc` value a named-op persist tail writes for a mutated
 *  ref-collection field (snake name) whose body left the new id list in the
 *  local `<field>`, or null if the field isn't a reference collection.  A
 *  same-context target resolves the ids back to target structs
 *  (`__resolve_refs`); a FOREIGN target builds its id rows (`<Row>.rows/2`). */
export function refCollPutAssocValue(
  appModule: string,
  ctxModule: string,
  agg: AggregateIR,
  fieldSnake: string,
  pool: readonly { name: string }[],
): string | null {
  const rc = refCollFields(agg).find((r) => snake(r.field.name) === fieldSnake);
  if (!rc) return null;
  return isForeignRefColl(rc, pool)
    ? `${refRowModule(appModule, ctxModule, rc)}.rows(record.id, ${fieldSnake})`
    : `__resolve_refs(${fieldSnake}, ${targetModule(appModule, ctxModule, rc.assoc)})`;
}

/** Does this reference collection target an aggregate that is NOT a schema of
 *  the owner's own bounded context?  The target then has no Ecto schema module
 *  the owner can associate with — it lives in a sibling context, possibly one
 *  this deployable does not host at all (its table is then in another
 *  service's database).  Such a collection is what every other backend already
 *  stores: the raw target ids in the join table, with no association to the
 *  target entity.  Derived from the pool on demand — never stamped. */
export function isForeignRefColl(rc: RefCollField, pool: readonly { name: string }[]): boolean {
  return !pool.some((a) => a.name === rc.assoc.targetAgg);
}

/** The aggregate's reference collections whose target is a FOREIGN aggregate
 *  (see `isForeignRefColl`). */
export function foreignRefCollFields(
  agg: AggregateIR,
  pool: readonly { name: string }[],
): RefCollField[] {
  return refCollFields(agg).filter((rc) => isForeignRefColl(rc, pool));
}

/** Does the aggregate have a reference collection over a same-context target
 *  (the `many_to_many` shape)? */
export function hasLocalRefColls(agg: AggregateIR, pool: readonly { name: string }[]): boolean {
  return refCollFields(agg).some((rc) => !isForeignRefColl(rc, pool));
}

/** The join-row schema module for a FOREIGN ref collection — the join table
 *  name pascal-cased under the owner's context (`clm_others` →
 *  `App.Claims.ClmOthers`), the same naming the value-collection child schema
 *  uses for its `<owner>_<field>` table. */
function refRowModule(appModule: string, ctxModule: string, rc: RefCollField): string {
  return `${appModule}.${ctxModule}.${rc.assoc.joinTable.split("_").map(upperFirst).join("")}`;
}

/** The owner schema's relationship line for one ref-collection field — the
 *  `many_to_many` onto a same-context target, or (FOREIGN target) a `has_many`
 *  onto the join-row schema, whose `id` IS the target id. */
export function refCollRelationLine(
  appModule: string,
  ctxModule: string,
  rc: RefCollField,
  pool: readonly { name: string }[],
): string {
  if (!isForeignRefColl(rc, pool)) return manyToManyLine(appModule, ctxModule, rc);
  const rel = snake(rc.field.name);
  const row = refRowModule(appModule, ctxModule, rc);
  return `    has_many :${rel}, ${row}, foreign_key: :${rc.assoc.ownerFk}, on_replace: :delete, preload_order: [asc: :id]`;
}

/** The join-row schema for a FOREIGN ref collection: one row of the join table
 *  the shared migration already creates (`<owner>_id` + `<target>_id`, both
 *  primary key, plus timestamps).  The target column is exposed as `:id`, so a
 *  preloaded row reads exactly like a preloaded target struct to every
 *  id-projecting helper (`__ref_ids/1`, `__ref_id_list/1`, a `contains` find's
 *  `t.id == ^p`).  Both columns are the primary key, so `on_replace: :delete`
 *  removes exactly the dropped `(owner, target)` pair.  `rows/2` builds the
 *  `put_assoc` value for an id list — keyed by the owner id so an unchanged id
 *  matches its existing row (nil on insert, where Ecto sets the FK itself). */
export function renderRefRowSchema(
  appModule: string,
  ctxModule: string,
  rc: RefCollField,
  schemaPrefix: string | undefined,
): string {
  const row = refRowModule(appModule, ctxModule, rc);
  const prefixLine = schemaPrefix ? `  @schema_prefix ${JSON.stringify(schemaPrefix)}\n` : "";
  return `# Auto-generated.
defmodule ${row} do
  @moduledoc false
  # One \`${rc.assoc.joinTable}\` row of \`${rc.assoc.ownerAgg}.${rc.field.name}: ${rc.assoc.targetAgg} id[]\`.
  # \`${rc.assoc.targetAgg}\` has no schema in this context, so the collection holds the
  # raw target ids — the join table is the whole representation.
  use Ecto.Schema

  @primary_key false
${prefixLine}
  schema ${JSON.stringify(rc.assoc.joinTable)} do
    field :${rc.assoc.ownerFk}, :binary_id, primary_key: true
    field :id, ${ectoIdType(rc.assoc.valueType)}, primary_key: true, source: :${rc.assoc.targetFk}
    timestamps()
  end

  @doc false
  def rows(owner_id, ids) do
    ids
    |> List.wrap()
    |> Enum.uniq()
    |> Enum.map(&%{${rc.assoc.ownerFk}: owner_id, id: &1})
  end
end
`;
}

/** The fully-qualified Elixir module for the referenced aggregate, e.g.
 *  `Api.Roster.Pokemon` — a target in the owner's OWN bounded context (a
 *  foreign target takes the join-row path instead; see `isForeignRefColl`). */
function targetModule(appModule: string, ctxModule: string, assoc: AssociationIR): string {
  return `${appModule}.${ctxModule}.${upperFirst(assoc.targetAgg)}`;
}

/** The `many_to_many` schema line for one ref-collection field — a plain
 *  Ecto join_through with explicit
 *  join_keys and `on_replace: :delete` so a `put_assoc` REPLACES the prior set
 *  (set semantics for `Id<T>[]`).
 *
 *  `preload_order: [asc: :id]` makes the preloaded list deterministic by
 *  ordering on the TARGET row's `:id` — the same read-time projection every
 *  other backend applies (ORDER BY the target FK id).  `Id<T>[]` is a set
 *  (membership only, no order), so the join table stores no `ordinal`; the
 *  stable read-back is derived from the target id, not stored state.
 *
 *  `join_through:` is the BARE table name even when the owner lives in a
 *  non-public Postgres schema: Ecto applies the owner schema's `@schema_prefix`
 *  to a string join_through at query time, so qualifying it here would
 *  DOUBLE-prefix the insert (`"pokedex"."pokedex.trainer_party"` → undefined
 *  table).  The join table always lives in the owner's schema (the migration
 *  creates it with the owner context's prefix), so inherited qualification is
 *  exactly right. */
export function manyToManyLine(appModule: string, ctxModule: string, rc: RefCollField): string {
  const rel = snake(rc.field.name);
  const target = targetModule(appModule, ctxModule, rc.assoc);
  const through = JSON.stringify(rc.assoc.joinTable);
  return `    many_to_many :${rel}, ${target}, join_through: ${through}, join_keys: [${rc.assoc.ownerFk}: :id, ${rc.assoc.targetFk}: :id], on_replace: :delete, preload_order: [asc: :id]`;
}

/** The preload list for an aggregate's reads — `[:party, :caught]` — so every
 *  loaded record carries the relationship structs the serializer projects to
 *  ids.  Empty when the aggregate has no reference collections. */
export function preloadList(agg: AggregateIR): string[] {
  return refCollFields(agg).map((rc) => `:${snake(rc.field.name)}`);
}

/** Does the aggregate have any reference-collection fields? */
export function hasRefColls(agg: AggregateIR): boolean {
  return refCollFields(agg).length > 0;
}

/** If a find's filter is exactly `this.<refColl>.contains(arg)` over an
 *  `X id[]` field of `agg`, return the field name; else null.  The argument is
 *  always the find's first parameter (the validator only admits the membership
 *  form with a single id arg), so the caller binds `^<param>` directly. */
export function containsRefCollField(filter: ExprIR | undefined, agg: AggregateIR): string | null {
  if (filter?.kind !== "method-call") return null;
  if (filter.member !== "contains") return null;
  if (filter.receiverType.kind !== "array" || filter.receiverType.element.kind !== "id") {
    return null;
  }
  const fieldName = refCollectionFieldName(filter.receiver);
  if (!fieldName) return null;
  // Confirm it's a known reference collection on this aggregate.
  return refCollFields(agg).some((rc) => rc.field.name === fieldName) ? fieldName : null;
}

/** A `Repo.preload([...])` suffix for a read body, or `""` when the aggregate
 *  has no reference collections (keeps non-refcoll repos byte-identical).  Wraps
 *  a `Repo.all(...)` / `Repo.get(...)` result so every loaded record carries the
 *  relationship structs the serializer projects to ids. */
export function preloadSuffix(agg: AggregateIR): string {
  const list = preloadList(agg);
  return list.length > 0 ? ` |> Repo.preload([${list.join(", ")}])` : "";
}

/** Pipe lines that wire each ref-collection into a changeset via `put_assoc`,
 *  resolving the incoming `attrs["party"]` id list to target structs first.
 *  Appended after `base_changeset(attrs)` on the insert/update path.  Returns
 *  `[]` when the aggregate has no reference collections. */
export function putAssocLines(
  appModule: string,
  ctxModule: string,
  agg: AggregateIR,
  indent: string,
  pool: readonly { name: string }[],
): string[] {
  return refCollFields(agg).map((rc) => {
    const name = snake(rc.field.name);
    // A FOREIGN target has no schema to resolve ids against — its join-row
    // schema builds the rows straight from the ids (`isForeignRefColl`).
    if (isForeignRefColl(rc, pool)) {
      const row = refRowModule(appModule, ctxModule, rc);
      return `${indent}|> __put_ref_ids(:${name}, ${JSON.stringify(name)}, attrs, ${row})`;
    }
    const target = targetModule(appModule, ctxModule, rc.assoc);
    return `${indent}|> __put_ref_coll(:${name}, ${JSON.stringify(name)}, attrs, ${target})`;
  });
}

/** The shared private helpers a repository emits when it has ref collections:
 *  `__put_ref_coll/4` (resolve an id list to target structs, then `put_assoc`)
 *  and `__ref_ids/1` is on the controller, not here.  Only emitted when used,
 *  so it never sits unused under `--warnings-as-errors`. */
export function refCollRepoHelpers(
  appModule: string,
  uses: { local: boolean; foreign: boolean } = { local: true, foreign: false },
): string {
  const putRefColl = uses.local ? refCollPutHelper(appModule) : "";
  const putRefIds = uses.foreign
    ? `
  # Write a FOREIGN reference collection (its target has no schema in this
  # context): the incoming id list becomes the join rows themselves, built by
  # the join-row schema's \`rows/2\` and \`put_assoc\`ed like any \`has_many\`.
  # Same absent/empty semantics as a same-context collection.
  defp __put_ref_ids(changeset, field, key, attrs, row_mod) do
    case __fetch_ref(attrs, key) do
      :absent ->
        changeset

      {:ok, ids} ->
        Ecto.Changeset.put_assoc(changeset, field, row_mod.rows(changeset.data.id, ids))
    end
  end
`
    : "";
  return `${putRefColl}${putRefIds}${FETCH_REF_HELPER}`;
}

const FETCH_REF_HELPER = `
  defp __fetch_ref(attrs, key) do
    cond do
      Map.has_key?(attrs, key) -> {:ok, Map.get(attrs, key) || []}
      Map.has_key?(attrs, String.to_atom(key)) -> {:ok, Map.get(attrs, String.to_atom(key)) || []}
      true -> :absent
    end
  end`;

function refCollPutHelper(appModule: string): string {
  return `
  # Resolve a reference-collection id list (\`attrs[key]\`) to target structs and
  # \`put_assoc\` them onto the changeset.  A missing/blank key leaves the existing
  # association untouched (so a partial update doesn't clear it); an empty list
  # explicitly clears it.  \`on_replace: :delete\` on the schema makes put_assoc
  # rewrite the join rows.
  defp __put_ref_coll(changeset, field, key, attrs, target_mod) do
    case __fetch_ref(attrs, key) do
      :absent ->
        changeset

      {:ok, ids} ->
        ids = ids |> List.wrap() |> Enum.map(&to_string/1)
        targets = ${appModule}.Repo.all(from(t in target_mod, where: t.id in ^ids))
        Ecto.Changeset.put_assoc(changeset, field, targets)
    end
  end
`;
}
