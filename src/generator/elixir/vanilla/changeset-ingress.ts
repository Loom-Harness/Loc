// ---------------------------------------------------------------------------
// Wire-ingress guards for the vanilla aggregate changeset — the create/update
// twin of the operation-param guards in `context-emit.ts`.
//
// Two value classes reach `base_changeset/2` / `update_changeset/2` straight
// off the decoded request body, and Ecto's defaults answer both differently
// from every other backend:
//
//   * a DECIMAL (`money` / `decimal`).  A top-level column is cast by Ecto,
//     which answers a malformed `"1.2.3"` with its own "is invalid"; a leaf
//     INSIDE a value object is not cast at all (the value object is one jsonb
//     `:map` column), so the malformed string was stored verbatim.  Node's
//     `moneySchema` refuses both with `Invalid decimal: "1.2.3"` at the leaf's
//     pointer (`/price`, `/best/price`), and so does the op-param guard.
//     `__loom_decimal_ingress/3` applies node's grammar (`^-?\d+(\.\d+)?$`,
//     character for character) to every such path and answers node's text;
//     a top-level column's Ecto cast error is replaced, not doubled.
//
//   * a STRING.  Ecto's `cast/3` turns `""` (and, through
//     `empty_trimmed_string?`, `"   "`) into `nil`, and `validate_required/2`
//     treats a blank string as missing — so a blank name answered "can't be
//     blank" before the rule that owns blankness (`check name.length > 0
//     message "Name is required"`, an `invariant name.trim().length > 0`) ever
//     ran.  Node keeps the string and lets the rule answer.  String columns are
//     therefore cast with `empty_values: []` and their presence is nil-only.
//
// A blank optional top-level decimal stays absent: a LiveView form posts an
// empty input as `""`, and Ecto's empty-value handling is what turns that into
// "no value" for a field the contract lets the caller omit.
// ---------------------------------------------------------------------------

import type { FieldIR, TypeIR, ValueObjectIR } from "../../../ir/types/loom-ir.js";
import { snake } from "../../../util/naming.js";

/** One decimal leaf the ingress guard checks: its snake-cased path from the
 *  aggregate root, and whether a blank value means "absent" (only a top-level
 *  optional column — a value-object leaf is stored verbatim, so a blank one
 *  would persist as `""`). */
export interface DecimalIngressPath {
  readonly path: readonly string[];
  readonly blankIsAbsent: boolean;
}

function unwrapOptional(t: TypeIR): TypeIR {
  return t.kind === "optional" ? t.inner : t;
}

function isDecimalType(t: TypeIR): boolean {
  const inner = unwrapOptional(t);
  return inner.kind === "primitive" && (inner.name === "money" || inner.name === "decimal");
}

/** True for a plain `string` field (optional or not) — the columns cast with
 *  `empty_values: []` and checked for nil-only presence. */
export function isStringField(f: FieldIR): boolean {
  const inner = unwrapOptional(f.type);
  return inner.kind === "primitive" && inner.name === "string";
}

/** Every decimal leaf under the cast `fields`: the top-level money/decimal
 *  columns, and each money/decimal leaf of a single value-object field, nested
 *  value objects included.  A value-object COLLECTION is a `cast_assoc` child
 *  with its own changeset, so it is not walked here. */
export function decimalIngressPaths(
  fields: readonly FieldIR[],
  valueObjects: readonly ValueObjectIR[],
): DecimalIngressPath[] {
  const byName = new Map<string, ValueObjectIR>();
  for (const vo of valueObjects) if (!byName.has(vo.name)) byName.set(vo.name, vo);
  const out: DecimalIngressPath[] = [];
  const walkVo = (voName: string, prefix: readonly string[], seen: ReadonlySet<string>): void => {
    const vo = byName.get(voName);
    if (!vo || seen.has(voName)) return;
    const next = new Set(seen).add(voName);
    for (const leaf of vo.fields) {
      const path = [...prefix, snake(leaf.name)];
      if (isDecimalType(leaf.type)) {
        out.push({ path, blankIsAbsent: false });
        continue;
      }
      const inner = unwrapOptional(leaf.type);
      if (inner.kind === "valueobject") walkVo(inner.name, path, next);
    }
  };
  for (const f of fields) {
    if (isDecimalType(f.type)) {
      out.push({ path: [snake(f.name)], blankIsAbsent: f.optional || f.type.kind === "optional" });
      continue;
    }
    const inner = unwrapOptional(f.type);
    if (inner.kind === "valueobject") walkVo(inner.name, [snake(f.name)], new Set());
  }
  return out;
}

