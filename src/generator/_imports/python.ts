// ---------------------------------------------------------------------------
// Imports derived from use — python (M-T9.84).  Symbol constructors and the
// module finalizer: resolves `ref()` markers, merges the module's remaining
// hand-written leading imports with the referenced symbols, and renders ONE
// import block in ruff-isort's default canonical form (so `ruff check
// --select I` is the oracle for the ordering):
//
//   sections   __future__ · stdlib · third-party · first-party (`app`, `tests`),
//              one blank line between non-empty sections
//   within     `import m` statements before `from m import …`, modules
//              compared case-insensitively
//   names      order-by-type — CONSTANTS, Classes, then everything else —
//              case-insensitive within a type
//   aliases    one `from m import x as y` line per aliased member beside the
//              combined `from m import a, b` line, ordered by first member
//              (ruff's combine-as-imports = false)
//   wrapping   a line longer than 100 columns becomes the parenthesized
//              one-name-per-line form with a trailing comma
//   after      two blank lines before a top-level def / class / decorator,
//              otherwise one
//
// Function-local (lazy) imports are not touched — only the module's leading
// import region is.
// ---------------------------------------------------------------------------

import { PYTHON_STDLIB } from "./python-stdlib.js";
import {
  binding,
  CLOSE,
  type ImportSymbol,
  OPEN,
  ref,
  resolveMarkers,
  spelling,
  symbolKey,
} from "./symbol.js";

/** `from <module> import <name> [as <alias>]`. */
export function pyFrom(module: string, name: string, alias?: string): ImportSymbol {
  return { lang: "py", module, name, ...(alias !== undefined ? { alias } : {}) };
}

/** `import <module> [as <alias>]`. */
export function pyModule(module: string, alias?: string): ImportSymbol {
  return { lang: "py", module, ...(alias !== undefined ? { alias } : {}) };
}

/** Shorthand: the marker for `from <module> import <name> [as <alias>]`. */
export function pyRef(module: string, name: string, alias?: string): string {
  return ref(pyFrom(module, name, alias));
}

/** The line a module places where its import block goes when it carries no
 *  hand-written leading import (it is replaced by the derived block, or
 *  removed when the block is empty). */
export const PY_IMPORTS = "py-imports";

const LINE_LENGTH = 100;
const FIRST_PARTY = new Set(["app", "tests"]);

export interface FinalizePyOptions {
  /** Names the module defines at top level — a referenced symbol spelled
   *  the same is a collision (it would shadow or be shadowed). */
  readonly declares?: Iterable<string>;
  /** Where the module is emitted (project-relative) — named in errors, and
   *  the module whose own symbols are spelled bare with no import. */
  readonly path?: string;
}

// ---------------------------------------------------------------------------
// Parsing the leading import region
// ---------------------------------------------------------------------------

const IMPORT_START = /^(import|from)\s/;

/** Index of the first line after the module docstring / leading comments, or
 *  the docstring-less start. */
