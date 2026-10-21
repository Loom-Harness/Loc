import type { EnumIR, TypeIR, ValueObjectIR } from "../../../ir/types/loom-ir.js";
import { snake } from "../../../util/naming.js";
import { LOOM_DATETIME_MODULE } from "./datetime-type-emit.js";

// ---------------------------------------------------------------------------
// The Phoenix backend's single-value-object column type, and value-object
// equality.
//
// A single value object (`berth: Berth`) is one jsonb column.  Typed as a bare
// `:map`, every path that produced it handed back a DIFFERENT term for the same
// value:
//
//   * built in domain code    → `%{pier: "A", side: :Port, fee: Decimal}`  (atom keys)
//   * cast from a wire body   → `%{"pier" => "A", "side" => "Port", "fee" => 12.5}`
//   * loaded from the row     → `%{"pier" => "A", "side" => "Port", "fee" => "12.50"}`
//
// so `record.berth == Berth { … }` was false for every loaded or posted
// aggregate, a `record.berth.side == Port` compared a string to an atom, and a
// decimal field came back as a float or a string.  `Loom.ValueObject` is an
// `Ecto.ParameterizedType` whose `cast` and `load` both produce the shape the
// constructor builds — snake ATOM keys, exactly the declared fields, enum
// values as their declared-case atoms, decimals as `%Decimal{}`, datetimes
// through `Loom.Datetime`, nested value objects recursively — so a loaded, a
// posted and a constructed value are one representation.  The column stays
// jsonb (`type/1` is `:map`), so the migration and the stored document are
// unchanged; a row an older build wrote (string keys, camelCase keys, numbers
// for decimals) loads into the same canonical shape.
//
// Cast is deliberately LENIENT per field: a sub-value that does not cast
// (`"abc"` for an int) is kept as given rather than failing the whole column,
// so the value object's own validating constructor (`validate_vo`) still
// reports it against the inner field — the error path the wire contract
// carries (`/berth/position`), not a flat `/berth is invalid`.
//
// Equality cannot rest on the column alone: a value-object COLLECTION element
// is a child-table Ecto struct, and two equal decimals may differ in scale
// (`12.5` vs `12.50`).  `Loom.ValueObject.equal?/2` compares two values
// key-agnostically — struct bookkeeping (meta, synthetic id, parent FK,
// ordinal) dropped, keys stringified, numbers compared numerically, enum atoms
// as their names, absent and nil fields alike — and every VO `==` / `!=` the
// expression renderers emit routes through it.
//
// Fixed `Loom.` namespace, app-independent, like `Loom.Datetime`: every
// type-mapping site and every renderer names it without the app module.
// ---------------------------------------------------------------------------

/** The fixed module single-VO columns are typed as and VO equality calls. */
export const LOOM_VALUE_OBJECT_MODULE = "Loom.ValueObject";

/** `Loom.ValueObject.equal?(l, r)` (or its negation for `!=`). */
export function renderValueObjectEquality(op: "==" | "!=", l: string, r: string): string {
  const call = `${LOOM_VALUE_OBJECT_MODULE}.equal?(${l}, ${r})`;
  return op === "==" ? call : `not ${call}`;
}

/** True iff `t` is a value object, optional or not. */
export function isValueObjectType(t: TypeIR | undefined): boolean {
  if (!t) return false;
  if (t.kind === "optional") return isValueObjectType(t.inner);
  return t.kind === "valueobject";
}

/** The `field :<name>, <here>` text for a single value-object column —
 *  `Loom.ValueObject, fields: [...]` — or `null` when the value object is not
 *  in `vos` (the caller keeps the plain `:map`). */
export function valueObjectColumnType(
  voName: string,
  vos: ReadonlyMap<string, ValueObjectIR>,
  enums: ReadonlyMap<string, EnumIR>,
): string | null {
  const spec = voFieldsSpec(voName, vos, enums, new Set());
  return spec === null ? null : `${LOOM_VALUE_OBJECT_MODULE}, fields: ${spec}`;
}

/** The `[{:key, "wireKey", type}, …]` spec for one value object, nested value
 *  objects inlined as `{:value_object, [...]}`.  `null` for an unknown name or
 *  a (validator-rejected) self-containing cycle. */
function voFieldsSpec(
  voName: string,
  vos: ReadonlyMap<string, ValueObjectIR>,
  enums: ReadonlyMap<string, EnumIR>,
  stack: ReadonlySet<string>,
): string | null {
  const vo = vos.get(voName);
  if (!vo || stack.has(voName)) return null;
  const inner = new Set([...stack, voName]);
  const entries = vo.fields.map(
    (f) =>
      `{:${snake(f.name)}, ${JSON.stringify(f.name)}, ${fieldSpec(f.type, vos, enums, inner)}}`,
  );
  return `[${entries.join(", ")}]`;
}

/** One field's type term inside the spec.  Leaves are the Ecto type the
 *  aggregate's own column of that type uses; enums carry their declared
 *  values; anything unmapped is `:any` (kept as loaded). */
