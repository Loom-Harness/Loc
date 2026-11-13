// ---------------------------------------------------------------------------
// The Phoenix HEEx translation runtime (M-T1.11) — the LAST frontend, and the
// one that diverges most.
//
// The other five reach a generated `t(key, default)` shim (TypeScript on the
// four JS frontends, an `I18n` F# module on Feliz, `lib/i18n.dart` on Flutter).
// Elixir has a STANDARD answer — `gettext` — and a generated Phoenix app that
// ignored it in favour of a bespoke shim would be the wrong kind of different:
// every Phoenix tool (`mix gettext.extract`, `mix gettext.merge`, every
// translation-service `.po` importer) speaks gettext.
//
// The awkward part is that gettext keys by the SOURCE STRING (`msgid`) while
// Loom keys by a content hash (D-I18N-KEY, `page.<P>.<role>.<hash>`) shared with
// `.loom/messages.en.json` and the `ddd i18n sync` CLI.  `pgettext/2` resolves
// it exactly: the Loom key becomes the gettext CONTEXT (`msgctxt`) and the
// English becomes the `msgid`, so
//
//     pgettext("page.Home.heading.gwr3o9", "Storefront")
//
// carries BOTH — key parity with the other five frontends, and gettext's own
// "a missing translation returns the msgid" fallback, which is the same
// `messages[key] ?? default` semantics the JS shim has.
//
// Emitted only when the ui has extractable user-visible strings; a string-less
// app is byte-identical to pre-i18n (no backend module, no `.po`, no dep).
//
// INTERPOLATION (D-I18N-HEEX-ICU) — gettext interpolates `%{name}`, not ICU
// `{name}`, and has no `plural`/`select` arg-type at all (only `ngettext`'s
// count form).  Rewriting the message to gettext's grammar at emit time was
// rejected: the Phoenix catalog would stop carrying the same msgid as the other
// five, which is the one invariant the whole design rests on.  So the message
// stays ICU VERBATIM and the two jobs split along their natural seam —
//
//     gettext resolves the message  →  an ICU engine formats the result
//
// which is exactly the two steps the JS shim already is (`messages[key] ??
// default`, then `intl-messageformat`).  The engine is `ex_cldr_messages`; the
// generated `<App>Web.I18n.loom_icu/2` wraps it with the raw-substitution
// fallback described there.
//
// SECOND-TIER GATE.  The CLDR backend costs real compile time, so it ships only
// when the ui has an INTERPOLATED message — one tier below the existing "has
// any string at all" gate, so a plain-literal Phoenix app pays for none of
// it.
// ---------------------------------------------------------------------------

import { type BoundedContextIR, DEFAULT_SOURCE_LOCALE, type UiIR } from "../../ir/types/loom-ir.js";
import { lines } from "../../util/code-builder.js";
import {
  aggregateProblemGeneric,
  buildUiCatalog,
  optionalProblemKeys,
} from "../_frontend/i18n-runtime.js";
import { uiUsesLocaleSwitcher } from "../_frontend/locale-switcher-use.js";
import { uiUsesLocaleFormat } from "../_i18n/locale-format.js";
import { sourceText } from "../_i18n/source-text.js";
import {
  APP_SHELL_CHROME,
  chromeKey,
  chromeMessage,
  type FormSentenceScope,
} from "../_walker/i18n-chrome.js";
import { collectUiMessages } from "../_walker/i18n-extract.js";

/** The gettext domain every generated message lands in — the Phoenix default,
 *  so `mix gettext.extract` and every `.po` tool need no configuration. */
export const GETTEXT_DOMAIN = "default";

/** The hex dependency line for the generated `mix.exs` `deps do` list. */
export const GETTEXT_DEP = `{:gettext, "0.26.2"}`;