function preambleEnd(lines: readonly string[]): number {
  const skipTrivia = (from: number): number => {
    let k = from;
    while (k < lines.length && (lines[k]!.trim() === "" || lines[k]!.startsWith("#"))) k++;
    return k;
  };
  // Comments may precede the docstring (a scaffold-once banner does).
  let i = skipTrivia(0);
  const first = lines[i]?.trimStart() ?? "";
  const q = /^[rRbBuU]?("""|''')/.exec(first);
  if (q) {
    const delim = q[1]!;
    if (first.slice(q[0].length).includes(delim)) {
      i++;
    } else {
      i++;
      while (i < lines.length && !lines[i]!.includes(delim)) i++;
      i++;
    }
  }
  return skipTrivia(i);
}

interface Region {
  /** First line of the region (an import statement or the slot). */
  readonly start: number;
  /** One past the last import / slot line. */
  readonly end: number;
  /** The import statements, each joined onto one line. */
  readonly statements: string[];
  readonly hasSlot: boolean;
}

function leadingRegion(lines: readonly string[]): Region | null {
  const start = preambleEnd(lines);
  let i = start;
  let end = start;
  const statements: string[] = [];
  let hasSlot = false;
  while (i < lines.length) {
    const l = lines[i]!;
    if (l === PY_IMPORTS) {
      hasSlot = true;
      i++;
      end = i;
      continue;
    }
    if (l.trim() === "") {
      i++;
      continue;
    }
    if (!IMPORT_START.test(l)) break;
    let stmt = l;
    if (/\(\s*$/.test(l)) {
      // Parenthesized multi-line `from m import (`
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(")")) {
        stmt += ` ${lines[i]!.trim()}`;
        i++;
      }
      stmt += ")";
    }
    statements.push(stmt);
    i++;
    end = i;
  }
  if (statements.length === 0 && !hasSlot) return null;
  return { start, end, statements, hasSlot };
}

function parseStatement(stmt: string, where: string): ImportSymbol[] {
  const s = stmt.trim();
  if (/[#;\\]/.test(s)) throw new Error(`${where}: unsupported import statement form: ${s}`);
  const from = /^from\s+([\w.]+)\s+import\s+(.+)$/.exec(s);
  if (from) {
    const module = from[1]!;
    const names = from[2]!.replace(/^\(|\)$/g, "").split(",");
    const out: ImportSymbol[] = [];
    for (const raw of names) {
      const n = raw.trim();
      if (n === "") continue;
      const m = /^(\w+)(?:\s+as\s+(\w+))?$/.exec(n);
      if (!m) throw new Error(`${where}: unsupported import member '${n}' in: ${s}`);
      out.push(pyFrom(module, m[1]!, m[2]));
    }
    return out;
  }
  const imp = /^import\s+(.+)$/.exec(s);
  if (imp) {
    return imp[1]!.split(",").map((part) => {
      const m = /^([\w.]+)(?:\s+as\s+(\w+))?$/.exec(part.trim());
      if (!m) throw new Error(`${where}: unsupported import statement: ${s}`);
      return pyModule(m[1]!, m[2]);
    });
  }
  throw new Error(`${where}: not an import statement: ${s}`);
}

// ---------------------------------------------------------------------------
// Rendering the canonical block
// ---------------------------------------------------------------------------

function section(module: string): number {
  const root = module.split(".")[0]!;
  if (root === "__future__") return 0;
  if (PYTHON_STDLIB.has(root)) return 1;
  if (FIRST_PARTY.has(root)) return 3;
  return 2;
}

/** ruff isort `order-by-type`: 0 CONSTANT, 1 Class, 2 everything else. */
function memberType(name: string): number {
  if (name.length > 1 && name === name.toUpperCase() && /[A-Z]/.test(name)) return 0;
  if (/^[A-Z]/.test(name)) return 1;
  return 2;
}

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function cmpMember(a: string, b: string): number {
  return memberType(a) - memberType(b) || cmpStr(a.toLowerCase(), b.toLowerCase()) || cmpStr(a, b);
}

function cmpModule(a: string, b: string): number {
  return cmpStr(a.toLowerCase(), b.toLowerCase()) || cmpStr(a, b);
}

function fromLine(module: string, members: readonly string[]): string[] {
  const one = `from ${module} import ${members.join(", ")}`;
  if (one.length <= LINE_LENGTH) return [one];
  return [`from ${module} import (`, ...members.map((m) => `    ${m},`), ")"];
}

function renderBlock(symbols: readonly ImportSymbol[]): string[] {
  const bySection: ImportSymbol[][] = [[], [], [], []];
  for (const s of symbols) bySection[section(s.module)]!.push(s);
  const out: string[] = [];
  for (const group of bySection) {
    if (group.length === 0) continue;
    if (out.length > 0) out.push("");
    // `import m [as a]` statements first, by module then alias.
    const plain = group
      .filter((s) => s.name === undefined)
      .sort((a, b) => cmpModule(a.module, b.module) || cmpStr(a.alias ?? "", b.alias ?? ""));
    for (const s of plain)
      out.push(s.alias ? `import ${s.module} as ${s.alias}` : `import ${s.module}`);
    // `from m import …` by module: the combined line, then aliased members.
    const fromMods = new Map<string, ImportSymbol[]>();
    for (const s of group) {
      if (s.name === undefined) continue;
      const list = fromMods.get(s.module) ?? [];
      list.push(s);
      fromMods.set(s.module, list);
    }
    for (const mod of [...fromMods.keys()].sort(cmpModule)) {
      const members = fromMods.get(mod)!;
      // One combined line for the unaliased members, one line per aliased
      // member; the lines order by their FIRST member's key (ties: the
      // unaliased line first, then by alias) — ruff's as-import placement.
      const bare = members
        .filter((s) => s.alias === undefined)
        .map((s) => s.name!)
        .sort(cmpMember);
      const rows: { first: string; alias: string | null; text: string[] }[] = [];
      if (bare.length > 0) rows.push({ first: bare[0]!, alias: null, text: fromLine(mod, bare) });
      for (const s of members) {
        if (s.alias === undefined) continue;
        rows.push({
          first: s.name!,
          alias: s.alias,
          text: fromLine(mod, [`${s.name} as ${s.alias}`]),
        });
      }
      rows.sort(
        (a, b) =>
          cmpMember(a.first, b.first) ||
          (a.alias === null ? 0 : 1) - (b.alias === null ? 0 : 1) ||
          cmpStr(a.alias ?? "", b.alias ?? ""),
      );
      for (const r of rows) out.push(...r.text);
    }
  }
  return out;
}

/** The dotted module a project-relative path defines (`app/domain/ids.py`
 *  → `app.domain.ids`, `app/x/__init__.py` → `app.x`). */
function moduleOfPath(path: string): string {
  return path
    .replace(/\.py$/, "")
    .replace(/\/__init__$/, "")
    .split("/")
    .join(".");
}

// ---------------------------------------------------------------------------
// Name collisions — alias the framework side
//
// A user's type name never loses to the spelling of an import: when two
// imports of one module bind the same name, the one the model does not choose —
// a stdlib / third-party member (`fastapi.Request`, `pydantic.BaseModel`,
// `decimal.Decimal`) or a member of a fixed generated runtime module
// (`app.domain.errors`, `app.http.problem`, …) — is imported under a
// deterministic alias, and every reference to it in the module (a marker or a
// hand-written bare name) is spelled with that alias.  The model-side symbol
// keeps its bare name.  The alias is `_<module, '.' as '_'>_<name>`: unique per
// (module, name) and a private name no model can declare.  Only a module with
// a collision changes.  Two model-side symbols, or two framework-side ones,
// binding one name stay an error: neither may be renamed.
// ---------------------------------------------------------------------------

/** First-party modules whose members the generator fixes — they alias like
 *  third-party members. */
const FIXED_FIRST_PARTY = new Set([
  "app.auth.user",
  "app.db.schema",
  "app.domain.errors",
  "app.domain.events",
  "app.domain.file_ref",
  "app.domain.paging",
  "app.http.problem",
  "app.obs.log",
]);

function isFramework(s: ImportSymbol): boolean {
  return section(s.module) !== 3 || FIXED_FIRST_PARTY.has(s.module);
}

/** Builtins the emitters name in generated code (`raise ValueError(…)`).  A
 *  model type of the same name shadows the builtin in its module, so the
 *  module spells the builtin `builtins.<Name>` instead. */
const BUILTINS_NAMED_BY_GENERATED_CODE = new Set([
  "Exception",
  "KeyError",
  "NotImplementedError",
  "RuntimeError",
  "TypeError",
  "ValueError",
]);

/** The alias a framework member takes when its name is claimed by the model. */
function pyCollisionAlias(module: string, name: string): string {
  return `_${module.split(".").join("_")}_${name}`;
}

/** Tokens python source is made of for renaming: import markers (opaque),
 *  comments, string literals, identifiers. */
const PY_TOKEN = new RegExp(
  [
    `${OPEN}[^${CLOSE}]*${CLOSE}`,
    "#[^\\n]*",
    "[rRbBuUfF]{0,2}(?:\"\"\"[\\s\\S]*?\"\"\"|'''[\\s\\S]*?''')",
    '[rRbBuUfF]{0,2}"(?:\\\\.|[^"\\\\\\n])*"',
    "[rRbBuUfF]{0,2}'(?:\\\\.|[^'\\\\\\n])*'",
    "[A-Za-z_]\\w*",
  ].join("|"),
  "g",
);

/** Rewrite the bare uses of the `renames` keys in python source; an attribute
 *  access (`x.Name`), a keyword name (`Name=`) and the name of a `class` /
 *  `def` are not references to the import.  A module that defines a name AND
 *  imports a framework member of it spells the module's own class in strings
 *  and through `cls`, never as a bare name in code. */
function renameBareUses(text: string, renames: ReadonlyMap<string, string>): string {
  return text.replace(PY_TOKEN, (tok, offset: number, whole: string) => {
    const to = renames.get(tok);
    if (to === undefined) return tok;
    let i = offset - 1;
    while (i >= 0 && (whole[i] === " " || whole[i] === "\t")) i--;
    if (whole[i] === ".") return tok;
    // The name a `class` / `def` defines is the module's own, not the import.
    if (
      /(?:^|\n)[ \t]*(?:async[ \t]+)?(?:class|def)[ \t]+$/.test(
        whole.slice(Math.max(0, offset - 40), offset),
      )
    )
      return tok;
    const next = /^\s*(=?)(=?)/.exec(whole.slice(offset + tok.length));
    if (next && next[1] === "=" && next[2] !== "=") return tok;
    return to;
  });
}

/** A function-local `from <module> import Name` of an aliased member binds the
 *  alias, in step with the renamed uses. */
function aliasLocalImports(
  text: string,
  aliased: ReadonlyMap<string, { module: string; alias: string }>,
): string {
  return text
    .split("\n")
    .map((l) => {
      const m = /^(\s+)from\s+([\w.]+)\s+import\s+(.+)$/.exec(l);
      if (!m) return l;
      const names = m[3]!.split(",").map((n) => {
        const t = n.trim();
        const a = aliased.get(t);
        return a && a.module === m[2] ? `${t} as ${a.alias}` : t;
      });
      return `${m[1]}from ${m[2]} import ${names.join(", ")}`;
    })
    .join("\n");
}

/** The symbols that must take an alias: for every name two distinct imports
 *  bind, the framework-side ones, provided a model-side symbol keeps the bare
 *  name.  Returns `symbolKey → alias`; throws when no side may move. */
function collisionAliases(
  symbols: Iterable<ImportSymbol>,
  where: string,
): Map<string, { sym: ImportSymbol; alias: string }> {
  const byBinding = new Map<string, ImportSymbol[]>();
  for (const s of symbols) {
    const b = binding(s);
    const list = byBinding.get(b) ?? [];
    list.push(s);
    byBinding.set(b, list);
  }
  const out = new Map<string, { sym: ImportSymbol; alias: string }>();
  for (const [b, group] of byBinding) {
    // `import a.b` and `import a.c` both bind `a` — legal, the same package.
    if (group.every((s) => s.name === undefined && s.alias === undefined)) continue;
    if (group.length < 2) continue;
    const movable = group.filter((s) => s.name !== undefined && isFramework(s));
    const fixed = group.filter((s) => !movable.includes(s));
    if (movable.length === 0 || fixed.length !== 1) {
      throw new Error(
        `${where}: two imports bind '${b}' (${group[0]!.module} and ${group[1]!.module}) — alias one`,
      );
    }
    for (const s of movable)
      out.set(symbolKey(s), { sym: s, alias: pyCollisionAlias(s.module, binding(s)) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The finalizer
// ---------------------------------------------------------------------------

const DEF_START = /^(def |async def |class |@)/;

/**
 * Finalize one python module: spell every `ref()` marker, and replace the
 * module's leading import region (its remaining hand-written imports and/or
 * the `PY_IMPORTS` slot) with the canonical block of every import it uses.
 * A module with neither a marker nor a leading import comes back unchanged.
 */
export function finalizePyModule(text: string, opts: FinalizePyOptions = {}): string {
  const where = opts.path ?? "<python module>";
  const own = opts.path === undefined ? undefined : moduleOfPath(opts.path);
  const localNames = new Set<string>();
  const isLocal = (s: ImportSymbol): boolean => {
    if (s.module !== own) return false;
    if (s.name !== undefined) localNames.add(s.name);
    return true;
  };
  let { text: spelled, used } = resolveMarkers(text, isLocal);
  for (const m of spelled.matchAll(/^(?:class|def|async def)[ \t]+(\w+)/gm)) localNames.add(m[1]!);
  let lines = spelled.split("\n");
  let region = leadingRegion(lines);
  if (region === null) {
    if (used.length > 0) {
      throw new Error(
        `${where}: references ${used.map(spelling).join(", ")} but has no import region (add a PY_IMPORTS slot)`,
      );
    }
    if (spelled.includes(PY_IMPORTS)) {
      throw new Error(`${where}: the PY_IMPORTS slot must sit in the module's leading region`);
    }
    return spelled;
  }

  let symbols = new Map<string, ImportSymbol>();
  for (const stmt of region.statements) {
    for (const s of parseStatement(stmt, where)) symbols.set(symbolKey(s), s);
  }
  for (const s of used) symbols.set(symbolKey(s), s);

  // A name two imports bind, or an import binds that the module defines
  // itself: the framework side takes an alias (never the model's type).
  const aliases = collisionAliases(symbols.values(), where);
  for (const s of symbols.values()) {
    if (aliases.has(symbolKey(s)) || s.name === undefined) continue;
    if (isFramework(s) && localNames.has(binding(s))) {
      aliases.set(symbolKey(s), { sym: s, alias: pyCollisionAlias(s.module, binding(s)) });
    }
  }
  // A builtin the model's own name shadows is spelled `builtins.<Name>`.
  const shadowed = [...BUILTINS_NAMED_BY_GENERATED_CODE].filter(
    (b) =>
      localNames.has(b) ||
      [...symbols.values()].some(
        (s) => !aliases.has(symbolKey(s)) && !isFramework(s) && binding(s) === b,
      ),
  );
  if (aliases.size > 0 || shadowed.length > 0) {
    const renames = new Map<string, string>();
    for (const b of shadowed) renames.set(b, `builtins.${b}`);
    const local = new Map<string, { module: string; alias: string }>();
    for (const { sym, alias } of aliases.values()) {
      renames.set(binding(sym), alias);
      if (sym.alias === undefined) local.set(sym.name!, { module: sym.module, alias });
    }
    const raw = text.split("\n");
    const head = raw.slice(0, region.start);
    const tail = raw.slice(region.end);
    const rewritten = [
      ...head,
      ...raw.slice(region.start, region.end),
      ...aliasLocalImports(renameBareUses(tail.join("\n"), renames), local).split("\n"),
    ].join("\n");
    const second = resolveMarkers(rewritten, isLocal, (sym) => {
      const a = aliases.get(symbolKey(sym));
      return a ? a.alias : spelling(sym);
    });
    spelled = second.text;
    used = second.used;
    lines = spelled.split("\n");
    region = leadingRegion(lines)!;
    const withAlias = (sym: ImportSymbol): ImportSymbol => {
      const a = aliases.get(symbolKey(sym));
      return a ? { ...sym, alias: a.alias } : sym;
    };
    symbols = new Map<string, ImportSymbol>();
    for (const stmt of region.statements) {
      for (const sym of parseStatement(stmt, where)) symbols.set(symbolKey(sym), withAlias(sym));
    }
    for (const sym of used) symbols.set(symbolKey(sym), withAlias(sym));
    if (/(^|[^\w.])builtins\.[A-Za-z]/m.test(spelled)) {
      const b = pyModule("builtins");
      symbols.set(symbolKey(b), b);
    }
    const still = collisionAliases(symbols.values(), where);
    if (still.size > 0) {
      throw new Error(`${where}: aliasing '${[...still.keys()][0]}' left a collision`);
    }
  }
  for (const d of opts.declares ?? []) {
    const clash = [...symbols.values()].find((s) => binding(s) === d);
    if (clash) {
      throw new Error(
        `${where}: import of '${d}' from ${clash.module} collides with a module-level definition`,
      );
    }
  }

  const block = renderBlock([...symbols.values()]);
  const before = lines.slice(0, region.start);
  let after = lines.slice(region.end);
  if (after.includes(PY_IMPORTS)) {
    throw new Error(`${where}: the PY_IMPORTS slot must sit in the module's leading region`);
  }
  if (block.length === 0) {
    // Nothing to import: the region (slot only) collapses away.
    return [...before, ...after].join("\n");
  }
  // Blank lines after the block: 2 before a def/class/decorator, else 1.
  let blanks = 0;
  while (blanks < after.length && after[blanks]!.trim() === "") blanks++;
  const rest = after.slice(blanks);
  if (rest.length === 0) {
    after = Array(blanks).fill("");
  } else {
    // ruff looks through comments to the statement they precede.
    const stmt = rest.find((l) => l.trim() !== "" && !l.startsWith("#")) ?? "";
    const want = DEF_START.test(stmt) ? 2 : 1;
    after = [...Array(want).fill(""), ...rest];
  }
  return [...before, ...block, ...after].join("\n");
}
