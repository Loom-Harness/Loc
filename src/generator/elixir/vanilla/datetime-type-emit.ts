// ---------------------------------------------------------------------------
// The Phoenix backend's `datetime` column type — a UTC instant held at
// MILLISECOND precision (RS-38, D-ABSENT-JOIN-DATETIME-WIRE, ledger `F2-W-06`).
//
// Every other backend stores a declared `datetime` in a microsecond
// `TIMESTAMPTZ` and ships it on the wire in milliseconds: exactly three
// fractional digits when the instant has a sub-second part, none on a whole
// second (RS-4's `…00Z`).  Elixir mapped the field to Ecto's `:utc_datetime` —
// SECOND precision — so `…30.120Z` was stored and read back as `…30Z`, and the
// fraction a client wrote was silently lost.  A plain `:utc_datetime_usec`
// would keep the digits but ship SIX of them (`DateTime.to_iso8601` prints the
// struct's own precision), so the wire would disagree the other way.
//
// This custom Ecto type closes both halves in one place.  It rides
// `:utc_datetime_usec` underneath (the migration column is `timestamptz`), and
// every value it hands back — cast from a request, loaded from a row, or
// `normalize/1`d from a `DateTime.utc_now()` an operation assigned — carries
// microsecond precision `{ms * 1000, 3}`, or `{0, 0}` on a whole second.  That
// is exactly the precision `DateTime.to_iso8601/1` (and so Jason) prints as
// the canonical wire form, so no serializer anywhere needs to know about it.
// Sub-millisecond input is TRUNCATED, never rounded: rounding `.9996` would
// carry the instant into the next second, and the stored value must equal the
// value the wire reports.
//
// The module is app-independent and lives under a fixed `Loom.` namespace so
// every type-mapping site (`mapTypeToEcto`, the document / value-collection /
// value-object embeds) can name it without threading the app module through.
// ---------------------------------------------------------------------------

/** The fixed module every declared-`datetime` Ecto field is typed as. */
export const LOOM_DATETIME_MODULE = "Loom.Datetime";

/** `Loom.Datetime.normalize(<expr>)` — the in-memory millisecond normalisation
 *  a write seam that BYPASSES `cast` (`force_change`, `put_change`, a fold's
 *  `change/2`) applies to a DateTime it computed itself (`DateTime.utc_now()`,
 *  datetime arithmetic).  Nil-safe. */
export function normalizeDatetime(expr: string): string {
  return `${LOOM_DATETIME_MODULE}.normalize(${expr})`;
}

/** `lib/<app>/loom_datetime.ex`. */
export function renderLoomDatetimeModule(): string {
  return `# Auto-generated.
defmodule ${LOOM_DATETIME_MODULE} do
  @moduledoc """
  The \`datetime\` column type: a UTC instant at MILLISECOND precision (RS-38).

  Stored in a microsecond \`timestamptz\` (the other backends' column), handed
  back with microsecond precision \`{ms * 1000, 3}\` — or \`{0, 0}\` on a whole
  second — so \`DateTime.to_iso8601/1\` (and therefore Jason) prints exactly the
  canonical wire form: \`2024-03-01T10:20:30.120Z\`, \`2024-03-01T10:20:30Z\`.
  Sub-millisecond input is truncated, never rounded.
  """
  use Ecto.Type

  @impl true
  def type, do: :utc_datetime_usec

  @impl true
  def cast(value) do
    case Ecto.Type.cast(:utc_datetime_usec, value) do
      {:ok, %DateTime{} = dt} -> {:ok, normalize(dt)}
      other -> other
    end
  end

  @impl true
  def load(%DateTime{} = dt), do: {:ok, normalize(dt)}

  def load(%NaiveDateTime{} = ndt),
    do: {:ok, ndt |> DateTime.from_naive!("Etc/UTC") |> normalize()}

  def load(_), do: :error

  @impl true
  def dump(%DateTime{} = dt) do
    %DateTime{microsecond: {us, _}} = utc = DateTime.shift_zone!(dt, "Etc/UTC")
    {:ok, %{utc | microsecond: {div(us, 1000) * 1000, 6}}}
  end

  def dump(_), do: :error

  @doc """
  The canonical in-memory form of an instant: UTC, truncated to the
  millisecond, with the precision \`to_iso8601/1\` prints as the wire form.
  Every write that bypasses \`cast\` (\`force_change\`, \`put_change\`, a
  projection fold) runs a value it computed itself through here.
  """
  def normalize(%DateTime{} = dt) do
    %DateTime{microsecond: {us, _}} = utc = DateTime.shift_zone!(dt, "Etc/UTC")

    case div(us, 1000) do
      0 -> %{utc | microsecond: {0, 0}}
      ms -> %{utc | microsecond: {ms * 1000, 3}}
    end
  end

  def normalize(other), do: other
end
`;
}
