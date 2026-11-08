// ---------------------------------------------------------------------------
// The Phoenix runtime locale (Loom i18n).
//
// One negotiation, run in two processes.  A Plug runs it for the HTTP request
// (the dead render) and a LiveView `on_mount` hook runs it again for the
// LiveView process, because `Gettext.put_locale/2` and `Cldr.put_locale/2` are
// per-process and the socket process never inherits the request process's.
//
// The chain mirrors the JS frontends' runtime (`_frontend/i18n-runtime.ts`):
//
//     1. `?lang=<tag>`            the URL
//     2. cookie `loom_locale`     the stored choice (the switcher writes it)
//     3. `Accept-Language`        the header, in q order
//     4. the source language
//
// Each candidate is tried as the exact tag and then as its base language
// (`fr-FR` -> `fr`).  A base alias (`pt` -> `pt-BR`) exists only when exactly
// one regional variant ships (`baseAliases`).
//
// The known-locale index, the alias table, the endonyms and the directions are
// all computed HERE, at generate time, and emitted as module attributes: the
// generated app carries plain data and needs no runtime ICU or CLDR lookup to
// label or direct a locale.
// ---------------------------------------------------------------------------

import { lines } from "../../util/code-builder.js";
import { baseAliases, type LocaleEntry, localeEntries } from "../_frontend/locale-meta.js";

/** The locale model one Phoenix deployable ships: the source first, then every
 *  translated catalog, plus the base-language aliases the matcher registers. */
export interface PhoenixLocaleModel {
  source: string;
  entries: LocaleEntry[];
  aliases: Record<string, string>;
}

/** The locales this deployable ships, from the system's source language and the
 *  translator tree's locale tags. */
export function phoenixLocaleModel(
  source: string,
  translated: readonly string[],
): PhoenixLocaleModel {
  const entries = localeEntries(source, translated);
  const extra = entries.slice(1).map((e) => e.tag);
  return { source, entries, aliases: baseAliases(source, extra) };
}

/** gettext's directory spelling of a BCP-47 tag: `pt-BR` -> `pt_BR`. */
export function gettextLocale(tag: string): string {
  return tag.replace(/-/g, "_");
}

