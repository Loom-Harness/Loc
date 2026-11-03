// ---------------------------------------------------------------------------
// Carrying translations across model renames and moves.
//
// A model-identity key (`<Ctx>.<Type>.<facet>[.<member>]`, see
// `src/util/model-text-key.ts`) names WHAT a string describes, so renaming the
// thing renames the key.  Without help, `sync` reads that as "old key deleted,
// new key added" and the translator's work is dropped.  This module finds the
// (old key -> new key) pairs so the CLI can re-key BASE, OURS and the review
// state before the ordinary three-way merge runs; the merge then keeps the
// translation and, when the English text moved too, flags it for review
// through its existing same-key source-changed path.
//
// Two sources, in this order:
//
//  1. DECLARED — the `migration "<name>" { … }` blocks the schema-evolution
//     layer already owns: `Order -> PurchaseOrder` (aggregate rename),
//     `Sales.Order -> Billing.Order` (cross-context move) and
//     `Order.qty -> quantity` (field rename).  Same source of truth as
//     `ddd migrate`; no i18n-specific syntax.  A migration block is a
//     permanent ledger, so a step whose old key is not in BASE (already
//     carried) or whose new key is not in THEIRS is inert.
//  2. INFERRED — for what a migration block cannot name (operations, enum
//     values, rules, error messages, anything without a block): a 1:1 pairing.
//     Exactly one key vanished and exactly one appeared with the same shape
//     AND the same source text.  Anything ambiguous is left alone, so the
//     translation is dropped exactly as before rather than guessed.
//
// Pure: no fs, no parse.
// ---------------------------------------------------------------------------

import { isModelTextKey } from "../util/model-text-key.js";
import { type Catalog, fileKeyOf, namespaceOf, runtimeKeyOf } from "./namespace.js";

/** The rename facts the schema-evolution layer declares, as plain names. */
export interface DeclaredRenames {
  /** `Agg.old -> new` steps; `aggregate` is the live (post-rename) name. */
  columns: readonly { context: string; aggregate: string; from: string; to: string }[];
  /** `Old -> New` / `A.Old -> B.New` steps. */
  tables: readonly { from: string; to: string; fromContext?: string; toContext?: string }[];
}

const NO_DECLARED_RENAMES: DeclaredRenames = { columns: [], tables: [] };

/** One key that changed identity. */
export interface KeyMove {
  /** Runtime key in BASE. */
  from: string;
  /** Runtime key in THEIRS. */
  to: string;
  via: "declared" | "inferred";
}

interface Parsed {
  ctx: string;
  type: string;
  facet: string;
  /** Everything after `<ctx>.<type>.` (`field.qty`, `name.one`). */
  rest: string;
  /** Present on the member facets only. */
  member?: string;
}

function parse(key: string): Parsed | undefined {
  if (!isModelTextKey(key)) return undefined;
  const parts = key.split(".");
  const facet = parts[2] === "name" ? `name.${parts[3]}` : parts[2]!;
  const hasMember = !(facet === "name.one" || facet === "name.other" || facet === "message");
  return {
    ctx: parts[0]!,
    type: parts[1]!,
    facet,
    rest: parts.slice(2).join("."),
    member: hasMember ? parts[3] : undefined,
  };
}

/** Pair the identity keys that changed identity between `base` (the lock) and
 *  `theirs` (the fresh extraction).  Both are flat runtime-key catalogs. */
export function detectRenames(
  base: Catalog,
  theirs: Catalog,
  declared: DeclaredRenames = NO_DECLARED_RENAMES,
): KeyMove[] {
  const vanished = Object.keys(base)
    .filter((k) => !(k in theirs) && parse(k))
    .sort();
  const appeared = Object.keys(theirs)
    .filter((k) => !(k in base) && parse(k))
    .sort();
  const appearedSet = new Set(appeared);
  const moves: KeyMove[] = [];
  const takenFrom = new Set<string>();
  const takenTo = new Set<string>();
  const take = (from: string, to: string, via: KeyMove["via"]): void => {
    moves.push({ from, to, via });
    takenFrom.add(from);
    takenTo.add(to);
  };

  // 1. Declared: the table step first, then a column step on the (new) type.
  for (const from of vanished) {
    const p = parse(from)!;
    let ctx = p.ctx;
    let type = p.type;
    let rest = p.rest;
    for (const t of declared.tables) {
      if (t.from !== type || (t.fromContext !== undefined && t.fromContext !== ctx)) continue;
      ctx = t.toContext ?? ctx;
      type = t.to;
      break;
    }
    for (const c of declared.columns) {
      if (c.context === ctx && c.aggregate === type && rest === `field.${c.from}`) {
        rest = `field.${c.to}`;
        break;
      }
    }
    const to = `${ctx}.${type}.${rest}`;
    if (to !== from && appearedSet.has(to) && !takenTo.has(to)) take(from, to, "declared");
  }

  // 2. Inferred: unique 1:1 pairs of identical source text, grouped by shape.
  const shapes: ((p: Parsed) => string)[] = [
    // a member renamed within its type
    (p) => (p.member === undefined ? "" : `m|${p.ctx}|${p.type}|${p.facet}`),
    // a type's name / message renamed within its context
    (p) => (p.member === undefined ? `t|${p.ctx}|${p.facet}` : ""),
    // a type (or one of its members) moved to another context
    (p) => `c|${p.type}|${p.rest}`,
  ];
  for (const shape of shapes) {
    const groupL = new Map<string, string[]>();
    const groupR = new Map<string, string[]>();
    for (const k of vanished) {
      if (takenFrom.has(k)) continue;
      const s = shape(parse(k)!);
      if (s) groupL.set(s, [...(groupL.get(s) ?? []), k]);
    }
    for (const k of appeared) {
      if (takenTo.has(k)) continue;
      const s = shape(parse(k)!);
      if (s) groupR.set(s, [...(groupR.get(s) ?? []), k]);
    }
    for (const [s, ls] of groupL) {
      const rs = groupR.get(s);
      if (ls.length !== 1 || rs?.length !== 1) continue;
      const from = ls[0]!;
      const to = rs[0]!;
      if (base[from] === theirs[to]) take(from, to, "inferred");
    }
  }
  return moves.sort((a, b) => a.from.localeCompare(b.from));
}

/** Re-key `files` (per-namespace file contents of any value type) by `moves`,
 *  refiling a key under its new namespace.  A move whose target is already
 *  present is skipped, so a translator's own entry is never overwritten. */
export function moveKeys<T>(
  files: ReadonlyMap<string, Record<string, T>>,
  moves: ReadonlyMap<string, string>,
  names: ReadonlySet<string>,
): Map<string, Record<string, T>> {
  const flat = new Map<string, T>();
  for (const [ns, file] of files) {
    for (const [fk, v] of Object.entries(file)) flat.set(runtimeKeyOf(fk, ns), v);
  }
  const out = new Map<string, Record<string, T>>();
  const put = (key: string, v: T): void => {
    const ns = namespaceOf(key, names);
    const file = out.get(ns) ?? {};
    file[fileKeyOf(key, ns)] = v;
    out.set(ns, file);
  };
  for (const [key, v] of flat) {
    const to = moves.get(key);
    if (to !== undefined && !flat.has(to)) put(to, v);
    else put(key, v);
  }
  return new Map([...out].sort(([a], [b]) => a.localeCompare(b)));
}
