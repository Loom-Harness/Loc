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
//   clashes    a symbol whose local name the module binds another way (a hand
//              import of the name from a different module, or a top-level
//              declaration of that name) is imported under an alias
//              (`tsClashAlias`, src/generator/_symbols/plan.ts) and every
//              reference to it spells the alias — a model type that shares a
//              library's or the runtime's name keeps the bare name, the
//              library's symbol moves.
//
// A module with neither a marker nor a slot comes back unchanged.
// ---------------------------------------------------------------------------

import { tsClashAlias } from "../_symbols/plan.js";
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
  return ref({ ...sym, typeOnly: true as const });
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

/** One imported binding, whatever position (value or type) references it. */
const bindingKey = (s: ImportSymbol): string => `${s.module}|${s.name ?? ""}|${s.alias ?? ""}`;

/** Every local name a hand-written top-level import statement binds, with the
 *  specifier(s) it binds it from. */
function handBindings(text: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (local: string, spec: string): void => {
    const specs = out.get(local) ?? new Set<string>();
    specs.add(spec);
    out.set(local, specs);
  };
  const re = /^import\s+(?:type\s+)?([^"';]*?)\s+from\s+["']([^"']+)["']/gm;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const clause = m[1]!;
    const spec = m[2]!;
    const brace = /\{([^}]*)\}/.exec(clause);
    if (brace) {
      for (const part of brace[1]!.split(",")) {
        const t = part.trim().replace(/^type\s+/, "");
        if (t === "") continue;
        const as = /\bas\s+(\w+)$/.exec(t);
        add(as ? as[1]! : t, spec);
      }
    }
    const rest = clause.replace(/\{[^}]*\}/, "");
    const ns = /\*\s+as\s+([\w$]+)/.exec(rest);
    if (ns) add(ns[1]!, spec);
    const def = /^\s*([\w$]+)\s*(,|$)/.exec(rest);
    if (def && !ns) add(def[1]!, spec);
  }
  return out;
}

/** Every name the module declares at its top level (`class`, `interface`,
 *  `type`, `enum`, `const`, `let`, `var`, `function`), exported or not. */
function topLevelDeclarations(text: string): Set<string> {
  const out = new Set<string>();
  const re =
    /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:class|interface|type|enum|const|let|var|function\*?)\s+([A-Za-z_$][\w$]*)/gm;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) out.add(m[1]!);
  return out;
}

/** One hand-written import binding that moves to an alias. */
interface HandRewrite {
  readonly spec: string;
  readonly local: string;
  readonly alias: string;
}

/** The alias each referenced symbol is spelled under because its local name is
 *  already bound in the module another way — by a hand-written import from a
 *  different module, or by a declaration of the module's own — keyed by
 *  `bindingKey`; and the hand-written imports of such a symbol itself, which
 *  move to the alias with it. */
function clashAliases(
  used: readonly ImportSymbol[],
  hand: ReadonlyMap<string, ReadonlySet<string>>,
  declared: ReadonlySet<string>,
  path: string | undefined,
): { aliases: Map<string, string>; rewrites: HandRewrite[] } {
  const aliases = new Map<string, string>();
  const rewrites: HandRewrite[] = [];
  const taken = new Set<string>([...hand.keys(), ...declared, ...used.map((s) => spelling(s))]);
  for (const sym of used) {
    if (aliases.has(bindingKey(sym))) continue;
    const local = spelling(sym);
    const specs = hand.get(local);
    let clash = declared.has(local);
    const unresolvable = sym.module.startsWith("~/") && path === undefined;
    const own = unresolvable ? undefined : tsSpecifier(sym.module, path);
    if (!clash && specs !== undefined) {
      clash = own === undefined || [...specs].some((spec) => spec !== own);
    }
    if (!clash) continue;
    const alias = tsClashAlias(local, taken);
    taken.add(alias);
    aliases.set(bindingKey(sym), alias);
    if (own !== undefined && specs?.has(own)) rewrites.push({ spec: own, local, alias });
  }
  return { aliases, rewrites };
}

/** `text` with the hand-written import of `local` from `spec` rebound to
 *  `alias` (`{ X }` → `{ X as _X }`, `import X` → `import _X`,
 *  `* as X` → `* as _X`). */
function rebindHandImport(text: string, { spec, local, alias }: HandRewrite): string {
  const re = /^(import\s+(?:type\s+)?)([^"';]*?)(\s+from\s+["'])([^"']+)(["'])/gm;
  return text.replace(
    re,
    (whole, head: string, clause: string, mid: string, from: string, q: string) => {
      if (from !== spec) return whole;
      const rebound = clause
        .replace(/\{([^}]*)\}/, (_b, inner: string) => {
          const parts = inner.split(",").map((part) => {
            const m = /^(\s*)((?:type\s+)?)([\w$]+)(?:\s+as\s+([\w$]+))?(\s*)$/.exec(part);
            if (!m) return part;
            const [, lead, kind, name, as, trail] = m;
            if ((as ?? name) !== local) return part;
            return `${lead}${kind}${name} as ${alias}${trail}`;
          });
          return `{${parts.join(",")}}`;
        })
        .replace(/(\*\s+as\s+)([\w$]+)/, (w, pre: string, name: string) =>
          name === local ? `${pre}${alias}` : w,
        )
        .replace(/^(\s*)([\w$]+)(\s*(?:,|$))/, (w, lead: string, name: string, tail: string) =>
          name === local && !/^\*/.test(clause.trim()) ? `${lead}${alias}${tail}` : w,
        );
      return `${head}${rebound}${mid}${from}${q}`;
    },
  );
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
  const isSelf = (s: ImportSymbol): boolean => s.module === self;
  const { aliases, rewrites } = clashAliases(
    resolveMarkers(text, isSelf).used,
    handBindings(text),
    topLevelDeclarations(text),
    opts.path,
  );
  const rebound = rewrites.reduce(rebindHandImport, text);
  const hand = handBindings(rebound);
  const { text: spelled, used: spelledUsed } = resolveMarkers(
    rebound,
    isSelf,
    (s) => aliases.get(bindingKey(s)) ?? spelling(s),
  );
  const used = spelledUsed.map((s) => {
    const alias = aliases.get(bindingKey(s));
    return alias === undefined ? s : { ...s, alias };
  });

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
