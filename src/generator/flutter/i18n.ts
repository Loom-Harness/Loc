// ---------------------------------------------------------------------------
// The Flutter (Dart) translation runtime (M-T1.11) — the SIXTH frontend to
// translate, and the second whose runtime is a different LANGUAGE.
//
// React / Vue / Svelte / Angular all ship the one generated TypeScript shim
// (`_frontend/i18n-runtime.ts`); Feliz re-expresses it in F#.  Flutter's app is
// Dart compiled by the Flutter SDK — no JS runtime on the shipping (native)
// target at all — so the runtime is re-expressed a third time:
//
//   * the CATALOG is a generated `const Map<String, String>` in `lib/i18n.dart`,
//     built from the SAME `buildUiCatalog` the JS frontends' `locales/en.json`
//     comes from, so every key/message equals the `.loom/messages.en.json`
//     entry.  A `const` map rather than a JSON asset: an asset needs a pubspec
//     declaration AND an async `rootBundle.loadString`, which would make every
//     text slot in every widget `build` await something;
//   * the ICU FORMATTER is `MessageFormat` from `package:intl` — already an
//     unconditional dependency of every generated Flutter app (it formats
//     money/dates).  It covers `{name}` and the brace-bodied `plural` / `select`
//     / `gender` forms, i.e. everything the JS `intl-messageformat` covers
//     EXCEPT the `, number` / `, date` / `, time` arg-types.  Those are resolved
//     BEFORE the message reaches it, by `_resolveFormats` below: each such hole
//     is formatted through `intl`'s `NumberFormat` / `DateFormat` and handed to
//     `MessageFormat` as a plain value, so `{total, number, ::currency/USD}`
//     renders `$1,234.50` exactly as the four JS frontends and Feliz render it.
//
//     That pre-pass is not an optimisation — without it a skeleton hole is not
//     even a degradation.  `MessageFormat` does not THROW on the arg-type (which
//     is what the old `try`/`catch` assumed): its `_parseBlockType` classifies
//     the block as a SIMPLE PLACEHOLDER whose name is the whole
//     `total, number, ::currency/USD` string, finds no value under that key, and
//     renders the literal text `Undefined parameter - total, number,
//     ::currency/USD` into the widget.  The `catch` still guards a message
//     `MessageFormat` genuinely rejects — degrading beats crashing a `build()`,
//     the same trade the HEEx runtime makes.
//
//   * `{n, selectordinal, …}` is resolved before `MessageFormat` too.
//     `package:intl` picks a selectordinal branch with the CARDINAL rules
//     (English `2` → `other`, "2th") and ships no ordinal rules, so the
//     generator tabulates each shipped locale's CLDR ordinal categories
//     (`_i18n/ordinal-rules.ts`) and `_resolveOrdinals` splices the selected
//     branch, its `#` already locale-formatted, into the message.  Emitted only
//     when a catalog carries a selectordinal message.
//
// Emitted only when the ui has extractable user-visible strings; a string-less
// app is byte-identical to pre-i18n.
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
import { ordinalTable } from "../_i18n/ordinal-rules.js";

/** A Dart single-quoted string literal.  Escapes the backslash, the quote and
 *  `$` (Dart interpolates `$name` / `${…}` inside a plain string), plus real
 *  newlines.  Catalog messages routinely carry `{name}` holes, which are inert
 *  in Dart, and `$`-bearing text would otherwise be a compile error. */
export function dartStringLit(value: string): string {
  const body = value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\$/g, "\\$")
    .replace(/\n/g, "\\n");
  return `'${body}'`;
}

/** True when this ui has any extractable user-visible string — the single gate
 *  for the whole runtime (the `lib/i18n.dart` file, the per-page import, and
 *  `ctx.i18nPrefix`).  Empty catalog → no i18n anywhere, byte-identical output.
 *  A ui that renders a `LocaleSwitcher` ships the runtime too, so the widget the
 *  primitive names exists. */
export function flutterI18nEnabled(ui: UiIR): boolean {
  return Object.keys(buildUiCatalog(ui)).length > 0 || uiUsesLocaleSwitcher(ui);
}

/** True when two or more locales ship (the source plus a translated catalog):
 *  `main()` negotiates and restores the locale, `MaterialApp` carries the
 *  localization wiring, and every page's app bar the language picker. */
export function flutterLocaleSwitchable(
  ui: UiIR,
  translations: TranslationCatalogs | undefined,
  source: string,
): boolean {
  return flutterI18nEnabled(ui) && [...(translations?.keys() ?? [])].some((tag) => tag !== source);
}

/** True when rendered Dart calls the generated locale runtime — a standalone
 *  `t(` (the lookbehind keeps `Text(` / `DefaultTextStyle.merge(` and any other
 *  identifier ending in `t` from matching) or the `LocaleSwitcher` widget — so
 *  the file needs `import 'i18n.dart';`. */