/** The ICU formatter dependency, added only for a ui with an INTERPOLATED
 *  message (D-I18N-HEEX-ICU).  `ex_cldr_messages` is the Elixir ICU
 *  MessageFormat implementation — the counterpart of `intl-messageformat` on
 *  the four JS frontends and Feliz, and of `package:intl`'s `MessageFormat` on
 *  Flutter.  It pulls `ex_cldr` + `ex_cldr_numbers` transitively; `ex_cldr` is
 *  named explicitly because the generated backend module `use`s it. */
export const ICU_DEPS = [
  `{:ex_cldr, "2.47.5"}`,
  `{:ex_cldr_numbers, "2.38.4"}`,
  `{:ex_cldr_dates_times, "2.25.8"}`,
  `{:ex_cldr_messages, "1.0.4"}`,
];

/** True when this ui has any extractable user-visible string — the single gate
 *  for the whole runtime (backend module + `.po`/`.pot` + the `mix.exs` dep +
 *  the walk prefix).  Empty catalog → no i18n anywhere, byte-identical. */
export function heexI18nEnabled(ui: UiIR): boolean {
  return Object.keys(buildUiCatalog(ui)).length > 0 || uiUsesLocaleSwitcher(ui);
}

/** True when this ui has an INTERPOLATED user-visible message and therefore
 *  needs an ICU engine (D-I18N-HEEX-ICU) — the SECOND-tier gate, strictly
 *  narrower than {@link heexI18nEnabled}.
 *
 *  Read off the extraction pass's own `icu` marker rather than by sniffing the
 *  catalog for a `{`: the merged pack-chrome messages carry holes too
 *  (`chrome.pageOf` is "Page {page} of {pages}"), and HEEx renders none of
 *  them through this path, so a `{`-sniff would put the CLDR compile into every
 *  translatable app instead of the ones that use interpolation. */
export function heexIcuEnabled(ui: UiIR): boolean {
  return collectUiMessages(ui).some((m) => m.icu);
}

/** True when this ui needs the CLDR runtime — the SECOND-tier gate: an
 *  interpolated message ({@link heexIcuEnabled}) or a `DateDisplay`, whose
 *  output follows the active locale.  A
 *  translatable ui with neither stays CLDR-free: its text resolves through
 *  gettext alone and its dependency list is the gettext-only one. */
export function heexCldrEnabled(ui: UiIR): boolean {
  return heexIcuEnabled(ui) || uiUsesLocaleFormat(ui);
}

/** `lib/<app>/cldr.ex` — the CLDR backend `ex_cldr_messages` formats against.
 *
 *  `locales:` compiles every shipped locale's CLDR plural rules in, because they
 *  are per-locale data; a `.po` file whose plural forms no backend can evaluate
 *  would silently fall back to the source rules.  The shipped set comes from the
 *  `locales/<tag>.json` files beside the .ddd. */
export function renderCldrBackend(
  appModule: string,
  sourceLocale: string = DEFAULT_SOURCE_LOCALE,
  /** Every shipped locale tag, source first.  Each is compiled in so its plural
   *  rules and number formats are available when a request negotiates it. */
  locales: readonly string[] = [sourceLocale],
): string {
  return lines(
    `defmodule ${appModule}.Cldr do`,
    '  @moduledoc """',
    "  CLDR backend for the ICU message formatter (Loom i18n).",
    "",
    "  `Cldr.Message` formats the ICU message gettext resolved — the holes,",
    "  `{n, plural, …}` categories and `{x, select, …}` cases in",
    "  `priv/gettext/**/*.po`.",
    "",
    "  `@shipped` lists every locale the project ships (the source plus the",
    "  translated catalogs); `locales:` compiles each one's CLDR plural rules in.",
    "  CLDR aborts the compile on a configured tag it does not define, so a shipped",
    "  tag CLDR lacks is left out of `locales:`: its `.po` tree still serves, and",
    "  its plural-category messages fall back to the source language's rules.",
    "  A `locales/<tag>.json` beside the .ddd yields both the `priv/gettext/<tag>`",
    "  tree and the `@shipped` entry on generate, so no hand edit is needed.",
    '  """',
    `  @source ${JSON.stringify(sourceLocale)}`,
    `  @shipped [${locales.map((l) => JSON.stringify(l)).join(", ")}]`,
    "  @known Enum.filter(@shipped, &(&1 == @source or String.to_atom(&1) in Cldr.all_locale_names()))",
    "",
    "  use Cldr,",
    "    locales: @known,",
    `    default_locale: ${JSON.stringify(sourceLocale)},`,
    "    providers: [Cldr.Number, Cldr.Date, Cldr.Time, Cldr.DateTime, Cldr.Message]",
    "end",
  );
}

