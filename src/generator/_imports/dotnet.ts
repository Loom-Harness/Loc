// ---------------------------------------------------------------------------
// Imports derived from use — C# (design:
// https://github.com/Loom-Harness/Loc/blob/35354de7c61ecac7622d9dbdac9f326bcf7023fd/docs/new-plan/missions/M-T9.84-derived-imports.md §3).
// Symbol constructors and the compilation-unit finalizer: resolves `ref()`
// markers and derives the unit's `using` lines from the namespaces its
// surviving markers name.
//
// Two handle shapes:
//   - `csType(ns, name, alias?)` — a type; spells as `alias ?? name`.  An
//     aliased handle needs `using Alias = Ns.Name;` (the fix for a simple
//     name two namespaces both export); two unaliased types sharing a simple
//     name across namespaces is a thrown error.
//   - `csNamespace(ns)` — a namespace whose EXTENSION METHODS the text calls
//     (`.ToListAsync()`, `.QueryAsync<T>()`); spells as nothing.  Place it
//     right before the call it enables.
//
// ORDER IS THE HEADER'S, NOT THE FINALIZER'S.  The .NET headers predate this
// seam and follow no single order, so the finalizer never re-sorts what an
// emitter wrote.  A header names where a derived line goes with a `csUsing`
// SLOT: an unconditional line that renders `using Ns;` iff a surviving marker
// names `Ns`, and vanishes otherwise.  The slot carries no predicate — the
// usage decides — so it cannot drift from the code it imports for.  A needed
// namespace with no slot is appended after the region's last plain `using`.
//
// A namespace needs no derived line when the unit already writes it, when the
// unit's own `namespace` is it or nested inside it, or when the SDK's
// `<ImplicitUsings>` imports it into every file of every generated project
// (`CS_IMPLICIT_USINGS` — the plain-SDK set, which the Web SDK extends, so it
// holds for the API project and the xUnit project alike).  A SLOT still
// renders for an implicit namespace: it is the header's explicit choice.
// ---------------------------------------------------------------------------

import { CLOSE, type ImportSymbol, OPEN, ref, resolveMarkers, spelling } from "./symbol.js";

/** A type `<name>` in namespace `<ns>`, optionally bound under `alias`. */
export function csType(ns: string, name: string, alias?: string): ImportSymbol {
  return { lang: "cs", module: ns, name, ...(alias !== undefined ? { alias } : {}) };
}

/** A namespace the unit calls extension methods from — spells as nothing. */
export function csNamespace(ns: string): ImportSymbol {
  return { lang: "cs", module: ns };
}

/** Shorthand: the marker for type `<ns>.<name>`. */
export function csRef(ns: string, name: string, alias?: string): string {
  return ref(csType(ns, name, alias));
}

/** Shorthand: the (empty-spelling) marker for namespace `<ns>`'s extensions. */
export function csNsRef(ns: string): string {
  return ref(csNamespace(ns));
}

const NS = /^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)*$/;

/** A header line that renders `using <ns>;` iff the unit references `<ns>`. */
export function csUsing(ns: string): string {
  if (!NS.test(ns)) throw new Error(`csUsing: bad namespace '${ns}'`);
  return `${OPEN}cs-using ${ns}${CLOSE}`;
}

/** `<ImplicitUsings>enable</ImplicitUsings>` on `Microsoft.NET.Sdk` — the
 *  namespaces every generated .cs file already imports. */
export const CS_IMPLICIT_USINGS: ReadonlySet<string> = new Set([
  "System",
  "System.Collections.Generic",
  "System.IO",
  "System.Linq",
  "System.Net.Http",
  "System.Threading",
  "System.Threading.Tasks",
]);

