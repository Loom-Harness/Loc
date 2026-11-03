// ---------------------------------------------------------------------------
// Imports derived from use — TypeScript (design:
// https://github.com/Loom-Harness/Loc/blob/35354de7c61ecac7622d9dbdac9f326bcf7023fd/docs/new-plan/missions/M-T9.84-derived-imports.md).
// Symbol constructors and the module finalizer: resolves `ref()` markers and
// writes one import line per module the surviving markers name.
//
//   handles    named (`tsNamed`), default (`tsDefault`), namespace
//              (`tsNamespace`); `refType` marks a type-position reference,
//              and a binding only type positions reach is imported `type`.
//   specifier  a package name verbatim; a project-root module (`~/domain/ids`)
//              relative to the importing file's own path (`../domain/ids`).
//   placement  a module's line goes where the emitter put its `tsImportSlot`
//              (which can also fix the specifier order — case-insensitive
//              by default — and the inline-`type` spelling), else after the
//              module's last leading import.
//   hand lines a binding an import statement the emitter still writes by hand
//              already provides gets no second line.
//
// A module with neither a marker nor a slot comes back unchanged.
// ---------------------------------------------------------------------------

import { hasMarkers, type ImportSymbol, ref, resolveMarkers, spelling } from "./symbol.js";

/** `import { <name> [as <alias>] } from "<module>"`. */
export function tsNamed(module: string, name: string, alias?: string): ImportSymbol {
  return { lang: "ts", module, name, ...(alias !== undefined ? { alias } : {}) };
}

/** `import <local> from "<module>"`. */
export function tsDefault(module: string, local: string): ImportSymbol {
  return { lang: "ts", module, name: "default", alias: local };
}

/** `import * as <local> from "<module>"`. */
export function tsNamespace(module: string, local: string): ImportSymbol {
  return { lang: "ts", module, alias: local };
}

/** A reference to `sym` in a type position (an annotation, `implements`, a
 *  type argument): it needs the binding only at compile time. */
export function refType(sym: ImportSymbol): string {
  return ref({ ...sym, typeOnly: true });
}

const SLOT_OPEN = "\uE002";
const SLOT_CLOSE = "\uE003";
const SLOT_RE = /^\uE002([^|]*)\|([^|]*)\|([a-z]*)\uE003$/;

export interface TsImportSlotOptions {
  /** Specifier order: the listed names first (those referenced), the rest
   *  after them case-insensitively. */
  readonly order?: readonly string[];
  /** The slot renders ONLY the listed names — the rest of the module's names
   *  go to another slot for the same module (or after the leading imports). */
  readonly exclusive?: boolean;
  /** Spell type-only names `{ type A }` even when every name is type-only
   *  (instead of `import type { A }`). */
  readonly inlineType?: boolean;
}

/** The line an emitter places in a module's import header where the import
 *  of `module` goes; the finalizer replaces it with that import, or removes
 *  it when nothing from `module` is referenced. */
export function tsImportSlot(module: string, opts: TsImportSlotOptions = {}): string {
  const flags = `${opts.exclusive ? "x" : ""}${opts.inlineType ? "i" : ""}`;
  return `${SLOT_OPEN}${module}|${(opts.order ?? []).join(",")}|${flags}${SLOT_CLOSE}`;
}

/** True when the text still carries a slot. */
export function hasSlots(text: string): boolean {
  return text.includes(SLOT_OPEN);
}

interface Slot {
  readonly module: string;
  readonly order: readonly string[];
  readonly exclusive: boolean;
  readonly inlineType: boolean;
}

function parseSlot(line: string): Slot | null {
  const m = SLOT_RE.exec(line);
  if (!m) return null;
  return {
    module: m[1]!,
    order: m[2] === "" ? [] : m[2]!.split(","),
    exclusive: m[3]!.includes("x"),
    inlineType: m[3]!.includes("i"),
  };
}

