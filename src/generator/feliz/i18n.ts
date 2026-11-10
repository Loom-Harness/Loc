// ---------------------------------------------------------------------------
// The Feliz (F#/Fable) translation runtime (M-T1.11) — the FIFTH frontend to
// translate, and the first whose runtime is a different LANGUAGE.
//
// React / Vue / Svelte / Angular all ship the one generated TypeScript shim
// (`_frontend/i18n-runtime.ts`): a `messages[key] ?? default` lookup plus
// `intl-messageformat` for the ICU holes.  Feliz cannot import that shim — its
// whole app is a single `src/App.fs` compiled by `dotnet fable`, and a relative
// JS import would have to be written against the FABLE OUTPUT directory rather
// than the F# source.  So the runtime is re-expressed in F#:
//
//   * the CATALOG is a generated `Map<string, string>` compiled into `App.fs`
//     (the "generated resource map"), built from the SAME `buildUiCatalog` the
//     JS frontends' `locales/en.json` comes from — so every key/message is
//     byte-identical to the `.loom/messages.en.json` entry;
//   * the ICU FORMATTER is the SAME `intl-messageformat` engine, reached through
//     ordinary Fable interop (Fable compiles F# to JavaScript — the escape hatch
//     the `@tanstack/table-core` DataGrid bindings already use).  A
//     `{n, plural, …}` / `{total, number, ::currency/USD}` message therefore
//     renders IDENTICALLY on Feliz and on the four JS frontends, rather than
//     Feliz getting a hand-rolled `{name}` substituter that would drift.
//
// Emitted only when the ui has extractable user-visible strings; a string-less
// app is byte-identical to pre-i18n (no module, no npm dependency).
// ---------------------------------------------------------------------------

import { type BoundedContextIR, DEFAULT_SOURCE_LOCALE, type UiIR } from "../../ir/types/loom-ir.js";
import { lines } from "../../util/code-builder.js";
import {
  buildUiCatalog,
  renderTranslatedCatalogs,
  type TranslationCatalogs,
} from "../_frontend/i18n-runtime.js";
import { baseAliases, localeEntries } from "../_frontend/locale-meta.js";
import { uiUsesLocaleSwitcher } from "../_frontend/locale-switcher-use.js";
import { HAND_BUILT_FORM_SENTENCES } from "../_walker/i18n-chrome.js";
import { fsString } from "./fs-expr.js";

/** The npm dependency the ICU half needs — the same engine, at the same pin,
 *  the four JS frontends' stack dependency blocks carry. */
export const FELIZ_INTL_MESSAGEFORMAT = "10.7.18";

/** True when this ui has any extractable user-visible string — the single gate
 *  for the whole runtime (module + npm dependency + `ctx.i18nPrefix`).  Empty
 *  catalog → no i18n anywhere and byte-identical output. */
export function felizI18nEnabled(ui: UiIR): boolean {
  return Object.keys(buildUiCatalog(ui)).length > 0 || uiUsesLocaleSwitcher(ui);
}

/** The translated locales (everything but the source) the app ships, sorted —
 *  the same list `renderTranslatedCatalogs` keys its catalogs by. */
function felizTranslatedLocales(
  translations: TranslationCatalogs | undefined,
  source: string,
): string[] {
  return [...(translations?.keys() ?? [])].filter((l) => l !== source).sort();
}

/** True when two or more locales ship (the source plus a translated catalog):
 *  the Model carries the active `Locale`, `Msg` a `LocaleChanged` case, and the
 *  shell header the switcher. */
export function felizLocaleSwitchable(
  ui: UiIR,
  translations: TranslationCatalogs | undefined,
  source: string,
): boolean {
  return felizI18nEnabled(ui) && felizTranslatedLocales(translations, source).length > 0;
}

/** An F# identifier for a locale's catalog binding.  `en` for the default
 *  source (unchanged output); a prefixed identifier otherwise so a tag like
 *  `in` or `pt-BR` never collides with an F# keyword or an illegal character. */
function catalogIdent(tag: string, source: string): string {
  const safe = tag.replace(/[^A-Za-z0-9_]/g, "_");
  if (tag === source) return source === DEFAULT_SOURCE_LOCALE ? "en" : `src_${safe}`;
  return `loc_${safe}`;
}

