// ---------------------------------------------------------------------------
// `<App>.Repo.Records` — the one place a table-backed schema is read or written.
// It lives under `<App>.Repo` (beside the Ecto repo, never inside it), where no
// context module can land: a context is `<App>.<Context>`, one segment deep.
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
// `{probe, [entry]}` and an entry is a leaf `{key, column}` or a nested value
// object `{key, node}`.  A required node's probe is `nil`; an optional node's
// lists the columns whose all-NULL reads as absent — the shared rule
// (`absenceProbe`): its required leaves, else all of them, which the shared
// null-consistency CHECKs make exact.  A virtual field that is
// already set is kept: a fresh row never has one, and a struct already in
// memory (preloaded later) keeps the value its code holds.  For the same
// reason a write decomposes a struct's virtual field only when it is set; a
// cleared optional value object reaches the leaves as a CHANGE to nil.
// ---------------------------------------------------------------------------

/** `lib/<app>/records.ex`. */
export function renderRecordsModule(appModule: string): string {
  return `# Auto-generated.
defmodule ${appModule}.Repo.Records do
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

  def insert(changeset, opts \\\\ []), do: changeset |> decompose() |> Repo.insert(opts) |> written()
  def insert!(changeset, opts \\\\ []), do: changeset |> decompose() |> Repo.insert!(opts) |> written()
  def update(changeset, opts \\\\ []), do: changeset |> decompose() |> Repo.update(opts) |> written()
  def update!(changeset, opts \\\\ []), do: changeset |> decompose() |> Repo.update!(opts) |> written()

  def insert_or_update(changeset, opts \\\\ []),
    do: changeset |> decompose() |> Repo.insert_or_update(opts) |> written()

  def insert_or_update!(changeset, opts \\\\ []),
    do: changeset |> decompose() |> Repo.insert_or_update!(opts) |> written()

  # A written struct is composed afresh from the leaf columns it was just
  # written with, so the caller serializes exactly what the row now holds.
  defp written({:ok, struct}), do: {:ok, compose(struct, :written)}
  defp written({:error, _} = error), do: error
  defp written(struct), do: compose(struct, :written)

  @doc """
  Fill every virtual value-object field of a read result from its leaf columns.
  Total over what a read returns: nil, a struct, a list, a tuple, a plain map;
  any other struct (a changeset, \`Ecto.Association.NotLoaded\`, a \`Decimal\`) and
  any other term pass through.  A field already set is kept (\`:read\`); a
  write result is recomposed whole (\`:written\`).
  """
  def compose(value, mode \\\\ :read)
  def compose(list, mode) when is_list(list), do: Enum.map(list, &compose(&1, mode))

  def compose(tuple, mode) when is_tuple(tuple),
    do: tuple |> Tuple.to_list() |> compose(mode) |> List.to_tuple()

  def compose(%{__meta__: %Ecto.Schema.Metadata{}, __struct__: schema} = struct, mode) do
    struct
    |> compose_values(schema, mode)
    |> compose_associations(schema, mode)
  end

  def compose(%{__struct__: _} = struct, _mode), do: struct
  def compose(map, mode) when is_map(map), do: Map.new(map, fn {k, v} -> {k, compose(v, mode)} end)
  def compose(other, _mode), do: other

  defp compose_values(struct, schema, mode) do
    if function_exported?(schema, :__value_columns__, 0) do
      Enum.reduce(schema.__value_columns__(), struct, fn {field, node}, acc ->
        if mode == :written or is_nil(Map.get(acc, field)),
          do: Map.put(acc, field, compose_node(acc, node)),
          else: acc
      end)
    else
      struct
    end
  end

  defp compose_associations(struct, schema, mode) do
    Enum.reduce(schema.__schema__(:associations), struct, fn assoc, acc ->
      case Map.get(acc, assoc) do
        %Ecto.Association.NotLoaded{} -> acc
        loaded -> Map.put(acc, assoc, compose(loaded, mode))
      end
    end)
  end

  defp compose_node(row, {probe, entries}) do
    if is_list(probe) and Enum.all?(probe, &is_nil(Map.get(row, &1))) do
      nil
    else
      Map.new(entries, fn
        {key, column} when is_atom(column) -> {key, Map.get(row, column)}
        {key, inner} -> {key, compose_node(row, inner)}
      end)
    end
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

  defp leaf_values(value, {_probe, entries}) do
    Enum.flat_map(entries, fn
      {key, column} when is_atom(column) -> [{column, member(value, key)}]
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
  const replacement = [
    calls("Repo") ? `  alias ${appModule}.Repo\n` : "",
    calls("Records") ? `  alias ${appModule}.Repo.Records\n` : "",
  ].join("");
  return module.slice(0, at) + replacement + module.slice(at + aliasLine.length);
}

/** `test/records_test.exs` — the null rule `<App>.Repo.Records` composes an
 *  optional value object by, pinned on a schema of its own (no database): an
 *  optional value object is absent when its required leaves are all NULL
 *  (when it has none, when every leaf is) — the shared rule (`absenceProbe`),
 *  which the null-consistency CHECK makes exact for every row it admits. */
export function renderRecordsTest(appModule: string): string {
  return `# Auto-generated.
defmodule ${appModule}.Repo.RecordsTest do
  use ExUnit.Case, async: true

  alias ${appModule}.Repo.Records

  defmodule Row do
    @moduledoc false
    use Ecto.Schema

    schema "records_test_rows" do
      field :home, :map, virtual: true
      field :home_line1, :string
      field :home_line2, :string
      field :home_city, :string
      field :home_geo_lat, :decimal
      field :home_geo_lng, :decimal
      field :tag, :map, virtual: true
      field :tag_note, :string
    end

    def __value_columns__ do
      [
        {:home,
         {[:home_line1, :home_city],
          [
            {:line1, :home_line1},
            {:line2, :home_line2},
            {:city, :home_city},
            {:geo, {[:home_geo_lat, :home_geo_lng], [{:lat, :home_geo_lat}, {:lng, :home_geo_lng}]}}
          ]}},
        {:tag, {[:tag_note], [{:note, :tag_note}]}}
      ]
    end
  end

  test "an optional value object whose leaves are all NULL reads as nil" do
    assert %Row{home: nil, tag: nil} = Records.compose(%Row{})
  end

  test "a present value object composes its leaves, an absent nested one is nil" do
    row = Records.compose(%Row{home_line1: "1 Main", home_city: "Oslo"})
    assert row.home == %{line1: "1 Main", line2: nil, city: "Oslo", geo: nil}
  end

  test "required leaves NULL while an optional leaf is set reads as absent" do
    assert Records.compose(%Row{home_line2: "Flat 2"}).home == nil
  end

  test "a value object with no required leaf is present when any leaf is set" do
    assert Records.compose(%Row{tag_note: "x"}).tag == %{note: "x"}
  end

  test "a field already set is kept on a read and recomposed on a write" do
    set = %Row{home: :in_memory, home_line1: "a", home_city: "b"}
    assert Records.compose(set).home == :in_memory
    assert Records.compose(set, :written).home.line1 == "a"
  end

  test "compose is total over what a read returns" do
    assert Records.compose(nil) == nil
    assert {:ok, %Row{home: nil}} = Records.compose({:ok, %Row{}})
    assert %Ecto.Association.NotLoaded{} = Records.compose(%Ecto.Association.NotLoaded{})
    assert Records.compose(Decimal.new("1.5")) == Decimal.new("1.5")
  end

  test "a write turns the value object back into its leaf columns" do
    changeset =
      %Row{}
      |> Ecto.Changeset.change(%{home: %{line1: "x", city: "y", geo: %{lat: "1.5", lng: 2}}})
      |> Records.decompose()

    assert changeset.changes.home_line1 == "x"
    assert changeset.changes.home_line2 == nil
    assert changeset.changes.home_geo_lat == Decimal.new("1.5")
    assert changeset.changes.home_geo_lng == Decimal.new(2)
  end
end
`;
}
