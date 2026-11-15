// ---------------------------------------------------------------------------
// `<App>.Records` — the one place a table-backed schema is read or written.
//
// The relational schema is the ONE schema `MigrationsIR` derives
// (D-ONE-SCHEMA): a value object is its prefix-named leaf columns
// (`price_amount`, `price_currency`, a nested value object prefix-chained).  An
// Ecto schema declares those leaf columns as its real fields and carries the
// value object itself as a VIRTUAL field of the same name it always had
// (`schema-emit.ts`, `vo-columns-ex.ts`), so domain code, the expression
// renderer and every serializer keep reading `record.price` as one value.
//
// Ecto has no load hook and does not let a Repo override `all`/`get`/`one`/
// `preload` (only `default_options/1`, `prepare_query/3` and
// `prepare_transaction/2` are overridable), so the virtual field is filled
// here: every emitted read goes through this module, which calls the Repo and
// composes each loaded struct from its leaf columns, recursing into every
// loaded association (parts, value-collection rows).  Every emitted write goes
// through it too, which turns a change to a virtual value-object field into
// the changes to its leaf columns, recursing into nested association
// changesets.  `test/system/elixir-records-seam-census.test.ts` forbids a raw
// `Repo.<read>` / `Repo.<write>` in the elixir emitters outside this module.
//
// Composition reads each schema's `__value_columns__/0` (emitted only by a
// schema with a stored value object): `[{field, node}]`, where a node is
// `{optional?, [entry]}` and an entry is a leaf `{key, column, required?}` or a
// nested value object `{key, node}`.  An optional node is absent when its
// required leaves are all NULL (when it has none, when every leaf is) — the
// rule the shared null-consistency CHECKs make exact.  A virtual field that is
// already set is kept: a fresh row never has one, and a struct already in
// memory (preloaded later) keeps the value its code holds.  For the same
// reason a write decomposes a struct's virtual field only when it is set; a
// cleared optional value object reaches the leaves as a CHANGE to nil.
// ---------------------------------------------------------------------------

/** The fully-qualified seam module. */
export function recordsModule(appModule: string): string {
  return `${appModule}.Records`;
}