/** A column-aligned F# list literal of `rows` (one element per line). */
function fsListRows(rows: readonly string[], indent: string): string[] {
  if (rows.length === 0) return [`${indent}[]`];
  return rows.map(
    (row, i) => `${indent}${i === 0 ? "[ " : "  "}${row}${i === rows.length - 1 ? " ]" : ""}`,
  );
}

/** One `Map.ofList` catalog binding.  F# is offside-sensitive: the list literal
 *  must be indented PAST its `Map.ofList` receiver or it reads as a separate
 *  expression rather than the argument, and every element must start at the
 *  SAME column as the first (the one that follows the opening bracket). */
function catalogBinding(ident: string, catalog: Readonly<Record<string, string>>): string[] {
  const rows = Object.entries(catalog).map(
    ([key, message]) => `${fsString(key)}, ${fsString(message)}`,
  );
  return [
    `    let private ${ident}: Map<string, string> =`,
    "        Map.ofList",
    ...fsListRows(rows, "            "),
    "",
  ];
}

/** The `I18n` F# module spliced into `App.fs` — the catalogs, the locale model
 *  (negotiation, the stored choice, the reactive switch) and the lookup + ICU
 *  format.  Placed near the top of the file (it references nothing else, and F#
 *  is order-sensitive: every page view below calls into it).
 *
 *  The locale model is the F# twin of the generated `src/i18n.ts` the JS
 *  frontends ship: `matchLocale` tries each negotiation candidate as the exact
 *  tag and then as its base language, and a base alias (`pt` -> `pt-BR`) is
 *  registered only when exactly one regional variant ships.  The endonyms,
 *  directions and aliases are computed HERE, at generate time, so the module
 *  needs no runtime dependency to label or direct a locale.
 *
 *  Reactivity is an Elmish message: `setLocale` notifies the `onChange`
 *  listener `init` registers, which dispatches `LocaleChanged`, and the new
 *  `Model.Locale` re-renders every view — and so every `I18n.t` call. */
