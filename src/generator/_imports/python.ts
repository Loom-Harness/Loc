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
import { binding, type ImportSymbol, ref, resolveMarkers, spelling, symbolKey } from "./symbol.js";

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
  /** Where the module is emitted — named in errors. */
  readonly path?: string;
}

// ---------------------------------------------------------------------------
// Parsing the leading import region
// ---------------------------------------------------------------------------

const IMPORT_START = /^(import|from)\s/;

/** Index of the first line after the module docstring / leading comments, or
 *  the docstring-less start. */
function preambleEnd(lines: readonly string[]): number {
  let i = 0;
  while (i < lines.length && lines[i]!.trim() === "") i++;
  const first = lines[i]?.trimStart() ?? "";
  const q = /^[rRbBuU]?("""|''')/.exec(first);
  if (q) {
    const delim = q[1]!;
    const rest = first.slice(q[0].length);
    if (rest.includes(delim)) {
      i++;
    } else {
      i++;
      while (i < lines.length && !lines[i]!.includes(delim)) i++;
      i++;
    }
  }
  while (i < lines.length && (lines[i]!.trim() === "" || lines[i]!.startsWith("#"))) i++;
  return i;
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
  const { text: spelled, used } = resolveMarkers(text);
  const lines = spelled.split("\n");
  const region = leadingRegion(lines);
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

  const symbols = new Map<string, ImportSymbol>();
  for (const stmt of region.statements) {
    for (const s of parseStatement(stmt, where)) symbols.set(symbolKey(s), s);
  }
  for (const s of used) symbols.set(symbolKey(s), s);

  // Collision: two distinct imports binding one name (F811), or an import
  // binding a name the module defines itself.
  const bound = new Map<string, ImportSymbol>();
  for (const s of symbols.values()) {
    const b = binding(s);
    const prior = bound.get(b);
    // `import a.b` and `import a.c` both bind `a` — legal, the same package.
    if (
      prior &&
      !(
        prior.name === undefined &&
        s.name === undefined &&
        prior.alias === undefined &&
        s.alias === undefined
      )
    ) {
      throw new Error(
        `${where}: two imports bind '${b}' (${prior.module} and ${s.module}) — alias one`,
      );
    }
    bound.set(b, s);
  }
  for (const d of opts.declares ?? []) {
    if (bound.has(d)) {
      throw new Error(
        `${where}: import of '${d}' from ${bound.get(d)!.module} collides with a module-level definition`,
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