/** `lib/<app>_web/i18n.ex` — the ICU formatting step that runs over gettext's
 *  result (D-I18N-HEEX-ICU).
 *
 *  `loom_icu/2` rather than a bare `format/2`: it is `import`ed into every
 *  template through `html_helpers`, where a generic name would collide with
 *  Phoenix's own helpers or the page's.
 *
 *  `ex_cldr_messages` implements ICU MessageFormat — including `{d, date}` and
 *  `{n, number}` against the CLDR backend's date and number providers — but not
 *  ICU number SKELETONS (`{total, number, ::currency/USD}`, the canonical
 *  currency spelling Loom's own grammar documents).  The skeletons Loom spells
 *  (`currency/<ISO>`, `percent`) are therefore formatted here through
 *  `Cldr.Number` before the message step.
 *
 *  The FALLBACK is the interesting half.  A message the engine still cannot
 *  format (a skeleton token outside that set, a malformed translation) degrades
 *  to raw hole substitution rather than crash a page render: the value is
 *  interpolated unformatted, which is EXACTLY what pre-i18n Phoenix rendered
 *  for that hole.  Same trade, and same reason, as the Flutter runtime's
 *  documented `_substitute` fallback.
 *
 *  `loom_date/1` is `DateDisplay`'s runtime: the date renders in the locale the
 *  request negotiated.
 *
 *  Both the `{:error, _}` tuple and a raise are caught: the library reports a
 *  parse/bind failure as a tuple but a missing date provider as a
 *  `FunctionClauseError`, and a page render must survive either. */