export function renderFelizI18nModule(
  ui: UiIR,
  source: string = DEFAULT_SOURCE_LOCALE,
  /** The contexts the ui's forms render over, so the implicit model-text keys
   *  (form labels, enum options, submit buttons) join the runtime catalog. */
  contexts: readonly BoundedContextIR[] = [],
  /** Translated catalogs from the `ddd i18n` translator tree. */
  translations?: TranslationCatalogs,
  /** The app draws the generated session gate, so its sign-in / forbidden
   *  chrome joins the runtime catalog. */
  authGate = false,
): string {
  const scope = {
    contexts,
    sentences: HAND_BUILT_FORM_SENTENCES.rows,
    implicitModelText: true,
    authGate,
  };
  const catalog = buildUiCatalog(ui, {}, scope);
  // `renderTranslatedCatalogs` scopes each locale to THIS ui's keys, exactly as
  // the source catalog is (a translated catalog never carries another app's
  // strings), and returns one JSON document per locale tag.
  const translated = new Map<string, Record<string, string>>(
    [...renderTranslatedCatalogs(ui, translations, {}, source, scope)].map(
      ([tag, json]) => [tag, JSON.parse(json) as Record<string, string>] as const,
    ),
  );
  const extra = [...translated.keys()];
  const entries = localeEntries(source, extra);
  const aliases = baseAliases(source, extra);
  const sourceIdent = catalogIdent(source, source);
  const switchable = extra.length > 0;
  return lines(
    "/// Translation runtime (Loom i18n).",
    "///",
    "/// `I18n.t key default` looks the message key up in the ACTIVE locale's",
    "/// catalog, falling back to the source-language default the call site",
    "/// carries.  `I18n.tf` additionally ICU-formats the message from its hole",
    "/// values through `intl-messageformat` — the SAME engine the React / Vue /",
    "/// Svelte / Angular runtimes use, so a `{n, plural, …}` or",
    "/// `{total, number, ::currency/USD}` message renders identically here.",
    "///",
    "/// The active locale is negotiated once at startup: `?lang=`, the stored",
    '/// choice (`localStorage["loom.locale"]`, mirrored to the `loom_locale`',
    "/// cookie), the browser's languages in order, then the source language.  Each",
    "/// candidate is tried as the exact tag and then as its base language.",
    "///",
    "/// To add a locale: add its `Map` below and register it in `catalogs` and",
    "/// `tagIndex`.",
    "module I18n =",
    '    let private intlMessageFormat: obj = import "IntlMessageFormat" "intl-messageformat"',
    "",
    '    [<Fable.Core.Emit("new $0($1, $2)")>]',
    "    let private newFormat (ctor: obj) (message: string) (locale: string) : obj = jsNative",
    "",
    '    [<Fable.Core.Emit("$0.format($1)")>]',
    "    let private runFormat (format: obj) (values: obj) : string = jsNative",
    "",
    // `globalThis.*` rather than a `typeof` guard, and `function` rather than an
    // arrow: the emitted F# is checked by `no-js-isms.test.ts`, which (rightly)
    // treats a bare `undefined`, an arrow or a template placeholder anywhere in
    // App.fs as a walker leak.
    `    [<Fable.Core.Emit("(new URLSearchParams(globalThis.location ? globalThis.location.search : '').get('lang') || '')")>]`,
    "    let private urlLang () : string = jsNative",
    "",
    `    [<Fable.Core.Emit("(function(){ try { return globalThis.localStorage.getItem('loom.locale') || '' } catch (e) { return '' } })()")>]`,
    "    let private storedChoice () : string = jsNative",
    "",
    `    [<Fable.Core.Emit("(globalThis.navigator ? Array.from(globalThis.navigator.languages && globalThis.navigator.languages.length ? globalThis.navigator.languages : [globalThis.navigator.language || '']) : [])")>]`,
    "    let private platformLanguages () : string[] = jsNative",
    "",
    "    /// Persist the choice (storage + cookie) and rewrite a stale `?lang=` in the",
    "    /// address bar.",
    `    [<Fable.Core.Emit("(function(){ try { globalThis.localStorage.setItem('loom.locale', $0) } catch (e) { } if (globalThis.document) { globalThis.document.cookie = 'loom_locale=' + encodeURIComponent($0) + '; path=/; max-age=31536000; SameSite=Lax' } try { var u = new URL(globalThis.location.href); if (u.searchParams.has('lang')) { u.searchParams.set('lang', $0); globalThis.history.replaceState(globalThis.history.state, '', u) } } catch (e) { } })()")>]`,
    "    let private persistChoice (tag: string) : unit = jsNative",
    "",
    "    /// Keep `<html lang dir>` on the active locale.",
    `    [<Fable.Core.Emit("(function(){ var d = globalThis.document; if (d) { d.documentElement.lang = $0; d.documentElement.dir = $1 } })()")>]`,
    "    let private applyDocument (tag: string) (dir: string) : unit = jsNative",
    "",
    "    /// The source language every missing key and unmatched negotiation falls to.",
    `    let sourceLocale: string = ${fsString(source)}`,
    "",
    "    /// The shipped locales, source first: tag, its own name, its direction.",
    "    /// Computed when the app is generated, so the switcher needs no runtime",
    "    /// dependency.",
    "    let locales: (string * string * string) list =",
    ...fsListRows(
      entries.map((e) => `(${fsString(e.tag)}, ${fsString(e.name)}, ${fsString(e.dir)})`),
      "        ",
    ),
    "",
    "    /// Source-language catalog for this ui — the same keys and messages",
    `    /// \`.loom/messages.${source}.json\` carries (D-I18N-KEY content hashes).`,
    ...catalogBinding(sourceIdent, catalog),
    ...[...translated].flatMap(([tag, c]) => [
      `    /// Translated catalog (\`locales/${tag}.json\`); a missing key falls back per key`,
      "    /// to the source-language default the call site carries.",
      ...catalogBinding(catalogIdent(tag, source), c),
    ]),
    "    let private catalogs: Map<string, Map<string, string>> =",
    "        Map.ofList",
    ...fsListRows(
      entries.map((e) => `${fsString(e.tag)}, ${catalogIdent(e.tag, source)}`),
      "            ",
    ),
    "",
    "    /// Lower-cased tag (or unique base-language alias) -> the registered tag.",
    "    let private tagIndex: Map<string, string> =",
    "        Map.ofList",
    ...fsListRows(
      [
        ...entries.map((e) => `${fsString(e.tag.toLowerCase())}, ${fsString(e.tag)}`),
        ...Object.entries(aliases).map(([a, tag]) => `${fsString(a)}, ${fsString(tag)}`),
      ],
      "            ",
    ),
    "",
    "    /// The first candidate that names a shipped locale, trying each candidate as",
    "    /// the exact tag and then as its base language; None when none does.",
    "    let matchLocale (candidates: string list) : string option =",
    "        candidates",
    "        |> List.tryPick (fun candidate ->",
    "            let tag = candidate.Trim().ToLowerInvariant().Replace('_', '-')",
    "            if tag.Length = 0 then",
    "                None",
    "            else",
    "                match tagIndex.TryFind tag with",
    "                | Some exact -> Some exact",
    "                | None -> tagIndex.TryFind ((tag.Split('-')).[0]))",
    "",
    "    /// The locale this visit starts in: `?lang=`, the stored choice, the browser's",
    "    /// languages in order, then the source language.",
    "    let private negotiate () : string =",
    "        let url = urlLang ()",
    "        let stored = storedChoice ()",
    "        let candidates =",
    "            (if url.Length > 0 then [ url ] else [])",
    "            @ (if stored.Length > 0 then [ stored ] else [])",
    "            @ List.ofArray (platformLanguages ())",
    "        defaultArg (matchLocale candidates) sourceLocale",
    "",
    "    let private dirOf (tag: string) : string =",
    "        match List.tryFind (fun (t, _, _) -> t = tag) locales with",
    "        | Some (_, _, dir) -> dir",
    '        | None -> "ltr"',
    "",
    "    let private nameOf (tag: string) : string =",
    "        match List.tryFind (fun (t, _, _) -> t = tag) locales with",
    "        | Some (_, name, _) -> name",
    "        | None -> tag",
    "",
    "    let mutable private current: string = negotiate ()",
    "    let mutable private listeners: (string -> unit) list = []",
    "    do applyDocument current (dirOf current)",
    "",
    "    /// The active locale — the one `t`, `tf` and the API client's",
    "    /// `Accept-Language` read.",
    "    let getLocale () : string = current",
    "",
    "    /// Call `listener` with the new tag whenever the locale changes.  The app",
    "    /// registers one at startup (`init`) that dispatches `LocaleChanged`.",
    "    let onChange (listener: string -> unit) : unit =",
    "        listeners <- listener :: listeners",
    "",
    "    /// Switch the active locale: persist the choice, update `<html lang dir>` and",
    "    /// notify subscribers.  A tag that names no shipped locale is ignored.",
    "    let setLocale (tag: string) : unit =",
    "        match matchLocale [ tag ] with",
    "        | None -> ()",
    "        | Some next ->",
    "            persistChoice next",
    "            if next <> current then",
    "                current <- next",
    "                applyDocument next (dirOf next)",
    "                for listener in listeners do",
    "                    listener next",
    "",
    "    /// Translate a key in the ACTIVE locale, falling back to the source-language",
    "    /// default.",
    "    let t (key: string) (defaultMessage: string) : string =",
    "        match catalogs.TryFind current |> Option.bind (fun m -> m.TryFind key) with",
    "        | Some m -> m",
    "        | None -> defaultMessage",
    "",
    "    /// Whether the ACTIVE locale's catalog carries a message for `key` — what",
    "    /// an optional key (a per-aggregate problem sentence) is probed with.",
    "    let has (key: string) : bool =",
    "        catalogs.TryFind current |> Option.bind (fun m -> m.TryFind key) |> Option.isSome",
    "",
    "    /// One parsed formatter per (locale, message) — parsing is the cost,",
    "    /// formatting is cheap, and the same few messages render on every pass.",
    "    let private formatters = System.Collections.Generic.Dictionary<string, obj>()",
    "",
    "    let private formatterFor (locale: string) (message: string) : obj =",
    '        let cacheKey = locale + "|" + message',
    "        match formatters.TryGetValue cacheKey with",
    "        | true, format -> format",
    "        | _ ->",
    "            let format = newFormat intlMessageFormat message locale",
    "            formatters.[cacheKey] <- format",
    "            format",
    "",
    "    /// A `{x, date}` hole formats a date, but a calendar `date` is its ISO",
    "    /// `YYYY-MM-DD` text on this frontend.  It becomes LOCAL midnight of that",
    "    /// day, so every zone shows the day that was written (UTC midnight reads",
    "    /// as the previous day west of UTC).",
    "    let private holeValue (message: string) (name: string, value: obj) : string * obj =",
    "        match value with",
    "        | :? string as s when",
    "            s.Length = 10",
    '            && System.Text.RegularExpressions.Regex.IsMatch(s, "^\\\\d{4}-\\\\d{2}-\\\\d{2}$")',
    '            && System.Text.RegularExpressions.Regex.IsMatch(message, "\\\\{\\\\s*" + name + "\\\\s*,\\\\s*date")',
    "            ->",
    "            name, box (System.DateTime(int (s.Substring(0, 4)), int (s.Substring(5, 2)), int (s.Substring(8, 2))))",
    "        | _ -> name, value",
    "",
    "    /// Translate a RICH-TEXT message — one sentence whose emphasis is carried as",
    "    /// `<b>` / `<i>` / `<code>` tags, so a locale can reorder the parts — into",
    "    /// styled inline elements.  The tags become private marker characters before",
    "    /// the ICU step, so they never reach the formatter and a hole VALUE can",
    "    /// never forge one.",
    "    let rich (key: string) (defaultMessage: string) (values: (string * obj) list) : ReactElement =",
    '        let marked = System.Text.RegularExpressions.Regex.Replace(t key defaultMessage, "<(/?)(b|i|code)>", "\\uE000$1$2\\uE001")',
    "        let safe =",
    "            values",
    "            |> List.map (fun (name, value) ->",
    "                match value with",
    '                | :? string as s -> name, box (s.Replace("\\uE000", "").Replace("\\uE001", ""))',
    "                | _ -> name, value)",
    "        let text =",
    "            if List.isEmpty safe then marked",
    "            else runFormat (formatterFor current marked) (createObj (List.map (holeValue marked) safe))",
    '        let tokens = System.Text.RegularExpressions.Regex.Split(text, "(\\uE000/?(?:b|i|code)\\uE001)") |> Array.toList',
    "        let step (bold, italic, code, acc: ReactElement list) (token: string) =",
    "            match token with",
    '            | "\\uE000b\\uE001" -> (true, italic, code, acc)',
    '            | "\\uE000/b\\uE001" -> (false, italic, code, acc)',
    '            | "\\uE000i\\uE001" -> (bold, true, code, acc)',
    '            | "\\uE000/i\\uE001" -> (bold, false, code, acc)',
    '            | "\\uE000code\\uE001" -> (bold, italic, true, acc)',
    '            | "\\uE000/code\\uE001" -> (bold, italic, false, acc)',
    '            | "" -> (bold, italic, code, acc)',
    "            | s ->",
    "                let node = Html.text s",
    "                let node = if code then Html.code [ node ] else node",
    "                let node = if italic then Html.em [ node ] else node",
    "                let node = if bold then Html.strong [ node ] else node",
    "                (bold, italic, code, acc @ [ node ])",
    "        let (_, _, _, nodes) = List.fold step (false, false, false, []) tokens",
    "        Html.span nodes",
    "",
    "    /// Translate, then ICU-format the message's holes in the active locale.",
    "    let tf (key: string) (defaultMessage: string) (values: (string * obj) list) : string =",
    "        let message = t key defaultMessage",
    "        runFormat (formatterFor current message) (createObj (List.map (holeValue message) values))",
    ...(switchable
      ? [
          "",
          "    /// The language picker: a native `select` of the shipped locales, each",
          "    /// option labelled with the locale's OWN name.  Pack-independent on",
          "    /// purpose — a language picker is one control.  Switching calls",
          "    /// `setLocale`, whose `LocaleChanged` message re-renders the view.",
          "    let localeSwitcher () =",
          "        Html.select [",
          '            prop.className "select select-bordered select-sm"',
          '            prop.custom ("data-testid", "locale-switcher")',
          "            prop.ariaLabel (nameOf current)",
          "            prop.value current",
          "            prop.onChange (fun (tag: string) -> setLocale tag)",
          "            prop.children [",
          "                for (tag, name, dir) in locales do",
          "                    Html.option [",
          "                        prop.value tag",
          '                        prop.custom ("lang", tag)',
          '                        prop.custom ("dir", dir)',
          "                        prop.text name",
          "                    ]",
          "            ]",
          "        ]",
        ]
      : [
          "",
          "    /// A single-language app has nothing to switch between.",
          "    let localeSwitcher () = Html.none",
        ]),
  );
}
