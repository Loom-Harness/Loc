// ---------------------------------------------------------------------------
// `lib/<app>_web/security_headers.ex` — the Phoenix half of the shared
// baseline security headers (`src/util/security-headers.ts`).
//
// `put_secure_browser_headers` only runs in the `:browser` pipeline, so the
// JSON API, the static assets, the health probes and the fault floor's
// problem documents would go out without them.  This plug sits FIRST in the
// endpoint and registers a `before_send` callback, so every response the
// endpoint sends carries the set — and, because the callback runs at send
// time, its values win over the `:browser` pipeline's own defaults
// (`x-frame-options: SAMEORIGIN`), keeping the LiveView pages on the same
// policy as every other backend.
// ---------------------------------------------------------------------------

import {
  BASELINE_SECURITY_HEADERS,
  HSTS_HEADER,
  SECURE_TRANSPORT_ENV,
  SECURE_TRANSPORT_OFF_VALUES,
} from "../../../util/security-headers.js";

/** Render `lib/<app>_web/security_headers.ex`. */
export function renderVanillaSecurityHeaders(appModule: string): string {
  const headers = BASELINE_SECURITY_HEADERS.map(
    ([name, value]) => `    {${JSON.stringify(name.toLowerCase())}, ${JSON.stringify(value)}}`,
  ).join(",\n");
  const offValues = SECURE_TRANSPORT_OFF_VALUES.map((v) => JSON.stringify(v)).join(", ");
  return `# Auto-generated.
defmodule ${appModule}Web.SecurityHeaders do
  @moduledoc """
  Baseline security headers on every response the endpoint sends.

  Strict-Transport-Security only while ${SECURE_TRANSPORT_ENV} is on (the
  default); the local compose stack serves plain http and turns it off.
  """
  @behaviour Plug

  @headers [
${headers}
  ]

  @impl true
  def init(opts), do: opts

  @impl true
  def call(conn, _opts) do
    Plug.Conn.register_before_send(conn, fn conn ->
      Plug.Conn.merge_resp_headers(conn, headers())
    end)
  end

  @doc "Whether the service is reached over TLS — read from the environment at runtime."
  def secure_transport? do
    value =
      System.get_env(${JSON.stringify(SECURE_TRANSPORT_ENV)}, "")
      |> String.trim()
      |> String.downcase()

    value not in [${offValues}]
  end

  defp headers do
    if secure_transport?() do
      @headers ++ [{${JSON.stringify(HSTS_HEADER[0].toLowerCase())}, ${JSON.stringify(HSTS_HEADER[1])}}]
    else
      @headers
    end
  end
end
`;
}