export function renderIcuRuntime(appModule: string): string {
  return lines(
    `defmodule ${appModule}Web.I18n do`,
    '  @moduledoc """',
    "  ICU message formatting (Loom i18n).",
    "",
    "  Loom keeps ONE message per catalog key across all six frontends, in ICU",
    "  form.  gettext resolves it (`pgettext/2` — Loom's key is the msgctxt);",
    "  this module formats the result:",
    "",
    '      loom_icu(pgettext("page.Home.text.k2f", "Status: {code}"), code: @code)',
    "",
    "  ICU number skeletons (`::currency/USD`, `::percent`) are formatted through",
    "  `Cldr.Number`.  A message the engine still cannot format falls back to raw",
    "  hole substitution rather than raising — the value renders unformatted,",
    "  which is what this app rendered before it was translatable.",
    "",
    "  `loom_date/1` formats a date in the negotiated locale for `DateDisplay`.",
    '  """',
    "",
    '  @doc "Format an ICU message against its bindings; never raises."',
    "  def loom_icu(message, bindings) when is_binary(message) do",
    "    {expanded, expanded_bindings} = expand_skeletons(message, bindings)",
    "",
    "    case safe_format(expanded, expanded_bindings) do",
    "      {:ok, formatted} -> formatted",
    "      :error -> substitute(message, bindings)",
    "    end",
    "  end",
    "",
    '  @doc "A date in the active locale (`Date`, `DateTime` or `NaiveDateTime`); never raises."',
    '  def loom_date(nil), do: ""',
    "",
    "  def loom_date(value) do",
    `    case ${appModule}.Cldr.Date.to_string(value) do`,
    "      {:ok, text} -> text",
    "      _ -> iso_date(value)",
    "    end",
    "  rescue",
    "    _ -> iso_date(value)",
    "  end",
    "",
    '  defp iso_date(%{year: _, month: _, day: _} = value), do: Calendar.strftime(value, "%Y-%m-%d")',
    "  defp iso_date(value), do: to_string(value)",
    "",
    "  # A numeric string (a projection field) parses to a Decimal so CLDR can format it.",
    "  defp number(value) when is_binary(value) do",
    "    case Decimal.parse(value) do",
    '      {decimal, ""} -> decimal',
    "      _ -> value",
    "    end",
    "  end",
    "",
    "  defp number(value), do: value",
    "",
    "  # `{x, number, ::currency/USD}` is an ICU number SKELETON, which Cldr.Message",
    "  # does not implement.  Each skeleton is formatted here through Cldr.Number",
    "  # and its hole replaced by a plain one bound to the text.  A skeleton this",
    "  # cannot express stays in the message, so the whole message degrades to raw",
    "  # substitution.  The new hole names derive from the match index, never from",
    "  # message text, so the atom table stays bounded.",
    "  @skeleton ~r/\\{\\s*([a-zA-Z_][a-zA-Z0-9_]*)\\s*,\\s*number\\s*,\\s*::([^{}]*?)\\s*\\}/",
    "",
    "  defp expand_skeletons(message, bindings) do",
    "    @skeleton",
    "    |> Regex.scan(message)",
    "    |> Enum.with_index()",
    "    |> Enum.reduce({message, bindings}, fn {[whole, name, skeleton], index}, {msg, binds} ->",
    "      with {_, value} <- Enum.find(binds, fn {key, _} -> Atom.to_string(key) == name end),",
    "           {:ok, opts} <- skeleton_options(skeleton),",
    `           {:ok, text} <- ${appModule}.Cldr.Number.to_string(number(value), opts) do`,
    '        hole = String.to_atom("loom_skeleton_#{index}")',
    '        {String.replace(msg, whole, "{#{hole}}", global: false), [{hole, text} | binds]}',
    "      else",
    "        _ -> {msg, binds}",
    "      end",
    "    end)",
    "  end",
    "",
    "  defp skeleton_options(skeleton) do",
    "    skeleton",
    "    |> String.split()",
    "    |> Enum.reduce_while({:ok, []}, fn",
    '      "currency/" <> code, {:ok, opts} when byte_size(code) == 3 ->',
    "        {:cont, {:ok, [{:currency, String.upcase(code)} | opts]}}",
    "",
    '      "percent", {:ok, opts} ->',
    "        {:cont, {:ok, [{:format, :percent} | opts]}}",
    "",
    "      _, _ ->",
    "        {:halt, :error}",
    "    end)",
    "  end",
    "",
    '  @doc """',
    "  Render a RICH-TEXT message — one sentence whose emphasis is carried as",
    "  `<b>` / `<i>` / `<code>` tags, so a locale can reorder the parts — as safe",
    "  HTML.  The tags become private marker characters before the ICU step (so a",
    "  hole VALUE can never forge one), every other character is HTML-escaped, then",
    "  the markers become `<strong>` / `<em>` / `<code>`.",
    '  """',
    "  def loom_rich(message, bindings) when is_binary(message) do",
    '    marked = Regex.replace(~r/<(\\/?)(b|i|code)>/, message, "\\u{E000}\\\\1\\\\2\\u{E001}")',
    "",
    "    text =",
    "      case bindings do",
    "        [] -> marked",
    "        _ -> loom_icu(marked, Enum.map(bindings, &strip_markers/1))",
    "      end",
    "",
    "    text",
    "    |> Phoenix.HTML.html_escape()",
    "    |> Phoenix.HTML.safe_to_string()",
    "    |> then(&Regex.replace(~r/\\x{E000}(\\/?)(b|i|code)\\x{E001}/u, &1, fn _, close, tag ->",
    '      "<" <> close <> rich_tag(tag) <> ">"',
    "    end))",
    "    |> Phoenix.HTML.raw()",
    "  end",
    "",
    '  defp rich_tag("b"), do: "strong"',
    '  defp rich_tag("i"), do: "em"',
    '  defp rich_tag("code"), do: "code"',
    "",
    "  defp strip_markers({key, value}) when is_binary(value),",
    '    do: {key, String.replace(value, ["\\u{E000}", "\\u{E001}"], "")}',
    "",
    "  defp strip_markers(pair), do: pair",
    "",
    "  defp safe_format(message, bindings) do",
    `    case Cldr.Message.format(message, bindings, backend: ${appModule}.Cldr) do`,
    "      {:ok, formatted} -> {:ok, formatted}",
    "      _ -> :error",
    "    end",
    "  rescue",
    "    _ -> :error",
    "  end",
    "",
    "  # Replace each `{name…}` with its binding, formatting nothing.  The regex",
    "  # takes the NAME up to the first `,` or `}` so a formatted hole",
    "  # (`{total, number, ::currency/USD}`) resolves by name too.  An unbound",
    "  # hole is left verbatim — visible, rather than silently blank.",
    "  #",
    "  # The lookup compares the binding keys AS STRINGS rather than interning",
    "  # the hole name: message text comes from a `.po` file a translator edits,",
    "  # and `String.to_atom/1` over it would let an added hole grow the atom",
    "  # table without bound.",
    "  defp substitute(message, bindings) do",
    "    Regex.replace(~r/\\{\\s*([a-zA-Z_][a-zA-Z0-9_]*)\\s*(?:,[^{}]*)?\\}/, message, fn whole, name ->",
    "      case Enum.find(bindings, fn {key, _} -> Atom.to_string(key) == name end) do",
    "        {_, value} -> to_string(value)",
    "        nil -> whole",
    "      end",
    "    end)",
    "  end",
    "end",
  );
}