/** `lib/<app>/records.ex`. */
export function renderRecordsModule(appModule: string): string {
  return `# Auto-generated.
defmodule ${recordsModule(appModule)} do
  @moduledoc """
  Every read and write of a table-backed schema.  A stored value object is its
  leaf columns; the schema carries it as a virtual field, composed here on
  every read and decomposed here on every write.
  """
  alias ${appModule}.Repo

  def all(queryable, opts \\\\ []), do: queryable |> Repo.all(opts) |> compose()
  def one(queryable, opts \\\\ []), do: queryable |> Repo.one(opts) |> compose()
  def one!(queryable, opts \\\\ []), do: queryable |> Repo.one!(opts) |> compose()
  def get(queryable, id, opts \\\\ []), do: queryable |> Repo.get(id, opts) |> compose()
  def get!(queryable, id, opts \\\\ []), do: queryable |> Repo.get!(id, opts) |> compose()

  def get_by(queryable, clauses, opts \\\\ []),
    do: queryable |> Repo.get_by(clauses, opts) |> compose()

  def get_by!(queryable, clauses, opts \\\\ []),
    do: queryable |> Repo.get_by!(clauses, opts) |> compose()

  def preload(structs, preloads, opts \\\\ []),
    do: structs |> Repo.preload(preloads, opts) |> compose()

  def insert(changeset, opts \\\\ []), do: changeset |> decompose() |> Repo.insert(opts)
  def insert!(changeset, opts \\\\ []), do: changeset |> decompose() |> Repo.insert!(opts)
  def update(changeset, opts \\\\ []), do: changeset |> decompose() |> Repo.update(opts)
  def update!(changeset, opts \\\\ []), do: changeset |> decompose() |> Repo.update!(opts)

  def insert_or_update(changeset, opts \\\\ []),
    do: changeset |> decompose() |> Repo.insert_or_update(opts)

  def insert_or_update!(changeset, opts \\\\ []),
    do: changeset |> decompose() |> Repo.insert_or_update!(opts)

  @doc "Fill every virtual value-object field of a loaded result from its leaf columns."
  def compose(list) when is_list(list), do: Enum.map(list, &compose/1)
  def compose(tuple) when is_tuple(tuple), do: tuple |> Tuple.to_list() |> compose() |> List.to_tuple()

  def compose(%{__meta__: %Ecto.Schema.Metadata{}, __struct__: schema} = struct) do
    struct
    |> compose_values(schema)
    |> compose_associations(schema)
  end

  def compose(%{__struct__: _} = struct), do: struct
  def compose(map) when is_map(map), do: Map.new(map, fn {k, v} -> {k, compose(v)} end)
  def compose(other), do: other

  defp compose_values(struct, schema) do
    if function_exported?(schema, :__value_columns__, 0) do
      Enum.reduce(schema.__value_columns__(), struct, fn {field, node}, acc ->
        if is_nil(Map.get(acc, field)), do: Map.put(acc, field, compose_node(acc, node)), else: acc
      end)
    else
      struct
    end
  end

  defp compose_associations(struct, schema) do
    Enum.reduce(schema.__schema__(:associations), struct, fn assoc, acc ->
      case Map.get(acc, assoc) do
        %Ecto.Association.NotLoaded{} -> acc
        loaded -> Map.put(acc, assoc, compose(loaded))
      end
    end)
  end

  defp compose_node(row, {optional, entries} = node) do
    if optional and not present?(row, node) do
      nil
    else
      Map.new(entries, fn
        {key, column, _required} -> {key, Map.get(row, column)}
        {key, inner} -> {key, compose_node(row, inner)}
      end)
    end
  end

  defp present?(row, node) do
    columns =
      case required_columns(node) do
        [] -> all_columns(node)
        required -> required
      end

    Enum.any?(columns, &(not is_nil(Map.get(row, &1))))
  end

  defp required_columns({_optional, entries}) do
    Enum.flat_map(entries, fn
      {_key, column, true} -> [column]
      {_key, _column, false} -> []
      {_key, {false, _} = inner} -> required_columns(inner)
      {_key, {true, _}} -> []
    end)
  end

  defp all_columns({_optional, entries}) do
    Enum.flat_map(entries, fn
      {_key, column, _required} -> [column]
      {_key, inner} -> all_columns(inner)
    end)
  end

  @doc "Turn every virtual value-object value of a write into its leaf columns."
  def decompose(%Ecto.Changeset{data: %{__struct__: schema} = data} = changeset) do
    changeset = %{changeset | data: decompose(data)}

    changeset =
      if function_exported?(schema, :__value_columns__, 0) do
        Enum.reduce(schema.__value_columns__(), changeset, fn {field, node}, acc ->
          case Ecto.Changeset.fetch_change(acc, field) do
            {:ok, value} ->
              Enum.reduce(leaf_values(value, node), acc, fn {column, leaf}, cs ->
                Ecto.Changeset.force_change(cs, column, cast_leaf(schema, column, leaf))
              end)

            :error ->
              acc
          end
        end)
      else
        changeset
      end

    %{changeset | changes: Map.new(changeset.changes, fn {k, v} -> {k, decompose_nested(v)} end)}
  end

  def decompose(%{__meta__: %Ecto.Schema.Metadata{}, __struct__: schema} = struct) do
    struct =
      if function_exported?(schema, :__value_columns__, 0) do
        Enum.reduce(schema.__value_columns__(), struct, fn {field, node}, acc ->
          case Map.get(acc, field) do
            nil ->
              acc

            value ->
              Enum.reduce(leaf_values(value, node), acc, fn {column, leaf}, s ->
                Map.put(s, column, cast_leaf(schema, column, leaf))
              end)
          end
        end)
      else
        struct
      end

    Enum.reduce(schema.__schema__(:associations), struct, fn assoc, acc ->
      case Map.get(acc, assoc) do
        %Ecto.Association.NotLoaded{} -> acc
        loaded -> Map.put(acc, assoc, decompose_nested(loaded))
      end
    end)
  end

  def decompose(other), do: other

  defp decompose_nested(list) when is_list(list), do: Enum.map(list, &decompose_nested/1)
  defp decompose_nested(%Ecto.Changeset{} = changeset), do: decompose(changeset)
  defp decompose_nested(%{__meta__: %Ecto.Schema.Metadata{}} = struct), do: decompose(struct)
  defp decompose_nested(other), do: other

  defp leaf_values(value, {_optional, entries}) do
    Enum.flat_map(entries, fn
      {key, column, _required} -> [{column, member(value, key)}]
      {key, inner} -> leaf_values(member(value, key), inner)
    end)
  end

  # A leaf the value object's own cast keeps as given (a \`date\`, a \`json\`
  # member) is cast to its column's type here; one that does not cast is kept,
  # and the value object's validating constructor has already refused it.
  defp cast_leaf(_schema, _column, nil), do: nil

  defp cast_leaf(schema, column, value) do
    case Ecto.Type.cast(schema.__schema__(:type, column), value) do
      {:ok, cast} -> cast
      _ -> value
    end
  end

  defp member(nil, _key), do: nil

  defp member(value, key) when is_map(value) do
    case Map.fetch(value, key) do
      {:ok, v} -> v
      :error -> Map.get(value, Atom.to_string(key))
    end
  end
end
`;
}

/** `module` with its `alias <App>.Repo` line rewritten to alias exactly what
 *  the module calls unqualified — `Records`, `Repo`, both, or neither — so a
 *  module whose reads all moved to the seam carries no unused alias (a
 *  `--warnings-as-errors` failure). */
export function withRecordsAlias(appModule: string, module: string): string {
  const aliasLine = `  alias ${appModule}.Repo\n`;
  const at = module.indexOf(aliasLine);
  if (at < 0) return module;
  const rest = module.slice(0, at) + module.slice(at + aliasLine.length);
  const calls = (name: string): boolean =>
    new RegExp(`(?<![\\w.])${name}\\.[a-z_]+[!?]?\\(`).test(rest);
  const names = [calls("Records") ? "Records" : "", calls("Repo") ? "Repo" : ""].filter(Boolean);
  const replacement =
    names.length === 0
      ? ""
      : names.length === 1
        ? `  alias ${appModule}.${names[0]}\n`
        : `  alias ${appModule}.{${names.join(", ")}}\n`;
  return module.slice(0, at) + replacement + module.slice(at + aliasLine.length);
}