/** The Elixir literal for a path list — `[{[:best, :price], false}, …]`. */
export function renderDecimalIngressList(paths: readonly DecimalIngressPath[]): string {
  return `[${paths
    .map((p) => `{[${p.path.map((s) => `:${s}`).join(", ")}], ${p.blankIsAbsent}}`)
    .join(", ")}]`;
}

/** The `defp`s behind `|> __loom_decimal_ingress(attrs, <paths>)`.  Emitted
 *  only when some path exists, so an aggregate without a decimal leaf is
 *  byte-identical. */
export function renderDecimalIngressHelpers(): string {
  return `

  # A decimal reaching the changeset from the wire must match node's grammar
  # (\`^-?\\d+(\\.\\d+)?$\`) or be a JSON number; anything else is refused with
  # node's text at the LEAF's pointer — \`/price\`, \`/best/price\` — never Ecto's
  # "is invalid", and never stored verbatim inside a value object's jsonb map.
  # A top-level column's own cast error is replaced so the field carries one
  # error, not two.
  defp __loom_decimal_ingress(changeset, attrs, paths) do
    Enum.reduce(paths, changeset, fn {[field | rest] = path, blank_is_absent}, cs ->
      with {:ok, value} <- __loom_dig(attrs, path),
           false <- __loom_decimal_ok?(value, blank_is_absent) do
        errors =
          if rest == [],
            do: Enum.reject(cs.errors, fn {f, {_msg, opts}} -> f == field and opts[:validation] == :cast end),
            else: cs.errors

        %{cs | errors: errors}
        |> add_error(field, "Invalid decimal: " <> Jason.encode!(value), loom_path: rest)
      else
        _ -> cs
      end
    end)
  end

  defp __loom_decimal_ok?(nil, _blank_is_absent), do: true
  defp __loom_decimal_ok?(%Decimal{}, _blank_is_absent), do: true
  defp __loom_decimal_ok?(value, _blank_is_absent) when is_integer(value) or is_float(value), do: true

  defp __loom_decimal_ok?(value, blank_is_absent) when is_binary(value) do
    Regex.match?(~r/^-?\\d+(\\.\\d+)?$/, value) or (blank_is_absent and String.trim(value) == "")
  end

  defp __loom_decimal_ok?(_value, _blank_is_absent), do: false

  # The raw value at a snake-cased path.  The top-level keys are already
  # snake-cased; a nested value object's may still be camelCase, so each key is
  # compared in its snake form.
  defp __loom_dig(value, []), do: {:ok, value}

  defp __loom_dig(map, [segment | rest]) when is_map(map) and not is_struct(map) do
    key = Atom.to_string(segment)

    case Enum.find(map, fn {k, _v} -> k == segment or (is_binary(k) and Macro.underscore(k) == key) end) do
      {_k, v} -> __loom_dig(v, rest)
      nil -> :error
    end
  end

  defp __loom_dig(_value, _path), do: :error`;
}

/** The nil-only presence check that stands in for \`validate_required/2\` on
 *  string columns cast with \`empty_values: []\`. */
export function renderRequirePresentHelper(): string {
  return `

  # A string column is cast with \`empty_values: []\`, so a blank value stays a
  # string and reaches the rule that owns it (a \`check\` / \`invariant\` with its
  # authored message).  \`validate_required/2\` would call that same blank value
  # missing, so presence here is nil-only.  A field that already carries an
  # error (a cast failure) is not reported twice — \`validate_required/2\`'s rule.
  defp __require_present(changeset, fields) do
    Enum.reduce(fields, changeset, fn field, cs ->
      if is_nil(get_field(cs, field)) and not Keyword.has_key?(cs.errors, field),
        do: add_error(cs, field, "can't be blank", validation: :required),
        else: cs
    end)
  end`;
}