/** Escape a string for a `.po` quoted field (RFC-ish: backslash, quote, and
 *  the newline that would otherwise terminate the line). */
function poString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

/** An Elixir double-quoted string literal for the emitted `pgettext` args.
 *
 *  Beyond the obvious `\\` / `"` / `#{` / newline, this `\\x`-escapes the four
 *  characters that are SIGNIFICANT TO THE TEMPLATE GRAMMAR AROUND THE CALL, not
 *  to Elixir:
 *
 *    - `>` and `<` — the call sits inside an EEx tag (`<%= pgettext(…) %>`), so
 *      a `%>` anywhere in the message would TERMINATE that tag early and the
 *      rest of the message would spill into markup.  A `.ddd` heading of
 *      `"a <%= x %> b"` is enough to break the template.
 *    - `{` and `}` — the attribute form (`aria-label={pgettext(…)}`) is a HEEx
 *      `{…}` expression, which a `}` in the message would close early.
 *
 *  `\\xHH` produces the IDENTICAL runtime string, so the emitted msgid still
 *  matches the `.po` entry byte-for-byte — this is purely about the bytes in the
 *  generated source.  (Caught by `text-escaping-cross-target.test.ts`, which
 *  drives a payload hostile in every text grammar through all six frontends.) */
export function elixirI18nString(value: string): string {
  const body = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/#/g, "\\#")
    .replace(/\n/g, "\\n")
    .replace(/</g, "\\x3C")
    .replace(/>/g, "\\x3E")
    .replace(/\{/g, "\\x7B")
    .replace(/\}/g, "\\x7D");
  return `"${body}"`;
}

/** The `pgettext(<key>, <English>)` call every emitted translatable string
 *  uses.  The English is the source text for `key`: the model's derived text,
 *  or the translator's source-language override. */
export function pgettextCall(key: string, english: string): string {
  return `pgettext(${elixirI18nString(key)}, ${elixirI18nString(sourceText(key, english))})`;
}

/** `lib/<app>_web/gettext.ex` — the Gettext backend every `~H` template calls
 *  into.  A plain `use Gettext.Backend`, imported into `html_helpers` so
 *  `pgettext/2` resolves inside a template without qualification. */
