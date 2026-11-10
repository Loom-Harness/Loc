// ---------------------------------------------------------------------------
// Translation exchange formats — XLIFF 1.2 and gettext PO — for handing a
// locale to a TMS (Crowdin, Lokalise, Weblate, Phrase) and taking it back.
//
// Pure: renders `ExchangeUnit`s to text and parses text back to
// `ImportedUnit`s.  Deciding WHICH units exist and what an import changes is the
// CLI's job (`src/cli/i18n/exchange.ts`).  The unit id is the full runtime key
// (`WebApp.page.Home.heading.k2f`), unique across the whole tree; PO carries it
// as `msgctxt`, because identical English at two keys must stay two entries.
// ---------------------------------------------------------------------------

export type UnitState = "new" | "translated" | "needs-review";

export interface ExchangeUnit {
  /** Full runtime key. */
  key: string;
  /** Namespace file the key lives in (`WebApp`, `_chrome`, …). */
  namespace: string;
  source: string;
  /** The current translation; absent when untranslated. */
  target?: string;
  state: UnitState;
  /** Translator-facing context lines (`family: page`, `page: Home`, …). */
  notes: string[];
  /** Where the string was written in the `.ddd` source. */
  locations?: readonly { file: string; line: number }[];
  previousSource?: string;
  previousTranslation?: string;
}

export interface ImportedUnit {
  key: string;
  target: string;
  state: UnitState;
  previousSource?: string;
}

export interface ParsedExchange {
  /** Target language named by the file, when it names one. */
  locale?: string;
  units: ImportedUnit[];
}

/** Context lines derived from a key's shape: the family (`page`, `component`,
 *  `menu`, `chrome`, `pack`, `msg`, `text`, …), and for authored UI keys the
 *  page / component and the slot role. */
export function contextNotes(key: string, namespace: string, source: string): string[] {
  const fileKey =
    namespace === "_chrome" || namespace === "_system" ? key : key.slice(namespace.length + 1);
  const parts = fileKey.split(".");
  const notes: string[] = [];
  const family = parts[0] ?? "";
  if (family) notes.push(`family: ${family}`);
  if (namespace !== "_chrome") notes.push(`namespace: ${namespace}`);
  if ((family === "page" || family === "component" || family === "menu") && parts.length >= 3) {
    notes.push(`${family === "menu" ? "menu" : family}: ${parts[1]}`);
    if (parts.length >= 4) notes.push(`slot: ${parts[2]}`);
  } else if (family === "pack" && parts.length >= 3) {
    notes.push(`design pack: ${parts[1]}`);
    notes.push(`slot: ${parts[2]}`);
  }
  notes.push(`key: ${key}`);
  notes.push(`source length: ${[...source].length}`);
  return notes;
}

// ---- XML helpers ----------------------------------------------------------

const xmlEscape = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function xmlUnescape(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

const XLIFF_TARGET_STATE: Record<UnitState, string | undefined> = {
  new: undefined,
  translated: "translated",
  "needs-review": "needs-review-translation",
};

/** Render an XLIFF 1.2 document: one `<file>` per namespace. */
export function renderXliff(
  units: readonly ExchangeUnit[],
  opts: { sourceLocale: string; targetLocale: string },
): string {
  const byNs = new Map<string, ExchangeUnit[]>();
  for (const u of units) {
    const bucket = byNs.get(u.namespace);
    if (bucket) bucket.push(u);
    else byNs.set(u.namespace, [u]);
  }
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">',
  ];
  for (const [ns, list] of [...byNs].sort(([a], [b]) => a.localeCompare(b))) {
    out.push(
      `  <file original="${xmlEscape(ns)}" source-language="${xmlEscape(opts.sourceLocale)}" target-language="${xmlEscape(opts.targetLocale)}" datatype="plaintext">`,
      "    <body>",
    );
    for (const u of list) {
      out.push(`      <trans-unit id="${xmlEscape(u.key)}" xml:space="preserve">`);
      out.push(`        <source>${xmlEscape(u.source)}</source>`);
      const state = XLIFF_TARGET_STATE[u.state];
      if (u.target !== undefined && state) {
        out.push(`        <target state="${state}">${xmlEscape(u.target)}</target>`);
      }
      for (const loc of u.locations ?? []) {
        out.push(
          '        <context-group purpose="location">',
          `          <context context-type="sourcefile">${xmlEscape(loc.file)}</context>`,
          `          <context context-type="linenumber">${loc.line}</context>`,
          "        </context-group>",
        );
      }
      for (const n of u.notes) out.push(`        <note from="loom">${xmlEscape(n)}</note>`);
      if (u.previousSource !== undefined) {
        out.push(`        <note from="loom-previous-source">${xmlEscape(u.previousSource)}</note>`);
      }
      if (u.previousTranslation !== undefined) {
        out.push(
          `        <note from="loom-previous-translation">${xmlEscape(u.previousTranslation)}</note>`,
        );
      }
      out.push("      </trans-unit>");
    }
    out.push("    </body>", "  </file>");
  }
  out.push("</xliff>", "");
  return out.join("\n");
}

/** Parse the XLIFF 1.2 a TMS hands back.  Only what an import needs: the
 *  target language, and per `<trans-unit>` its id, `<target>` text + state and
 *  the previous-source note. */