function fieldSpec(
  t: TypeIR,
  vos: ReadonlyMap<string, ValueObjectIR>,
  enums: ReadonlyMap<string, EnumIR>,
  stack: ReadonlySet<string>,
): string {
  switch (t.kind) {
    case "optional":
      return fieldSpec(t.inner, vos, enums, stack);
    case "array":
      return `{:array, ${fieldSpec(t.element, vos, enums, stack)}}`;
    case "valueobject": {
      const nested = voFieldsSpec(t.name, vos, enums, stack);
      return nested === null ? ":any" : `{:value_object, ${nested}}`;
    }
    case "enum": {
      const en = enums.get(t.name);
      return en ? `{:enum, [${en.values.map((v) => `:${v}`).join(", ")}]}` : ":string";
    }
    case "id":
      return ":binary_id";
    case "primitive":
      switch (t.name) {
        case "int":
        case "long":
          return ":integer";
        case "decimal":
        case "money":
          return ":decimal";
        case "bool":
          return ":boolean";
        case "datetime":
          return LOOM_DATETIME_MODULE;
        case "guid":
          return "Ecto.UUID";
        case "string":
          return ":string";
        default:
          return ":any";
      }
    default:
      return ":any";
  }
}

/** `lib/<app>/loom_value_object.ex`. */
export function renderLoomValueObjectModule(): string {
  return `# Auto-generated.
defmodule ${LOOM_VALUE_OBJECT_MODULE} do
  @moduledoc """
  The single value-object column type, and value-object equality.

  \`cast/2\` and \`load/3\` both return the shape the value-object constructor
  builds — snake atom keys, exactly the declared fields, enum values as
  declared-case atoms, decimals as \`%Decimal{}\` — so a value loaded from the
  jsonb column, one cast from a request and one built in domain code are the
  same term.  Stored as jsonb (\`type/1\` is \`:map\`).

  \`equal?/2\` is value-object equality across every runtime shape a value
  object takes (a collection element is an Ecto struct; decimals compare by
  value, not scale).
  """
  use Ecto.ParameterizedType

  @impl true
  def type(_fields), do: :map

  @impl true
  def init(opts), do: Keyword.fetch!(opts, :fields)

  @impl true
  def cast(nil, _fields), do: {:ok, nil}
  def cast(value, fields) when is_map(value), do: {:ok, canonical(value, fields)}
  def cast(_value, _fields), do: :error

  @impl true
  def load(nil, _loader, _fields), do: {:ok, nil}
  def load(value, _loader, fields) when is_map(value), do: {:ok, canonical(value, fields)}
  def load(_value, _loader, _fields), do: :error

  @impl true
  def dump(nil, _dumper, _fields), do: {:ok, nil}
  def dump(value, _dumper, fields) when is_map(value), do: {:ok, canonical(value, fields)}
  def dump(_value, _dumper, _fields), do: :error

  @impl true
  def equal?(a, b, _fields), do: equal?(a, b)

  @doc "The canonical (constructor) shape of a value-object map or struct."
  def canonical(%{__struct__: _} = struct, fields), do: canonical(Map.from_struct(struct), fields)

  def canonical(value, fields) when is_map(value) do
    Map.new(fields, fn {key, wire, type} -> {key, coerce(type, fetch(value, key, wire))} end)
  end

  defp fetch(value, key, wire) do
    case Map.fetch(value, key) do
      {:ok, v} ->
        v

      :error ->
        case Map.fetch(value, Atom.to_string(key)) do
          {:ok, v} -> v
          :error -> Map.get(value, wire)
        end
    end
  end

  defp coerce(_type, nil), do: nil
  defp coerce(:any, value), do: value

  defp coerce({:value_object, fields}, value) when is_map(value) and not is_struct(value),
    do: canonical(value, fields)

  defp coerce({:enum, values}, value) when is_binary(value),
    do: Enum.find(values, value, &(Atom.to_string(&1) == value))

  defp coerce({:array, type}, value) when is_list(value), do: Enum.map(value, &coerce(type, &1))

  defp coerce(type, value) when is_atom(type) do
    case Ecto.Type.cast(type, value) do
      {:ok, cast} -> cast
      _ -> value
    end
  end

  defp coerce(_type, value), do: value

  @doc "Value-object equality — key-agnostic, scale-agnostic, nil-safe."
  def equal?(a, b), do: comparable(a) == comparable(b)

  defp comparable(nil), do: nil
  defp comparable(%Decimal{} = d), do: Decimal.normalize(d)
  defp comparable(%DateTime{} = dt), do: DateTime.to_unix(dt, :microsecond)
  defp comparable(n) when is_integer(n), do: Decimal.new(n)
  defp comparable(n) when is_float(n), do: Decimal.normalize(Decimal.from_float(n))
  defp comparable(a) when is_atom(a) and not is_boolean(a), do: Atom.to_string(a)
  defp comparable(list) when is_list(list), do: Enum.map(list, &comparable/1)

  defp comparable(%{__meta__: %Ecto.Schema.Metadata{}, __struct__: schema} = row) do
    bookkeeping =
      [:__meta__, :ordinal | schema.__schema__(:primary_key)] ++
        Enum.flat_map(schema.__schema__(:associations), fn assoc ->
          [assoc, schema.__schema__(:association, assoc).owner_key]
        end)

    row |> Map.from_struct() |> Map.drop(bookkeeping) |> comparable()
  end

  defp comparable(%{__struct__: _} = other), do: other

  defp comparable(map) when is_map(map) do
    for {k, v} <- map, v != nil, into: %{}, do: {to_string(k), comparable(v)}
  end

  defp comparable(other), do: other
end
`;
}