export function renderGettextBackend(appName: string, appModule: string): string {
  return lines(
    `defmodule ${appModule}Web.Gettext do`,
    '  @moduledoc """',
    "  Translation runtime (Loom i18n).",
    "",
    "  A page's user-visible text is emitted as",
    "",
    '      pgettext("page.<Page>.<role>.<hash>", "<English>")',
    "",
    "  — the CONTEXT is Loom's content-hashed catalog key (identical to the one",
    "  in `.loom/messages.en.json` and on every other frontend), and the msgid is",
    "  the source-language default, so an untranslated message renders the",
    "  English rather than the key.",
    "",
    "  Translators work in `priv/gettext/<locale>/LC_MESSAGES/default.po`; add a",
    "  locale by copying the `en` tree.  `mix gettext.extract` / `gettext.merge`",
    "  work normally — the emitted `.pot` is a regeneratable convenience, not a",
    "  hand-maintained file.",
    '  """',
    `  use Gettext.Backend, otp_app: :${appName}`,
    "end",
  );
}

/** The `.pot` template + the source-language `.po`, both derived from the SAME
 *  `buildUiCatalog` the other five frontends' catalogs come from.
 *
 *  The `en` catalog's `msgstr` is deliberately EMPTY, not a copy of the msgid:
 *  gettext falls back to the msgid when a translation is empty, so an empty
 *  `msgstr` renders the English AND leaves `mix gettext.merge` free to treat
 *  the entry as untranslated in a real translation workflow. */
export function renderGettextCatalog(
  ui: UiIR | undefined,
  kind: "pot" | "po",
  /** Backend validation messages (M-T1.11) — `<Ctx>.<Owner>.rule.<name>` → authored English,
   *  from `collectWireValidationMessages`. Merged into the SAME `.po` tree as the
   *  ui strings: a Loom key is globally unique and always the `msgctxt`, so one
   *  domain carries both halves and `mix gettext.merge` sees one catalog. An
   *  API-only deployable (no ui) therefore still gets a real gettext tree. */
  validationMessages: readonly { code: string; text: string }[] = [],
  /** The active HEEx pack's DECLARED chrome (`pack.<family>.<role>.<hash>` →
   *  English).  A `.hbs` pack bakes its own user-visible English ("No items.",
   *  a pager landmark), which no IR walk sees — so the `.po` a translator opens
   *  has to carry it alongside the authored strings, keyed identically to
   *  `.loom/messages.en.json`. */
  packChrome: Record<string, string> = {},
  /** The source language: the `.po` header's `Language`. */
  sourceLocale: string = DEFAULT_SOURCE_LOCALE,
  /** The system's contexts, which key the implicit model-text sites (form
   *  labels, enum options, submit buttons) the HEEx walker translates; without
   *  them those keys are rendered but never reach the `.po`. */
  modelTextContexts: readonly BoundedContextIR[] = [],
  /** A translated locale's catalog (key -> text).  Present: the `.po` carries
   *  each translated `msgstr`; a key it lacks keeps an empty `msgstr`, which
   *  gettext resolves to the msgid (the source text). */
  translation: Record<string, string> | undefined = undefined,
): string {
  const scope: FormSentenceScope = {
    contexts: modelTextContexts,
    sentences: [],
    implicitModelText: true,
    optionalCreateInputs: true,
    fallbackLabels: true,
  };
  const catalog: Record<string, string> = ui ? { ...buildUiCatalog(ui, packChrome, scope) } : {};
  for (const m of validationMessages) catalog[m.code] = m.text;
  const header =
    kind === "pot"
      ? [
          "## Generated by Loom — the source-language template.",
          "## `msgctxt` is Loom's content-hashed catalog key (D-I18N-KEY); `msgid` is",
          "## the English default.  Regenerated on every `ddd generate system`.",
          'msgid ""',
          'msgstr ""',
          '"Content-Type: text/plain; charset=UTF-8\\n"',
        ]
      : [
          ...(translation === undefined
            ? [
                "## Generated by Loom — the source-language catalog.",
                "## An EMPTY msgstr means gettext renders the msgid (the English), which is",
                "## exactly the source-language behaviour.  Copy this tree to add a locale.",
              ]
            : [
                "## Generated by Loom — a translated catalog, from the `ddd i18n` tree.",
                "## An EMPTY msgstr falls back to the msgid (the source text).",
              ]),
          'msgid ""',
          'msgstr ""',
          `"Language: ${sourceLocale}\\n"`,
          '"Content-Type: text/plain; charset=UTF-8\\n"',
        ];
  // Key-sorted: `buildUiCatalog` already sorts its own keys, but merging the
  // `msg.*` half in would otherwise append them after the `page.*` ones, making
  // the file's order depend on which half contributed a key.
  // An optional per-aggregate problem sentence (`<Ctx>.<Type>.problem.<class>`)
  // is looked up with its GENERIC sentence's msgid, which the runtime knows
  // without knowing which aggregates were reworded: a source override is its
  // source-language msgstr, a translation its translated one.
  const keySet = new Set(Object.keys(catalog));
  for (const key of optionalProblemKeys(Object.keys(translation ?? {}), keySet)) {
    catalog[key] = catalog[aggregateProblemGeneric(key)!]!;
  }
  const msgstrOf = (key: string): string => {
    const generic = aggregateProblemGeneric(key);
    if (translation !== undefined || generic === undefined) return translation?.[key] ?? "";
    return catalog[key] === catalog[generic] ? "" : catalog[key]!;
  };
  const entries = Object.keys(catalog)
    .sort()
    .flatMap((key) => [
      "",
      `msgctxt ${poString(key)}`,
      `msgid ${poString(catalog[aggregateProblemGeneric(key) ?? key]!)}`,
      `msgstr ${poString(msgstrOf(key))}`,
    ]);
  return lines(...header, ...entries);
}