export function callsI18nRuntime(dart: string): boolean {
  return /(?<![A-Za-z0-9_$.])t\(/.test(dart) || dart.includes("LocaleSwitcher(");
}

/** A Dart identifier for a locale's catalog map.  `_en` for the default source
 *  (unchanged output); lowerCamelCase otherwise (`_catDe`, `_catPtBr`), which
 *  the `constant_identifier_names` lint accepts and a raw tag (`pt-BR`) cannot
 *  be. */
function catalogIdent(tag: string, source: string): string {
  if (tag === source && source === DEFAULT_SOURCE_LOCALE) return "_en";
  const camel = tag
    .split(/[^A-Za-z0-9]+/)
    .filter((p) => p !== "")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join("");
  return `_cat${camel}`;
}

/** A `const Locale.fromSubtags(…)` expression for a BCP-47 tag
 *  (`de`, `pt-BR`, `zh-Hant-TW`). */
function dartLocaleLit(tag: string): string {
  const [language = tag, ...rest] = tag.split("-");
  const script = rest.find((p) => /^[A-Za-z]{4}$/.test(p));
  const region = rest.find((p) => /^([A-Za-z]{2}|[0-9]{3})$/.test(p));
  const parts = [
    `languageCode: ${dartStringLit(language.toLowerCase())}`,
    ...(script ? [`scriptCode: ${dartStringLit(script)}`] : []),
    ...(region ? [`countryCode: ${dartStringLit(region.toUpperCase())}`] : []),
  ];
  return `Locale.fromSubtags(${parts.join(", ")})`;
}

/** `lib/i18n.dart` — the locale model (negotiation, the stored choice, the
 *  reactive switch), the catalogs and the `t(key, default, [values])`
 *  lookup/format.
 *
 *  The locale model is the Dart twin of the generated `src/i18n.ts` the JS
 *  frontends ship: `matchLocale` tries each negotiation candidate as the exact
 *  tag and then as its base language, and a base alias (`pt` -> `pt-BR`) is
 *  registered only when exactly one regional variant ships.  Endonyms,
 *  directions and aliases are computed at generate time, so the app needs no
 *  runtime dependency to label or direct a locale.
 *
 *  The active locale is a `ValueNotifier`; `setLocale` updates it, points
 *  `Intl.defaultLocale` at it (so every default `NumberFormat` / `DateFormat` in
 *  the generated pages follows) and rebuilds the element tree, which is what
 *  makes every `t()` call re-run — `t` is a plain function, so no widget
 *  subscribes to the notifier by itself. */
export function renderFlutterI18nModule(
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
  const scope = { contexts, sentences: [], implicitModelText: true, authGate };
  const catalog = buildUiCatalog(ui, {}, scope);
  // Each translated catalog is SCOPED to this ui's keys, exactly as the source
  // catalog is, and returned as one JSON document per locale tag.
  const translated = new Map<string, Record<string, string>>(
    [...renderTranslatedCatalogs(ui, translations, {}, source, scope)].map(
      ([tag, json]) => [tag, JSON.parse(json) as Record<string, string>] as const,
    ),
  );
  const extra = [...translated.keys()];
  const entries = localeEntries(source, extra);
  const aliases = baseAliases(source, extra);
  const switchable = extra.length > 0;
  const sourceIdent = catalogIdent(source, source);
  const ordinals = [catalog, ...translated.values()].some((map) =>
    Object.values(map).some((message) => message.includes("selectordinal")),
  );
  // `buildUiCatalog` returns key-sorted entries, so the emitted map is stable
  // across runs (a reordered page must not churn the file).
  const catalogConst = (ident: string, map: Readonly<Record<string, string>>): string[] => [
    `const Map<String, String> ${ident} = <String, String>{`,
    ...Object.entries(map).map(
      ([key, message]) => `  ${dartStringLit(key)}: ${dartStringLit(message)},`,
    ),
    "};",
    "",
  ];
  return lines(
    "// Generated translation runtime (Loom i18n).",
    "//",
    "// Locale negotiation + the reactive locale + source-language lookup with a",
    "// per-key fallback, plus ICU message formatting via `package:intl`'s",
    "// `MessageFormat`.  The `t(key, default, values)` call sites the walker emits",
    "// are stable across every frontend — only the spelling differs.",
    "//",
    "// To add a locale: add its map below and register it in `_catalogs` and",
    switchable
      ? "// `_tagIndex`.  Date symbols load lazily — `initLocale()` loads them for every"
      : "// `_tagIndex`.",
    switchable ? "// shipped locale before the first frame." : undefined,
    switchable ? "import 'dart:async';" : undefined,
    switchable ? "import 'dart:ui' as ui;" : undefined,
    switchable ? "" : undefined,
    switchable ? "import 'package:flutter/foundation.dart' show kIsWeb;" : undefined,
    "import 'package:flutter/material.dart';",
    switchable ? "import 'package:flutter_localizations/flutter_localizations.dart';" : undefined,
    switchable ? "import 'package:intl/date_symbol_data_local.dart';" : undefined,
    "import 'package:intl/intl.dart' hide TextDirection;",
    "import 'package:intl/message_format.dart';",
    switchable ? "import 'package:shared_preferences/shared_preferences.dart';" : undefined,
    "",
    "/// The source language every missing key and unmatched negotiation falls to.",
    `const String sourceLocale = ${dartStringLit(source)};`,
    "",
    "/// A locale the app ships: its tag, its own name, its direction.  Names and",
    "/// directions are computed when the app is generated.",
    "class LocaleInfo {",
    "  const LocaleInfo(this.tag, this.name, this.dir, this.locale);",
    "  final String tag;",
    "  final String name;",
    "  final TextDirection dir;",
    "  final Locale locale;",
    "}",
    "",
    "/// The shipped locales, source first.",
    "const List<LocaleInfo> locales = <LocaleInfo>[",
    ...entries.map(
      (e) =>
        `  LocaleInfo(${dartStringLit(e.tag)}, ${dartStringLit(e.name)}, TextDirection.${e.dir}, ${dartLocaleLit(e.tag)}),`,
    ),
    "];",
    "",
    "/// Source-language catalog for this ui — the same keys and messages",
    `/// \`.loom/messages.${source}.json\` carries (D-I18N-KEY content hashes).`,
    ...catalogConst(sourceIdent, catalog),
    ...[...translated].flatMap(([tag, map]) => [
      `/// Translated catalog (\`locales/${tag}.json\`); a missing key falls back per key`,
      "/// to the source-language default the call site carries.",
      ...catalogConst(catalogIdent(tag, source), map),
    ]),
    "const Map<String, Map<String, String>> _catalogs = <String, Map<String, String>>{",
    ...entries.map((e) => `  ${dartStringLit(e.tag)}: ${catalogIdent(e.tag, source)},`),
    "};",
    "",
    "/// Lower-cased tag (or unique base-language alias) -> the registered tag.",
    "const Map<String, String> _tagIndex = <String, String>{",
    ...entries.map((e) => `  ${dartStringLit(e.tag.toLowerCase())}: ${dartStringLit(e.tag)},`),
    ...Object.entries(aliases).map(([a, tag]) => `  ${dartStringLit(a)}: ${dartStringLit(tag)},`),
    "};",
    "",
    "/// The first candidate that names a shipped locale, trying each candidate as",
    "/// the exact tag and then as its base language; null when none does.",
    "String? matchLocale(List<String> candidates) {",
    "  for (final String candidate in candidates) {",
    "    final String tag = candidate.trim().toLowerCase().replaceAll('_', '-');",
    "    if (tag.isEmpty) continue;",
    "    final String? exact = _tagIndex[tag];",
    "    if (exact != null) return exact;",
    "    final String? base = _tagIndex[tag.split('-').first];",
    "    if (base != null) return base;",
    "  }",
    "  return null;",
    "}",
    "",
    "/// The active locale — the one `t`, the default `NumberFormat` / `DateFormat`",
    "/// and the API client's `Accept-Language` read.",
    `final ValueNotifier<String> localeNotifier = ValueNotifier<String>(${dartStringLit(source)});`,
    "",
    "String get locale => localeNotifier.value;",
    "",
    "/// The active tag as a function, for call sites that read it per request.",
    "String activeLocale() => localeNotifier.value;",
    "",
    "TextDirection localeDirection(String tag) {",
    "  for (final LocaleInfo info in locales) {",
    "    if (info.tag == tag) return info.dir;",
    "  }",
    "  return TextDirection.ltr;",
    "}",
    "",
    "Locale localeFor(String tag) {",
    "  for (final LocaleInfo info in locales) {",
    "    if (info.tag == tag) return info.locale;",
    "  }",
    "  return locales.first.locale;",
    "}",
    ...(switchable ? switchableRuntime() : singleRuntime()),
    "",
    "/// Translate a message key in the ACTIVE locale, falling back to the",
    "/// source-language default, then ICU-format its placeholders from [values].",
    "String t(String key, String defaultMessage, [Map<String, Object>? values]) =>",
    "    _format(_catalogs[locale]?[key] ?? defaultMessage, values);",
    "",
    "/// Translate a RICH-TEXT message — one sentence whose emphasis is carried as",
    "/// `<b>` / `<i>` / `<code>` tags, so a locale can reorder the parts — into a",
    "/// [Text.rich].  The tags become private marker characters before the ICU step,",
    "/// so they never reach `MessageFormat` and a hole VALUE can never forge one.",
    "Widget tRich(String key, String defaultMessage, [Map<String, Object>? values]) {",
    "  final String message = (_catalogs[locale]?[key] ?? defaultMessage).replaceAllMapped(",
    "      RegExp(r'<(/?)(b|i|code)>'), (Match m) => '\\uE000${m[1]}${m[2]}\\uE001');",
    "  final Map<String, Object>? safe = values?.map((String k, Object v) => MapEntry<String, Object>(",
    "      k, v is String ? v.replaceAll(RegExp('[\\uE000\\uE001]'), '') : v));",
    "  final String text = _format(message, safe);",
    "  final List<InlineSpan> spans = <InlineSpan>[];",
    "  bool bold = false;",
    "  bool italic = false;",
    "  bool code = false;",
    "  void emit(String s) {",
    "    if (s.isEmpty) return;",
    "    spans.add(TextSpan(",
    "      text: s,",
    "      style: TextStyle(",
    "        fontWeight: bold ? FontWeight.bold : null,",
    "        fontStyle: italic ? FontStyle.italic : null,",
    "        fontFamily: code ? 'monospace' : null,",
    "      ),",
    "    ));",
    "  }",
    "  int last = 0;",
    "  for (final Match m in RegExp('\\uE000(/?)(b|i|code)\\uE001').allMatches(text)) {",
    "    emit(text.substring(last, m.start));",
    "    final bool on = m[1] != '/';",
    "    switch (m[2]) {",
    "      case 'b':",
    "        bold = on;",
    "      case 'i':",
    "        italic = on;",
    "      default:",
    "        code = on;",
    "    }",
    "    last = m.end;",
    "  }",
    "  emit(text.substring(last));",
    "  return Text.rich(TextSpan(children: spans));",
    "}",
    "",
    "/// ICU-format [message] against [values]; a value-less message returns verbatim.",
    "String _format(String message, Map<String, Object>? values) {",
    "  if (values == null || values.isEmpty) return message;",
    "  try {",
    ordinals
      ? "    final _Icu icu = _resolveFormats(_resolveOrdinals(message, values), values);"
      : "    final _Icu icu = _resolveFormats(message, values);",
    "    return MessageFormat(icu.message, locale: locale).format(icu.values);",
    "  } catch (_) {",
    "    // A message `MessageFormat` genuinely rejects degrades rather than",
    "    // crashing a widget build: substitute the raw values and render what is",
    "    // left.  (The `, number` / `, date` arg-types it does not implement are",
    "    // already resolved by `_resolveFormats` above — they never reach here.)",
    "    return _substitute(message, values);",
    "  }",
    "}",
    "",
    ...(ordinals ? ordinalRuntime(entries.map((e) => e.tag)) : []),
    "/// A message rewritten into what `MessageFormat` can render, plus the values",
    "/// to render it with — the originals plus one entry per pre-formatted hole.",
    "class _Icu {",
    "  const _Icu(this.message, this.values);",
    "  final String message;",
    "  final Map<String, Object> values;",
    "}",
    "",
    "/// `{name, number|date|time[, style]}` — the ICU arg-types `MessageFormat`",
    "/// does not implement.  The style is brace-free by construction (a skeleton or",
    "/// a pattern), which is what keeps this from matching a plural/select body.",
    "final RegExp _formatArg =",
    "    RegExp(r'\\{([A-Za-z_][A-Za-z0-9_]*)\\s*,\\s*(number|date|time)\\s*(?:,([^{}]*))?\\}');",
    "",
    "/// Format every `, number` / `, date` / `, time` hole through `intl` and swap",
    "/// it for a plain placeholder carrying the formatted text.  Handing",
    "/// `MessageFormat` a VALUE rather than splicing the text into the pattern keeps",
    "/// a formatted `{` or `#` out of the syntax it re-parses.  A hole whose value",
    "/// is missing or of the wrong runtime type degrades to a bare `{name}` — the",
    "/// raw value, which is what pre-i18n Flutter rendered.",
    "_Icu _resolveFormats(String message, Map<String, Object> values) {",
    "  if (!message.contains(',')) return _Icu(message, values);",
    "  final Map<String, Object> resolved = Map<String, Object>.of(values);",
    "  int next = 0;",
    "  final String rewritten = message.replaceAllMapped(_formatArg, (Match m) {",
    "    final String name = m[1]!;",
    "    final Object? value = values[name];",
    "    final String? text =",
    "        value == null ? null : _formatValue(m[2]!, (m[3] ?? '').trim(), value);",
    "    if (text == null) return '{$name}';",
    "    final String hole = 'loomFmt${next++}';",
    "    resolved[hole] = text;",
    "    return '{$hole}';",
    "  });",
    "  return _Icu(rewritten, resolved);",
    "}",
    "",
    "/// One formatted hole, or null when the value cannot be formatted that way",
    "/// (the caller then degrades the hole to its raw value).",
    "String? _formatValue(String type, String style, Object value) {",
    "  try {",
    "    if (type == 'number') {",
    "      final num? n = value is num ? value : num.tryParse(value.toString());",
    "      return n == null ? null : _numberFormat(style).format(n);",
    "    }",
    "    final DateTime? at =",
    "        value is DateTime ? value : DateTime.tryParse(value.toString());",
    "    if (at == null) return null;",
    "    return (type == 'date' ? _dateFormat(style) : _timeFormat(style)).format(at);",
    "  } catch (_) {",
    "    return null;",
    "  }",
    "}",
    "",
    "/// `NumberFormat` for an ICU number style: a skeleton (`::currency/USD`), one",
    "/// of the classic style keywords, or an explicit pattern (`#,##0.00`).",
    "NumberFormat _numberFormat(String style) {",
    "  if (style.startsWith('::')) return _numberSkeleton(style.substring(2).trim());",
    "  switch (style) {",
    "    case 'integer':",
    "      return _withFractionDigits(NumberFormat.decimalPattern(locale), 0, 0);",
    "    case 'percent':",
    "      return NumberFormat.percentPattern(locale);",
    "    case 'currency':",
    "      return NumberFormat.simpleCurrency(locale: locale);",
    "    case '':",
    "    case 'decimal':",
    "      return NumberFormat.decimalPattern(locale);",
    "    default:",
    "      return NumberFormat(style, locale);",
    "  }",
    "}",
    "",
    "/// The number-skeleton stems a `, number, ::…` hole uses.  An unrecognised",
    "/// stem is ignored rather than fatal — the number still renders",
    "/// locale-formatted.",
    "NumberFormat _numberSkeleton(String skeleton) {",
    "  NumberFormat? format;",
    "  int? minFraction;",
    "  int? maxFraction;",
    "  for (final String stem in skeleton.split(RegExp(r'\\s+'))) {",
    "    if (stem == 'currency') {",
    "      format = NumberFormat.simpleCurrency(locale: locale);",
    "    } else if (stem.startsWith('currency/')) {",
    "      format =",
    "          NumberFormat.simpleCurrency(locale: locale, name: stem.substring(9));",
    "    } else if (stem == 'percent') {",
    "      format = NumberFormat.percentPattern(locale);",
    "    } else if (stem == 'compact' || stem == 'compact-short') {",
    "      format = NumberFormat.compact(locale: locale);",
    "    } else if (stem == 'compact-long') {",
    "      format = NumberFormat.compactLong(locale: locale);",
    "    } else if (stem == 'integer' || stem == 'precision-integer') {",
    "      minFraction = 0;",
    "      maxFraction = 0;",
    "    } else if (RegExp(r'^\\.0*#*$').hasMatch(stem)) {",
    "      // `.00` → exactly two digits; `.0#` → one to two; `.##` → up to two.",
    "      minFraction = '0'.allMatches(stem).length;",
    "      maxFraction = stem.length - 1;",
    "    }",
    "  }",
    "  return _withFractionDigits(",
    "      format ?? NumberFormat.decimalPattern(locale), minFraction, maxFraction);",
    "}",
    "",
    "NumberFormat _withFractionDigits(NumberFormat format, int? min, int? max) {",
    "  if (max != null) format.maximumFractionDigits = max;",
    "  if (min != null) format.minimumFractionDigits = min;",
    "  return format;",
    "}",
    "",
    "/// `DateFormat` for an ICU date style — a skeleton (`::yMMMd`), one of the",
    "/// four classic widths, or an explicit pattern.",
    "DateFormat _dateFormat(String style) {",
    "  if (style.startsWith('::')) {",
    "    return _localizedDate((String? l) => DateFormat(style.substring(2).trim(), l));",
    "  }",
    "  switch (style) {",
    "    case 'short':",
    "      return _localizedDate(DateFormat.yMd);",
    "    case 'long':",
    "      return _localizedDate(DateFormat.yMMMMd);",
    "    case 'full':",
    "      return _localizedDate(DateFormat.yMMMMEEEEd);",
    "    case '':",
    "    case 'medium':",
    "      return _localizedDate(DateFormat.yMMMd);",
    "    default:",
    "      return _localizedDate((String? l) => DateFormat(style, l));",
    "  }",
    "}",
    "",
    "/// The `, time` twin of [_dateFormat].",
    "DateFormat _timeFormat(String style) {",
    "  if (style.startsWith('::')) {",
    "    return _localizedDate((String? l) => DateFormat(style.substring(2).trim(), l));",
    "  }",
    "  switch (style) {",
    "    case 'medium':",
    "    case 'long':",
    "    case 'full':",
    "      return _localizedDate(DateFormat.jms);",
    "    case '':",
    "    case 'short':",
    "      return _localizedDate(DateFormat.jm);",
    "    default:",
    "      return _localizedDate((String? l) => DateFormat(style, l));",
    "  }",
    "}",
    "",
    "/// Build a `DateFormat` in the active locale, falling back to the SDK default",
    "/// when that locale's date symbols were never initialized.  `intl` loads date",
    "/// data lazily (`initializeDateFormatting`) — unlike number symbols, which are",
    "/// compiled in — so a `, date` hole must not fail just because `main()` never",
    "/// initialized this locale.",
    "DateFormat _localizedDate(DateFormat Function(String?) build) {",
    "  try {",
    "    return build(locale);",
    "  } catch (_) {",
    "    return build(null);",
    "  }",
    "}",
    "",
    "String _substitute(String message, Map<String, Object> values) {",
    "  String out = message;",
    "  values.forEach((String name, Object value) {",
    "    out = out.replaceAll(",
    // Interpolated rather than `+`-composed so the emitted file is clean under
    // the generated `analysis_options.yaml` (`prefer_interpolation_to_compose_strings`).
    "      RegExp('\\\\{${RegExp.escape(name)}(,[^{}]*)?\\\\}'),",
    "      value.toString(),",
    "    );",
    "  });",
    "  return out;",
    "}",
  );
}

/** The `{n, selectordinal, …}` pre-pass: each shipped locale's CLDR ordinal
 *  table (computed here, on Node, which has the rules) and the brace-aware
 *  splice that resolves an ordinal block before `MessageFormat` — which would
 *  otherwise select its branch by the cardinal rules. */
function ordinalRuntime(tags: readonly string[]): string[] {
  const tables = tags.flatMap((tag) => {
    const table = ordinalTable(tag);
    return table ? [[tag, table] as const] : [];
  });
  return [
    "/// Each shipped locale's CLDR ORDINAL categories, tabulated when the app was",
    "/// generated — `package:intl` has no ordinal rules.  One letter per integer",
    "/// (z zero, o one, t two, f few, m many, x other): `prefix[n]` below the",
    "/// prefix's length, else `cycle[(n - prefix.length) % cycle.length]`.",
    "const Map<String, List<String>> _ordinalTables = <String, List<String>>{",
    ...tables.map(
      ([tag, t]) =>
        `  ${dartStringLit(tag)}: <String>[${dartStringLit(t.prefix)}, ${dartStringLit(t.cycle)}],`,
    ),
    "};",
    "",
    "const Map<String, String> _ordinalCategories = <String, String>{",
    "  'z': 'zero',",
    "  'o': 'one',",
    "  't': 'two',",
    "  'f': 'few',",
    "  'm': 'many',",
    "  'x': 'other',",
    "};",
    "",
    "/// The active locale's ordinal category for [value].",
    "String _ordinalCategory(num value) {",
    "  final List<String>? table = _ordinalTables[locale];",
    "  if (table == null) {",
    "    return 'other';",
    "  }",
    "  final int n = value.abs().truncate();",
    "  final String prefix = table[0];",
    "  final String cycle = table[1];",
    "  final String letter =",
    "      n < prefix.length ? prefix[n] : cycle[(n - prefix.length) % cycle.length];",
    "  return _ordinalCategories[letter] ?? 'other';",
    "}",
    "",
    "final RegExp _ordinalHead =",
    "    RegExp(r'\\{\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*,\\s*selectordinal\\s*,');",
    "",
    "/// Resolve every `{name, selectordinal, …}` block before `MessageFormat` sees",
    "/// the message: pick the branch (`=N`, then the locale's ordinal category,",
    "/// then `other`), put the locale-formatted number in place of the branch's own",
    "/// `#`, and splice the branch text in.  A block whose value is missing or not",
    "/// a number, or whose body does not parse, is left for `MessageFormat`.",
    "String _resolveOrdinals(String message, Map<String, Object> values) {",
    "  if (!message.contains('selectordinal')) {",
    "    return message;",
    "  }",
    "  final StringBuffer out = StringBuffer();",
    "  int i = 0;",
    "  while (i < message.length) {",
    '    if (message[i] == "\'") {',
    "      final int end = _quoteEnd(message, i);",
    "      out.write(message.substring(i, end));",
    "      i = end;",
    "      continue;",
    "    }",
    "    final Match? head =",
    "        message[i] == '{' ? _ordinalHead.matchAsPrefix(message, i) : null;",
    "    final Object? raw = head == null ? null : values[head[1]!];",
    "    final num? n = raw is num ? raw : num.tryParse(raw?.toString() ?? '');",
    "    final _Branches? block = head == null || n == null ? null : _branches(message, head.end);",
    "    if (block == null || n == null) {",
    "      out.write(message[i]);",
    "      i += 1;",
    "      continue;",
    "    }",
    "    final String? exact = n == n.truncate() ? block.options['=${n.truncate()}'] : null;",
    "    final String body = exact ?? block.options[_ordinalCategory(n)] ?? block.options['other']!;",
    "    out.write(_replacePound(body, NumberFormat.decimalPattern(locale).format(n)));",
    "    i = block.end;",
    "  }",
    "  return out.toString();",
    "}",
    "",
    "/// The branches of a choice block whose selectors start at [start], and the",
    "/// index just past its closing brace; null when the body does not parse or has",
    "/// no `other` branch.",
    "class _Branches {",
    "  const _Branches(this.options, this.end);",
    "  final Map<String, String> options;",
    "  final int end;",
    "}",
    "",
    "final RegExp _selector = RegExp(r'\\s*(=?[A-Za-z0-9_]+)\\s*\\{');",
    "",
    "_Branches? _branches(String s, int start) {",
    "  final Map<String, String> options = <String, String>{};",
    "  int i = start;",
    "  while (true) {",
    "    while (i < s.length && s[i].trim().isEmpty) {",
    "      i += 1;",
    "    }",
    "    if (i >= s.length) {",
    "      return null;",
    "    }",
    "    if (s[i] == '}') {",
    "      break;",
    "    }",
    "    final Match? m = _selector.matchAsPrefix(s, i);",
    "    if (m == null) {",
    "      return null;",
    "    }",
    "    int depth = 1;",
    "    int j = m.end;",
    "    while (j < s.length && depth > 0) {",
    '      if (s[j] == "\'") {',
    "        j = _quoteEnd(s, j);",
    "        continue;",
    "      }",
    "      if (s[j] == '{') {",
    "        depth += 1;",
    "      } else if (s[j] == '}') {",
    "        depth -= 1;",
    "      }",
    "      j += 1;",
    "    }",
    "    if (depth != 0) {",
    "      return null;",
    "    }",
    "    options[m[1]!] = s.substring(m.end, j - 1);",
    "    i = j;",
    "  }",
    "  return options.containsKey('other') ? _Branches(options, i + 1) : null;",
    "}",
    "",
    "/// The index just past an ICU apostrophe at [i]: `''` is one literal quote, a",
    "/// quote before `{`, `}` or `#` opens a literal run up to the next lone quote,",
    "/// and any other quote is itself literal.",
    "int _quoteEnd(String s, int i) {",
    "  if (i + 1 >= s.length) {",
    "    return i + 1;",
    "  }",
    "  final String next = s[i + 1];",
    '  if (next == "\'") {',
    "    return i + 2;",
    "  }",
    "  if (next != '{' && next != '}' && next != '#') {",
    "    return i + 1;",
    "  }",
    "  int j = i + 1;",
    "  while (j < s.length) {",
    '    if (s[j] == "\'") {',
    '      if (j + 1 < s.length && s[j + 1] == "\'") {',
    "        j += 2;",
    "        continue;",
    "      }",
    "      return j + 1;",
    "    }",
    "    j += 1;",
    "  }",
    "  return j;",
    "}",
    "",
    "/// [body] with each `#` of ITS OWN level (not one inside a nested block or a",
    "/// quoted run) replaced by [number].",
    "String _replacePound(String body, String number) {",
    "  final StringBuffer out = StringBuffer();",
    "  int depth = 0;",
    "  int i = 0;",
    "  while (i < body.length) {",
    "    final String c = body[i];",
    '    if (c == "\'") {',
    "      final int end = _quoteEnd(body, i);",
    "      out.write(body.substring(i, end));",
    "      i = end;",
    "      continue;",
    "    }",
    "    if (c == '{') {",
    "      depth += 1;",
    "    } else if (c == '}') {",
    "      depth -= 1;",
    "    }",
    "    out.write(c == '#' && depth == 0 ? number : c);",
    "    i += 1;",
    "  }",
    "  return out.toString();",
    "}",
    "",
  ];
}

/** A single-language app has nothing to negotiate, store or switch between: the
 *  locale stays the source and the widget a primitive names renders nothing. */
function singleRuntime(): string[] {
  return [
    "",
    "/// A single-language app has nothing to switch between.",
    "class LocaleSwitcher extends StatelessWidget {",
    "  const LocaleSwitcher({super.key});",
    "",
    "  @override",
    "  Widget build(BuildContext context) => const SizedBox.shrink();",
    "}",
  ];
}

/** The runtime half of an app that ships two or more locales: negotiation, the
 *  stored choice, the switch and the picker widget. */
function switchableRuntime(): string[] {
  return [
    "",
    "const String _storageKey = 'loom.locale';",
    "",
    "/// `MaterialApp.supportedLocales` — every shipped locale.",
    "final List<Locale> supportedLocales = <Locale>[",
    "  for (final LocaleInfo info in locales) info.locale,",
    "];",
    "",
    "/// `MaterialApp.localizationsDelegates` — the framework's own strings",
    "/// (date pickers, tooltips, text direction) in the active locale.",
    "const List<LocalizationsDelegate<dynamic>> localizationsDelegates =",
    "    <LocalizationsDelegate<dynamic>>[",
    "  GlobalMaterialLocalizations.delegate,",
    "  GlobalWidgetsLocalizations.delegate,",
    "  GlobalCupertinoLocalizations.delegate,",
    "];",
    "",
    "/// The locale this run starts in: the URL's `?lang=` (web only — a native app",
    "/// has no address bar), the stored choice, the platform's locales in order,",
    "/// then the source language.",
    "String _negotiate(String? stored) {",
    "  final List<String> candidates = <String>[];",
    "  if (kIsWeb) {",
    "    final String? lang = Uri.base.queryParameters['lang'];",
    "    if (lang != null && lang.isNotEmpty) candidates.add(lang);",
    "  }",
    "  if (stored != null && stored.isNotEmpty) candidates.add(stored);",
    "  for (final ui.Locale platform in ui.PlatformDispatcher.instance.locales) {",
    "    candidates.add(platform.toLanguageTag());",
    "  }",
    "  return matchLocale(candidates) ?? sourceLocale;",
    "}",
    "",
    "/// Point the notifier and `Intl.defaultLocale` at [tag], so every default",
    "/// `NumberFormat` / `DateFormat` the generated pages build follows it.",
    "void _apply(String tag) {",
    "  Intl.defaultLocale = Intl.canonicalizedLocale(tag);",
    "  localeNotifier.value = tag;",
    "}",
    "",
    "/// Negotiate the starting locale and load date symbols for every shipped",
    "/// locale.  Awaited from `main()` before the first frame.",
    "Future<void> initLocale() async {",
    "  String? stored;",
    "  try {",
    "    stored = (await SharedPreferences.getInstance()).getString(_storageKey);",
    "  } catch (_) {",
    "    // storage unavailable: negotiate without the stored choice",
    "  }",
    "  for (final LocaleInfo info in locales) {",
    "    try {",
    "      await initializeDateFormatting(Intl.canonicalizedLocale(info.tag));",
    "    } catch (_) {",
    "      // no date symbols for this locale: its dates use the SDK default",
    "    }",
    "  }",
    "  _apply(_negotiate(stored));",
    "}",
    "",
    "Future<void> _persist(String tag) async {",
    "  try {",
    "    await (await SharedPreferences.getInstance()).setString(_storageKey, tag);",
    "  } catch (_) {",
    "    // storage unavailable: the choice lasts for this run only",
    "  }",
    "}",
    "",
    "/// `t` is a plain function, so no widget subscribes to the locale by itself:",
    "/// mark the whole element tree dirty and every `t()` call re-runs.",
    "void _rebuildAll() {",
    "  void rebuild(Element element) {",
    "    element.markNeedsBuild();",
    "    element.visitChildren(rebuild);",
    "  }",
    "",
    "  WidgetsBinding.instance.rootElement?.visitChildren(rebuild);",
    "}",
    "",
    "/// Switch the active locale: persist the choice, update `Intl.defaultLocale`,",
    "/// notify `localeNotifier` (which re-lays `MaterialApp` out in the new",
    "/// locale and direction) and rebuild every `t()` call.  A tag that names no",
    "/// shipped locale is ignored.",
    "void setLocale(String tag) {",
    "  final String? next = matchLocale(<String>[tag]);",
    "  if (next == null) return;",
    "  unawaited(_persist(next));",
    "  if (next == localeNotifier.value) return;",
    "  _apply(next);",
    "  _rebuildAll();",
    "}",
    "",
    "/// The language picker: a dropdown of the shipped locales, each labelled with",
    "/// the locale's OWN name.",
    "class LocaleSwitcher extends StatelessWidget {",
    "  const LocaleSwitcher({super.key});",
    "",
    "  @override",
    "  Widget build(BuildContext context) {",
    "    return ValueListenableBuilder<String>(",
    "      valueListenable: localeNotifier,",
    "      builder: (BuildContext context, String tag, Widget? _) => DropdownButton<String>(",
    "        key: const ValueKey<String>('locale-switcher'),",
    "        value: tag,",
    "        underline: const SizedBox.shrink(),",
    "        onChanged: (String? next) {",
    "          if (next != null) setLocale(next);",
    "        },",
    "        items: <DropdownMenuItem<String>>[",
    "          for (final LocaleInfo info in locales)",
    "            DropdownMenuItem<String>(",
    "              value: info.tag,",
    "              child: Directionality(textDirection: info.dir, child: Text(info.name)),",
    "            ),",
    "        ],",
    "      ),",
    "    );",
    "  }",
    "}",
  ];
}
