// ---------------------------------------------------------------------------
// Translator-tree namespaces — the pure key <-> file mapping.
//
// The translator tree holds one JSON file per (locale, namespace):
//
//   locales/<locale>/<ns>.json
//
// A namespace `<ns>` is one of
//
//   `_chrome`   keys stored VERBATIM: `chrome.*`, `pack.*`, the generic rule
//               messages `field.*` / `problem.*`, and any
//               key that does not start with a known namespace.
//   `_system`   keys under the reserved `_system.` prefix (prefix stripped).
//   a context   keys under `<Context>.` (prefix stripped).
//   a ui        keys under `<Ui>.` (prefix stripped): `WebApp.page.Home.…`
//               lives in `WebApp.json` as `page.Home.…`.
//
// The RUNTIME key (what `t()` is called with, what the generated catalogs and
// the lock are keyed by) is always the full `<ns>.<fileKey>` spelling; only the
// files drop the prefix, because the file name already carries it.
//
// Every reader and writer of the tree goes through this module so the mapping
// has one definition.  It is pure: no fs, no parse.
// ---------------------------------------------------------------------------

import { SYSTEM_TEXT_NS } from "../util/model-text-key.js";

/** Namespace holding keys that carry no context/ui prefix. */
export const CHROME_NS = "_chrome";
/** Reserved namespace for system-scoped keys — the identity text of a type
 *  declared outside every bounded context. */
const SYSTEM_NS = SYSTEM_TEXT_NS;

/** Prefixes whose keys always live verbatim in {@link CHROME_NS}, even when a
 *  context or ui happens to share the name. */
const CHROME_PREFIXES: readonly string[] = ["chrome", "pack", "field", "problem"];

/** The in-band `_stale.` shadow an older `--keep-stale` merge parked a dropped
 *  key under.  Current trees park them out of band (`locales/.loom/stale/`); the
 *  prefix is understood only so a legacy tree can be read and migrated by `sync`. */
const STALE_PREFIX = "_stale.";

/** Everything a key can be filed under besides {@link CHROME_NS}: the system's
 *  bounded-context names and ui names. */
export type NamespaceNames = ReadonlySet<string>;

/** A flat runtime-key -> message map, or one namespace file's content. */
export type Catalog = Record<string, string>;

/** The namespace a RUNTIME key belongs to, given the context and ui names. */
export function namespaceOf(key: string, names: NamespaceNames): string {
  if (key.startsWith(STALE_PREFIX)) return namespaceOf(key.slice(STALE_PREFIX.length), names);
  const dot = key.indexOf(".");
  if (dot <= 0) return CHROME_NS;
  const head = key.slice(0, dot);
  if (CHROME_PREFIXES.includes(head)) return CHROME_NS;
  if (head === SYSTEM_NS || names.has(head)) return head;
  return CHROME_NS;
}

/** The key as stored inside its namespace file. */
export function fileKeyOf(key: string, ns: string): string {
  if (ns === CHROME_NS) return key;
  if (key.startsWith(STALE_PREFIX)) {
    return `${STALE_PREFIX}${fileKeyOf(key.slice(STALE_PREFIX.length), ns)}`;
  }
  return key.slice(ns.length + 1);
}

/** The runtime key for a key stored in `ns`'s file — the inverse of
 *  {@link fileKeyOf}. */
export function runtimeKeyOf(fileKey: string, ns: string): string {
  if (ns === CHROME_NS) return fileKey;
  if (fileKey.startsWith(STALE_PREFIX)) {
    return `${STALE_PREFIX}${ns}.${fileKey.slice(STALE_PREFIX.length)}`;
  }
  return `${ns}.${fileKey}`;
}

/** Split a flat runtime catalog into per-namespace file contents (file keys,
 *  key-sorted).  Only namespaces that received a key appear. */
export function splitCatalog(flat: Catalog, names: NamespaceNames): Map<string, Catalog> {
  const out = new Map<string, Catalog>();
  for (const key of Object.keys(flat).sort()) {
    const ns = namespaceOf(key, names);
    let file = out.get(ns);
    if (!file) {
      file = {};
      out.set(ns, file);
    }
    file[fileKeyOf(key, ns)] = flat[key]!;
  }
  return new Map([...out].sort(([a], [b]) => a.localeCompare(b)));
}

/** Join per-namespace file contents back into one flat, key-sorted runtime
 *  catalog — the inverse of {@link splitCatalog}. */
export function joinCatalog(files: ReadonlyMap<string, Catalog>): Catalog {
  const flat: Catalog = {};
  for (const [ns, file] of files) {
    for (const fileKey of Object.keys(file)) flat[runtimeKeyOf(fileKey, ns)] = file[fileKey]!;
  }
  const out: Catalog = {};
  for (const key of Object.keys(flat).sort()) out[key] = flat[key]!;
  return out;
}

/** The namespace names a system contributes: its bounded contexts and uis. */
export function namespaceNamesOf(system: {
  subdomains: readonly { contexts: readonly { name: string }[] }[];
  uis: readonly { name: string }[];
}): Set<string> {
  const names = new Set<string>();
  for (const sub of system.subdomains) for (const ctx of sub.contexts) names.add(ctx.name);
  for (const ui of system.uis) names.add(ui.name);
  return names;
}