/** The ui a deployable mounts, but ONLY when it has extractable user-visible
 *  strings — the single i18n gate the Phoenix shell emitter takes.  Undefined
 *  for a JSON-API-only deployable, an unresolvable `ui:`, or a string-less ui,
 *  all of which keep the generated project byte-identical to pre-i18n. */
export function heexI18nUi(
  sys: { uis: readonly UiIR[] },
  deployable: { uiName?: string },
): UiIR | undefined {
  if (!deployable.uiName) return undefined;
  const ui = sys.uis.find((u) => u.name === deployable.uiName);
  return ui && heexI18nEnabled(ui) ? ui : undefined;
}

/** A baked-in app-shell chrome string in HEEx TEXT position — a
 *  `<%= pgettext(…) %>` call under i18n (M-T1.11), else the raw English, which
 *  is byte-identical to the pre-i18n shell.  The English comes from the shared
 *  `APP_SHELL_CHROME` table so the emitted msgid equals the catalog entry. */
export function shellChromeText(name: string, i18nEnabled: boolean): string {
  const key = chromeKey(name);
  const english = APP_SHELL_CHROME[key]!;
  return i18nEnabled ? `<%= ${pgettextCall(key, english)} %>` : english;
}

/** The same chrome string in ATTRIBUTE position — a HEEx `{…}` expression
 *  attribute under i18n, else the quoted English literal (byte-identical). */
export function shellChromeAria(name: string, i18nEnabled: boolean): string {
  const key = chromeKey(name);
  const english = APP_SHELL_CHROME[key]!;
  return i18nEnabled ? `{${pgettextCall(key, english)}}` : `"${english}"`;
}

/** A walker-chrome string (`CHROME_MESSAGES`) as a HEEx ATTRIBUTE VALUE — the
 *  `{pgettext(…)}` expression form under i18n, else the quoted English. */
export function formChromeAttr(name: string, i18nEnabled: boolean): string {
  const key = chromeKey(name);
  const english = chromeMessage(name);
  return i18nEnabled ? `{${pgettextCall(key, english)}}` : `"${english}"`;
}