const dirParts = (file: string): string[] => {
  const slash = file.lastIndexOf("/");
  return slash === -1 ? [] : file.slice(0, slash).split("/").filter(Boolean);
};

/** The specifier `fromFile` imports `module` by. */
export function tsSpecifier(module: string, fromFile: string | undefined): string {
  if (!module.startsWith("~/")) return module;
  if (fromFile === undefined) {
    throw new Error(`ts import: '${module}' is project-relative but the module has no path`);
  }
  const from = dirParts(fromFile);
  const to = module.slice(2).split("/");
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  const rel = [...from.slice(i).map(() => ".."), ...to.slice(i)].join("/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

/** Every local name a hand-written top-level import statement binds. */
function handBindings(text: string): Set<string> {
  const out = new Set<string>();
  const re = /^import\s+(?:type\s+)?([^"';]*?)\s+from\s+["'][^"']+["']/gm;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const clause = m[1]!;
    const brace = /\{([^}]*)\}/.exec(clause);
    if (brace) {
      for (const spec of brace[1]!.split(",")) {
        const t = spec.trim().replace(/^type\s+/, "");
        if (t === "") continue;
        const as = /\bas\s+(\w+)$/.exec(t);
        out.add(as ? as[1]! : t);
      }
    }
    const rest = clause.replace(/\{[^}]*\}/, "");
    const ns = /\*\s+as\s+([\w$]+)/.exec(rest);
    if (ns) out.add(ns[1]!);
    const def = /^\s*([\w$]+)\s*(,|$)/.exec(rest);
    if (def && !ns) out.add(def[1]!);
  }
  return out;
}

interface Binding {
  readonly sym: ImportSymbol;
  typeOnly: boolean;
}

/** One import statement for a module: default, namespace, then named. */
function render(
  module: string,
  spec: string,
  bindings: readonly Binding[],
  slot: Slot | undefined,
): string[] {
  const lines: string[] = [];
  const typed = (b: Binding): string => (b.typeOnly ? "type " : "");
  for (const b of bindings) {
    if (b.sym.name === "default")
      lines.push(`import ${typed(b)}${spelling(b.sym)} from "${spec}";`);
  }
  for (const b of bindings) {
    if (b.sym.name === undefined)
      lines.push(`import ${typed(b)}* as ${spelling(b.sym)} from "${spec}";`);
  }
  const named = bindings.filter((b) => b.sym.name !== undefined && b.sym.name !== "default");
  if (named.length > 0) {
    const order = slot?.order ?? [];
    const rank = (b: Binding): number => {
      const i = order.indexOf(b.sym.name!);
      return i === -1 ? order.length : i;
    };
    const ci = (b: Binding): string => b.sym.name!.toLowerCase();
    const sorted = [...named].sort(
      (x, y) => rank(x) - rank(y) || (ci(x) < ci(y) ? -1 : ci(x) > ci(y) ? 1 : 0),
    );
    const text = (b: Binding): string =>
      b.sym.alias !== undefined ? `${b.sym.name} as ${b.sym.alias}` : b.sym.name!;
    const allType = sorted.every((b) => b.typeOnly);
    if (allType && !slot?.inlineType) {
      lines.push(`import type { ${sorted.map(text).join(", ")} } from "${spec}";`);
    } else {
      lines.push(
        `import { ${sorted.map((b) => `${typed(b)}${text(b)}`).join(", ")} } from "${spec}";`,
      );
    }
  }
  if (lines.length === 0) throw new Error(`ts import: nothing to render for '${module}'`);
  return lines;
}

export interface FinalizeTsOptions {
  /** Where the module is emitted (project-relative) — the base of every
   *  project-root specifier, and the module whose own symbols are bare. */
  readonly path?: string;
}

/**
 * Finalize one TypeScript module: spell every `ref()` marker, and write the
 * import of every binding a surviving marker needs that no hand-written
 * import already provides — at its module's slot, or after the leading
 * imports.  Unused slots are removed.
 */
export function finalizeTsModule(text: string, opts: FinalizeTsOptions = {}): string {
  if (!hasMarkers(text) && !hasSlots(text)) return text;
  const where = opts.path ?? "<ts module>";
  const self = opts.path !== undefined ? `~/${opts.path.replace(/\.tsx?$/, "")}` : undefined;
  const { text: spelled, used } = resolveMarkers(text, (s) => s.module === self);

  // Merge references to one binding: a value reference anywhere wins.
  const bindings = new Map<string, Binding>();
  for (const s of used) {
    if (s.lang !== "ts")
      throw new Error(`${where}: a ${s.lang} import marker in a TypeScript module`);
    const key = `${s.module}|${s.name ?? ""}|${s.alias ?? ""}`;
    const prior = bindings.get(key);
    if (prior) prior.typeOnly &&= s.typeOnly === true;
    else bindings.set(key, { sym: s, typeOnly: s.typeOnly === true });
  }
  const hand = handBindings(spelled);
  const pending = new Map<string, Binding[]>();
  const bound = new Map<string, string>();
  for (const b of bindings.values()) {
    const local = spelling(b.sym);
    const other = bound.get(local);
    if (other !== undefined && other !== b.sym.module) {
      throw new Error(`${where}: two imports bind '${local}' (${other} and ${b.sym.module})`);
    }
    bound.set(local, b.sym.module);
    if (hand.has(local)) continue;
    const list = pending.get(b.sym.module) ?? [];
    list.push(b);
    pending.set(b.sym.module, list);
  }

  const lines = spelled.split("\n");
  const slots = lines.map(parseSlot);
  // Exclusive slots claim their names first; a module's open slot takes the rest.
  const claimed = new Map<number, Binding[]>();
  const take = (i: number, slot: Slot, pick: (b: Binding) => boolean): void => {
    const list = pending.get(slot.module) ?? [];
    claimed.set(i, [...(claimed.get(i) ?? []), ...list.filter(pick)]);
    pending.set(
      slot.module,
      list.filter((b) => !pick(b)),
    );
  };
  slots.forEach((s, i) => {
    if (s?.exclusive) take(i, s, (b) => b.sym.name !== undefined && s.order.includes(b.sym.name));
  });
  slots.forEach((s, i) => {
    if (s && !s.exclusive && !claimed.has(i)) take(i, s, () => true);
  });

  const out: string[] = [];
  let lastImport = -1;
  let inImport = false;
  lines.forEach((line, i) => {
    const s = slots[i];
    if (s) {
      const got = claimed.get(i) ?? [];
      if (got.length > 0) out.push(...render(s.module, tsSpecifier(s.module, opts.path), got, s));
      lastImport = out.length - 1;
      return;
    }
    if (line.includes(SLOT_OPEN)) throw new Error(`${where}: a slot must be a line of its own`);
    out.push(line);
    if (/^import\s/.test(line)) inImport = true;
    if (inImport) {
      lastImport = out.length - 1;
      if (/["'];?\s*$/.test(line)) inImport = false;
    }
  });

  const rest = [...pending.entries()].filter(([, l]) => l.length > 0);
  if (rest.length === 0) return out.join("\n");
  const block = rest
    .sort(([a], [b]) => (tsSpecifier(a, opts.path) < tsSpecifier(b, opts.path) ? -1 : 1))
    .flatMap(([mod, l]) => render(mod, tsSpecifier(mod, opts.path), l, undefined));
  let at = lastImport + 1;
  if (lastImport < 0) {
    at = 0;
    while (at < out.length && /^\s*\/\//.test(out[at]!)) at++;
  }
  out.splice(at, 0, ...block);
  return out.join("\n");
}

/** Fail closed: a slot that reaches an emitted file was never finalized. */
export function assertNoSlots(path: string, content: string): void {
  if (hasSlots(content)) {
    throw new Error(
      `${path}: unresolved import slot — the module was emitted without its finalizer`,
    );
  }
}