const SLOT_RE = new RegExp(`^${OPEN}cs-using ([\\w.]+)${CLOSE}$`);
const USING_RE = /^using\s+([\w.]+)\s*;\s*$/;
const ALIAS_RE = /^using\s+(\w+)\s*=\s*([\w.<>, ]+?)\s*;\s*$/;
const NAMESPACE_RE = /^namespace\s+([\w.]+)\s*[;{]?/m;

const csSpelling = (s: ImportSymbol): string => (s.name === undefined ? "" : spelling(s));

export interface FinalizeCsOptions {
  readonly path?: string;
}

/**
 * Finalize one C# compilation unit: spell every `ref()` marker, render each
 * `csUsing` slot as `using Ns;` iff a surviving marker names `Ns` (else drop
 * the line), and append any other needed `using` after the leading region's
 * last plain `using`.  A unit with no marker and no slot comes back unchanged.
 */
export function finalizeCsUnit(text: string, opts: FinalizeCsOptions = {}): string {
  if (!text.includes(OPEN)) return text;
  const where = opts.path ?? "<c# unit>";
  // Slots out first: they are not `ref()` markers, so `resolveMarkers` would
  // reject them as malformed.
  const raw = text.split("\n");
  const slotAt = new Map<number, string>();
  raw.forEach((l, i) => {
    const m = SLOT_RE.exec(l);
    if (m) slotAt.set(i, m[1]!);
  });
  const body = raw.map((l, i) => (slotAt.has(i) ? "" : l)).join("\n");
  const { text: spelled, used } = resolveMarkers(body, () => false, csSpelling);
  const lines = spelled.split("\n");

  // What the unit's text needs: a namespace per symbol, plus an alias line per
  // aliased type.  Unaliased simple names must not collide across namespaces.
  const needNs: string[] = [];
  const needAlias: { alias: string; target: string }[] = [];
  const bySimple = new Map<string, string>();
  for (const s of used) {
    if (s.alias !== undefined) {
      needAlias.push({ alias: s.alias, target: `${s.module}.${s.name}` });
      continue;
    }
    if (s.name !== undefined) {
      const fq = `${s.module}.${s.name}`;
      const prior = bySimple.get(s.name);
      if (prior !== undefined && prior !== fq) {
        throw new Error(
          `${where}: two references spell '${s.name}' (${prior} and ${fq}) — give one handle an alias`,
        );
      }
      bySimple.set(s.name, fq);
    }
    if (!needNs.includes(s.module)) needNs.push(s.module);
  }

  // Slots render in place (once per namespace); hand-written lines stay.
  const written = new Set<string>();
  const aliases = new Map<string, string>();
  for (const [i, l] of lines.entries()) {
    if (slotAt.has(i)) continue;
    const u = USING_RE.exec(l);
    if (u) written.add(u[1]!);
    const a = ALIAS_RE.exec(l);
    if (a) aliases.set(a[1]!, a[2]!);
  }
  const drop = new Set<number>();
  for (const [i, ns] of slotAt) {
    if (needNs.includes(ns) && !written.has(ns)) {
      lines[i] = `using ${ns};`;
      written.add(ns);
    } else {
      drop.add(i);
    }
  }

  const own = NAMESPACE_RE.exec(spelled)?.[1];
  const covered = (ns: string): boolean =>
    written.has(ns) ||
    CS_IMPLICIT_USINGS.has(ns) ||
    (own !== undefined && (own === ns || own.startsWith(`${ns}.`)));
  const extra = needNs.filter((ns) => !covered(ns)).map((ns) => `using ${ns};`);
  for (const { alias, target } of needAlias) {
    const prior = aliases.get(alias);
    if (prior === undefined) extra.push(`using ${alias} = ${target};`);
    else if (prior !== target) {
      throw new Error(`${where}: alias '${alias}' already binds ${prior}, not ${target}`);
    }
  }

  const kept = lines.filter((_, i) => !drop.has(i));
  if (extra.length === 0) return kept.join("\n");
  // After the last plain `using` of the leading region; with none, directly
  // above the first declaration (with a separating blank line).
  let lastUsing = -1;
  let firstDecl = -1;
  for (const [i, l] of kept.entries()) {
    if (USING_RE.test(l)) {
      lastUsing = i;
      continue;
    }
    if (l.trim() === "" || /^\s*(\/\/|#|using\s)/.test(l)) continue;
    firstDecl = i;
    break;
  }
  if (lastUsing >= 0)
    return [...kept.slice(0, lastUsing + 1), ...extra, ...kept.slice(lastUsing + 1)].join("\n");
  if (firstDecl < 0) {
    throw new Error(
      `${where}: references ${extra.join(" ")} but has no declaration to place them above`,
    );
  }
  return [...kept.slice(0, firstDecl), ...extra, "", ...kept.slice(firstDecl)].join("\n");
}
