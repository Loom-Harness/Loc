// ---------------------------------------------------------------------------
// Imports derived from use — the language-neutral half (M-T9.84; design:
// docs/new-plan/missions/M-T9.84-derived-imports.md).
//
// An emitter writes a reference to an importable symbol through `ref(sym)`.
// The result is a MARKER — a private-use-area token carrying the symbol — not
// the final spelling.  Markers are plain string content, so they ride through
// every string-returning helper (`lines(...)`, `indent(...)`, the `ExprTarget`
// leaves, type renderers) unchanged.  Each emitted module is finalized once
// by its language's finalizer (`finalizePyModule`, …), which collects the
// markers that SURVIVED into the module's text, replaces each with the
// symbol's spelling, and derives the import block from exactly that set.
// An import therefore exists iff its usage is in the file: the two cannot
// drift, and text an emitter rendered and then discarded leaves no import.
//
// Spelling is context-free (`alias ?? name`, or `alias ?? module` for a
// whole-module import), fixed on the handle — this seam never allocates or
// renames.  A collision is a thrown error, fixed by declaring an alias.
// ---------------------------------------------------------------------------

/** A language tag — one finalizer per tag. */
export type ImportLang = "py";

/** A typed handle on an importable symbol. */
export interface ImportSymbol {
  readonly lang: ImportLang;
  /** The module (python dotted path) the symbol is imported from. */
  readonly module: string;
  /** The imported member; absent for a whole-module import (`import re`). */
  readonly name?: string;
  /** The local binding (`from m import N as alias` / `import m as alias`). */
  readonly alias?: string;
}

const OPEN = "";
const CLOSE = "";
const SEP = "|";

/** Every marker in a text. Module / name / alias never contain `|` or the
 *  private-use delimiters, so the token grammar is unambiguous. */
const MARKER_RE = /([a-z]+)\|([^|]*)\|([^|]*)\|([^|]*)/g;

const IDENT_PATH = /^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)*$/;
const IDENT = /^[A-Za-z_][\w]*$/;

function check(sym: ImportSymbol): ImportSymbol {
  if (!IDENT_PATH.test(sym.module)) throw new Error(`import symbol: bad module '${sym.module}'`);
  if (sym.name !== undefined && !IDENT.test(sym.name)) {
    throw new Error(`import symbol: bad name '${sym.name}' (from ${sym.module})`);
  }
  if (sym.alias !== undefined && !IDENT.test(sym.alias)) {
    throw new Error(`import symbol: bad alias '${sym.alias}' (for ${sym.module})`);
  }
  return sym;
}

/** Write a reference to `sym`: returns the marker that the module's
 *  finalizer turns into the spelling AND an import line. */
export function ref(sym: ImportSymbol): string {
  check(sym);
  return `${OPEN}${sym.lang}${SEP}${sym.module}${SEP}${sym.name ?? ""}${SEP}${sym.alias ?? ""}${CLOSE}`;
}

/** The spelling a reference to `sym` resolves to. */
export function spelling(sym: ImportSymbol): string {
  if (sym.alias !== undefined) return sym.alias;
  return sym.name ?? sym.module;
}

/** The name `sym`'s import binds in the module namespace (`import a.b`
 *  binds `a`) — the key the collision check runs on. */
export function binding(sym: ImportSymbol): string {
  if (sym.alias !== undefined) return sym.alias;
  return sym.name ?? sym.module.split(".")[0]!;
}

/** A stable identity for de-duplication. */
export function symbolKey(sym: ImportSymbol): string {
  return `${sym.lang}${SEP}${sym.module}${SEP}${sym.name ?? ""}${SEP}${sym.alias ?? ""}`;
}

function decode(lang: string, module: string, name: string, alias: string): ImportSymbol {
  return {
    lang: lang as ImportLang,
    module,
    ...(name !== "" ? { name } : {}),
    ...(alias !== "" ? { alias } : {}),
  };
}

/** Resolve every marker in `text` to its spelling and return the distinct
 *  symbols that were referenced (in first-use order). */
export function resolveMarkers(text: string): { text: string; used: ImportSymbol[] } {
  const seen = new Map<string, ImportSymbol>();
  const out = text.replace(
    MARKER_RE,
    (_m, lang: string, mod: string, name: string, alias: string) => {
      const sym = decode(lang, mod, name, alias);
      const key = symbolKey(sym);
      if (!seen.has(key)) seen.set(key, sym);
      return spelling(sym);
    },
  );
  if (out.includes(OPEN) || out.includes(CLOSE)) {
    throw new Error("import marker: malformed marker left after resolution");
  }
  return { text: out, used: [...seen.values()] };
}

/** Spell every marker without deriving imports — for a fragment of a module
 *  that is matched against the finalized text (source-map fragments). */
export function spellMarkers(text: string): string {
  return resolveMarkers(text).text;
}

/** True when the text still carries an unresolved import marker. */
export function hasMarkers(text: string): boolean {
  return text.includes(OPEN);
}

/** Fail closed: a marker that reaches an emitted file means its module was
 *  never finalized, so its import was never written. */
export function assertNoMarkers(path: string, content: string): void {
  if (hasMarkers(content)) {
    const at = content.indexOf(OPEN);
    const line = content.slice(0, at).split("\n").length;
    throw new Error(
      `${path}:${line}: unresolved import marker — the module was emitted without its finalizer (M-T9.84)`,
    );
  }
}