export function parseXliff(text: string): ParsedExchange {
  const locale = /<file\b[^>]*\btarget-language="([^"]*)"/.exec(text)?.[1];
  const units: ImportedUnit[] = [];
  const unitRe = /<trans-unit\b([^>]*)>([\s\S]*?)<\/trans-unit>/g;
  for (const m of text.matchAll(unitRe)) {
    const id = /\bid="([^"]*)"/.exec(m[1]!)?.[1];
    if (id === undefined) continue;
    const body = m[2]!;
    const target = /<target\b([^>]*?)(?:\/>|>([\s\S]*?)<\/target>)/.exec(body);
    const prev = /<note\b[^>]*from="loom-previous-source"[^>]*>([\s\S]*?)<\/note>/.exec(body)?.[1];
    if (!target) continue;
    const attrs = target[1] ?? "";
    const stateAttr = /\bstate="([^"]*)"/.exec(attrs)?.[1];
    const value = xmlUnescape(target[2] ?? "");
    let state: UnitState = "translated";
    if (stateAttr === "needs-review-translation" || stateAttr === "needs-review-l10n") {
      state = "needs-review";
    } else if (stateAttr === "new" || stateAttr === "needs-translation") {
      state = "new";
    }
    units.push({
      key: xmlUnescape(id),
      target: value,
      state,
      ...(prev !== undefined ? { previousSource: xmlUnescape(prev) } : {}),
    });
  }
  return { ...(locale !== undefined ? { locale: xmlUnescape(locale) } : {}), units };
}

// ---- PO -------------------------------------------------------------------

const poQuote = (s: string): string =>
  `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t")}"`;

function poUnquote(s: string): string {
  const inner = s.trim().slice(1, -1);
  return inner.replace(/\\(["\\nt])/g, (_m, c: string) =>
    c === "n" ? "\n" : c === "t" ? "\t" : c,
  );
}

/** Render a gettext PO file.  `msgctxt` is the key; a needs-review unit is
 *  `#, fuzzy` with the previous source as `#| msgid`. */
export function renderPo(units: readonly ExchangeUnit[], opts: { targetLocale: string }): string {
  const out: string[] = [
    'msgid ""',
    'msgstr ""',
    '"Content-Type: text/plain; charset=UTF-8\\n"',
    '"Content-Transfer-Encoding: 8bit\\n"',
    `"Language: ${opts.targetLocale}\\n"`,
    '"Generated-By: ddd i18n export\\n"',
    "",
  ];
  for (const u of units) {
    for (const n of u.notes) out.push(`#. ${n.replace(/\n/g, " ")}`);
    for (const loc of u.locations ?? []) out.push(`#: ${loc.file.replace(/\s/g, "_")}:${loc.line}`);
    if (u.previousTranslation !== undefined) {
      out.push(`#. previous translation: ${u.previousTranslation.replace(/\n/g, " ")}`);
    }
    if (u.state === "needs-review") out.push("#, fuzzy");
    if (u.previousSource !== undefined) out.push(`#| msgid ${poQuote(u.previousSource)}`);
    out.push(
      `msgctxt ${poQuote(u.key)}`,
      `msgid ${poQuote(u.source)}`,
      `msgstr ${poQuote(u.target ?? "")}`,
      "",
    );
  }
  return out.join("\n");
}

/** Parse a PO file: `msgctxt` is the key; an empty `msgstr` is untranslated. */
export function parsePo(text: string): ParsedExchange {
  const units: ImportedUnit[] = [];
  let locale: string | undefined;
  let ctx: string | undefined;
  let id: string | undefined;
  let str: string | undefined;
  let field: "ctx" | "id" | "str" | "prev" | undefined;
  let fuzzy = false;
  let prev: string | undefined;

  const commit = () => {
    if (id === "" && ctx === undefined && str !== undefined) {
      locale = /^Language:\s*(.+)$/m.exec(str)?.[1]?.trim() ?? locale;
    } else if (ctx !== undefined && str !== undefined) {
      units.push({
        key: ctx,
        target: str,
        state: str === "" ? "new" : fuzzy ? "needs-review" : "translated",
        ...(prev !== undefined ? { previousSource: prev } : {}),
      });
    }
    ctx = id = str = prev = undefined;
    fuzzy = false;
    field = undefined;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") {
      commit();
    } else if (line.startsWith("#,")) {
      if (/\bfuzzy\b/.test(line)) fuzzy = true;
    } else if (line.startsWith("#|")) {
      const m = /^#\|\s*msgid\s+(".*")$/.exec(line);
      if (m) prev = poUnquote(m[1]!);
    } else if (line.startsWith("#")) {
      // translator / extracted comment: not data
    } else if (line.startsWith("msgctxt ")) {
      if (str !== undefined) commit();
      ctx = poUnquote(line.slice("msgctxt ".length));
      field = "ctx";
    } else if (line.startsWith("msgid ")) {
      if (str !== undefined) commit();
      id = poUnquote(line.slice("msgid ".length));
      field = "id";
    } else if (line.startsWith("msgstr ")) {
      str = poUnquote(line.slice("msgstr ".length));
      field = "str";
    } else if (line.startsWith('"')) {
      const piece = poUnquote(line);
      if (field === "ctx") ctx = (ctx ?? "") + piece;
      else if (field === "id") id = (id ?? "") + piece;
      else if (field === "str") str = (str ?? "") + piece;
    }
  }
  commit();
  return { ...(locale !== undefined ? { locale } : {}), units };
}