/** An Elixir string literal for plain generate-time data (tags, endonyms). */
function ex(value: string): string {
  return JSON.stringify(value).replace(/#/g, "\\#");
}

/** `lib/<app>_web/locale.ex` — the matcher and the process-level setters. */
export function renderLocaleModule(
  appModule: string,
  model: PhoenixLocaleModel,
  withCldr: boolean,
): string {
  const web = `${appModule}Web`;
  const index: [string, string][] = [
    ...model.entries.map((e): [string, string] => [e.tag.toLowerCase(), e.tag]),
    ...Object.entries(model.aliases).map(([alias, tag]): [string, string] => [alias, tag]),
  ];
  const map = (rows: readonly (readonly [string, string])[]): string =>
    `%{${rows.map(([k, v]) => `${ex(k)} => ${ex(v)}`).join(", ")}}`;
  const cldrPut = withCldr ? `\n    _ = ${appModule}.Cldr.put_locale(tag)` : "";
  return lines(
    `defmodule ${web}.Locale do`,
    '  @moduledoc """',
    "  Runtime locale negotiation (Loom i18n).",
    "",
    "  The chain is `?lang=`, then the `loom_locale` cookie, then `Accept-Language`",
    "  in q order, then the source language.  Each candidate is tried as the exact",
    "  tag and then as its base language (`fr-FR` -> `fr`).  A bare base language",
    "  resolves to a regional catalog only when exactly one regional variant ships.",
    "",
    "  The tables below are computed when the project is generated.",
    '  """',
    "",
    `  @source ${ex(model.source)}`,
    "",
    "  # lowercased tag or base alias -> the shipped tag",
    `  @index ${map(index)}`,
    "",
    `  @names ${map(model.entries.map((e): [string, string] => [e.tag, e.name]))}`,
    `  @dirs ${map(model.entries.map((e): [string, string] => [e.tag, e.dir]))}`,
    "",
    "  @locales [",
    model.entries
      .map((e) => `    %{tag: ${ex(e.tag)}, name: ${ex(e.name)}, dir: ${ex(e.dir)}}`)
      .join(",\n"),
    "  ]",
    "",
    '  @doc "The source language."',
    "  def source, do: @source",
    "",
    '  @doc "Every shipped locale, source first: `%{tag, name, dir}` with the name in its own language."',
    "  def locales, do: @locales",
    "",
    '  @doc "The writing direction of a shipped tag."',
    '  def dir(tag), do: Map.get(@dirs, tag, "ltr")',
    "",
    '  @doc "A shipped tag\'s own name (`de` -> \\"Deutsch\\")."',
    "  def name(tag), do: Map.get(@names, tag, tag)",
    "",
    '  @doc "gettext\'s directory spelling of a tag (`pt-BR` -> `pt_BR`)."',
    '  def gettext_locale(tag), do: String.replace(tag, "-", "_")',
    "",
    '  @doc "Resolve ONE candidate: the exact tag first, then its base language. `nil` when neither ships."',
    "  def resolve(candidate) when is_binary(candidate) do",
    "    tag =",
    "      candidate",
    "      |> String.trim()",
    '      |> String.replace("_", "-")',
    "      |> String.downcase()",
    "",
    "    case Map.fetch(@index, tag) do",
    "      {:ok, found} ->",
    "        found",
    "",
    "      :error ->",
    '        base = tag |> String.split("-", parts: 2) |> hd()',
    "        Map.get(@index, base)",
    "    end",
    "  end",
    "",
    "  def resolve(_), do: nil",
    "",
    '  @doc "The first shipped locale an `Accept-Language` header names, in q order."',
    "  def from_accept_language(header) when is_binary(header) do",
    "    header |> parse_accept_language() |> Enum.find_value(&resolve/1)",
    "  end",
    "",
    "  def from_accept_language(_), do: nil",
    "",
    '  @doc "The tags of an `Accept-Language` header, highest q first (ties keep header order); `q=0` and `*` are dropped."',
    "  def parse_accept_language(header) when is_binary(header) do",
    "    header",
    '    |> String.split(",", trim: true)',
    "    |> Enum.with_index()",
    "    |> Enum.flat_map(fn {part, index} ->",
    '      [tag | params] = part |> String.split(";") |> Enum.map(&String.trim/1)',
    "      q = params |> Enum.find_value(1.0, &parse_q/1)",
    "",
    '      if tag in ["", "*"] or q <= 0, do: [], else: [{tag, q, index}]',
    "    end)",
    "    |> Enum.sort_by(fn {_tag, q, index} -> {-q, index} end)",
    "    |> Enum.map(fn {tag, _q, _index} -> tag end)",
    "  end",
    "",
    '  defp parse_q("q=" <> value) do',
    "    case Float.parse(value) do",
    "      {q, _} -> q",
    "      :error -> 1.0",
    "    end",
    "  end",
    "",
    "  defp parse_q(_), do: nil",
    "",
    '  @doc "Run the whole chain; always returns a shipped tag."',
    "  def negotiate(lang, cookie, accept_language) do",
    "    resolve(lang) || resolve(cookie) || from_accept_language(accept_language) || @source",
    "  end",
    "",
    '  @doc "The gettext locale an `Accept-Language` header selects (for code with no conn, such as the 422 renderer)."',
    "  def header_gettext_locale(accept_language) do",
    "    negotiate(nil, nil, accept_language) |> gettext_locale()",
    "  end",
    "",
    '  @doc "Make `tag` the locale of the CURRENT process (gettext, and CLDR when the app formats ICU)."',
    "  def put(tag) do",
    `    Gettext.put_locale(${web}.Gettext, gettext_locale(tag))${cldrPut}`,
    "    tag",
    "  end",
    "",
    '  @doc "The shipped tag active in the current process."',
    "  def current do",
    `    active = Gettext.get_locale(${web}.Gettext)`,
    "    resolve(active) || @source",
    "  end",
    "",
    '  @doc "The current locale\'s own name."',
    "  def current_name, do: name(current())",
    "end",
  );
}

/** `lib/<app>_web/locale_plug.ex` — negotiates once per HTTP request. */
export function renderLocalePlug(appModule: string): string {
  const web = `${appModule}Web`;
  return lines(
    `defmodule ${web}.LocalePlug do`,
    '  @moduledoc """',
    "  Negotiates the request locale (`?lang=`, the `loom_locale` cookie,",
    "  `Accept-Language`, the source language) and applies it to this process.",
    "",
    "  The result is stored in the session so the LiveView `on_mount` hook can",
    "  apply the same locale in the LiveView process, and assigned as",
    "  `:loom_locale` / `:loom_dir` for the root layout's `<html lang dir>`.",
    '  """',
    "  @behaviour Plug",
    "  import Plug.Conn",
    "",
    "  @impl Plug",
    "  def init(opts), do: opts",
    "",
    "  @impl Plug",
    "  def call(conn, _opts) do",
    "    conn = conn |> fetch_query_params() |> fetch_cookies()",
    "",
    "    tag =",
    `      ${web}.Locale.negotiate(`,
    '        conn.query_params["lang"],',
    '        conn.cookies["loom_locale"],',
    '        conn |> get_req_header("accept-language") |> List.first()',
    "      )",
    "",
    `    ${web}.Locale.put(tag)`,
    "",
    "    conn",
    '    |> put_session("loom_locale", tag)',
    "    |> assign(:loom_locale, tag)",
    `    |> assign(:loom_dir, ${web}.Locale.dir(tag))`,
    "  end",
    "end",
  );
}

/** `lib/<app>_web/locale_hook.ex` — the LiveView process runs it again. */
export function renderLocaleHook(appModule: string): string {
  const web = `${appModule}Web`;
  return lines(
    `defmodule ${web}.LocaleHook do`,
    '  @moduledoc """',
    "  LiveView `on_mount` hook: puts the negotiated locale in the LiveView",
    "  process.  The socket process is not the request process, so the locale",
    "  the plug applied does not carry over; it is re-applied here from the",
    "  `?lang=` param or the session value the plug stored.",
    '  """',
    "  import Phoenix.Component, only: [assign: 3]",
    "",
    "  def on_mount(:default, params, session, socket) do",
    `    tag = ${web}.Locale.negotiate(params["lang"], session["loom_locale"], nil)`,
    `    ${web}.Locale.put(tag)`,
    "",
    "    {:cont,",
    "     socket",
    "     |> assign(:loom_locale, tag)",
    `     |> assign(:loom_dir, ${web}.Locale.dir(tag))}`,
    "  end",
    "end",
  );
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\{/g, "&#123;")
    .replace(/\}/g, "&#125;");
}

/** The locale `<select>` — every shipped locale under its own generate-time
 *  name.  Choosing one writes the `loom_locale` cookie, then navigates to the
 *  same page under `?lang=<tag>` (the two inputs the negotiation reads first). */
export function renderLocaleSelect(
  appModule: string,
  entries: readonly LocaleEntry[],
  testidAttr = ' data-testid="locale-switcher"',
): string {
  const locale = `${appModule}Web.Locale`;
  const onchange =
    "document.cookie='loom_locale='+encodeURIComponent(this.value)+'; path=/; max-age=31536000; SameSite=Lax'; " +
    "var u=new URL(window.location.href); u.searchParams.set('lang', this.value); window.location.assign(u)";
  return [
    `<select class="loom-locale-switcher" aria-label={${locale}.current_name()} onchange="${onchange}"${testidAttr}>`,
    ...entries.map(
      (e) =>
        `  <option value="${escapeText(e.tag)}" lang="${escapeText(e.tag)}" selected={${locale}.current() == ${ex(e.tag)}}>${escapeText(e.name)}</option>`,
    ),
    "</select>",
  ].join("\n");
}
