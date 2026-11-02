// The Elixir face of the `checksVersion` fact (`src/ir/enrich/version-check.ts`).
//
// A `versioned` row's save is guarded by Ecto's `optimistic_lock(:version)`: the
// UPDATE is conditioned on the version the changeset's DATA carries and bumps it
// by one, so a lost race matches no row, raises `Ecto.StaleEntryError`, and the
// repository rescues it to `{:error, :conflict}` (-> 409).  What differs per
// write path is WHICH version the data carries:
//
//   `handle`   — the version the handle was loaded at (a workflow / handler
//                body, or a route that names no version);
//   `if-match` — the client's `If-Match` tag, laid over the loaded struct by the
//                controller before the context function runs, so the guard
//                filters on the version the client was looking at.  An absent or
//                unparseable header leaves the loaded version in place.
//
// Only an operation route reads the header; nothing downstream of the
// controller sees the request.

import { rowVersionGuarded } from "../../../ir/enrich/version-check.js";
import type { AggregateIR } from "../../../ir/types/loom-ir.js";

/** True when the aggregate's row save runs the `optimistic_lock(:version)`
 *  guard — the decision every write-path emitter renders. */
export function savesLockVersion(agg: AggregateIR): boolean {
  return rowVersionGuarded(agg);
}

/** The controller binding of the client's expected version. */
export const EXPECTED_VERSION_BIND = "    expected_version = __expected_version(conn)\n";

/** The loaded `record` with its `version` replaced by the client's `If-Match`
 *  (the loaded version when the header is absent). */
export const RECORD_AT_EXPECTED_VERSION = "%{record | version: expected_version || record.version}";

/** The controller's private `If-Match` parser, emitted once per controller that
 *  has at least one `if-match` route. */
export const EXPECTED_VERSION_HELPER = `

  # Parse the optimistic-concurrency precondition (the client's expected
  # \`version\`) from the \`if-match\` request header.  Absent or unparseable → nil,
  # which the write path treats as write-time CAS (the loaded row's own version).
  defp __expected_version(conn) do
    case get_req_header(conn, "if-match") do
      [value | _] ->
        case value |> String.trim("\\"") |> Integer.parse() do
          {n, _} -> n
          :error -> nil
        end

      _ ->
        nil
    end
  end
`;
