// The root namespace a generated stack derives from the model's system name.
//
// Generated code carries no tool name (docs/decisions/D-NO-TOOL-NAME.md).
// Where a runtime name needs a prefix that keeps one application's names apart
// from another's — the broker topology, the CloudEvents `source`, a browser
// storage key, the broker virtual host — it is the system's own name, spelled
// once here: lower snake case, `[a-z0-9_]` only, `app_` before a leading digit.
// Every emitter reads it through this function, so a producer in one backend
// and a consumer in another agree on every exchange and topic.

import { snake } from "./naming.js";

/** `ShopFloor` → `shop_floor`. */
export function systemNamespace(systemName: string): string {
  const s = snake(systemName)
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (s === "") return "app";
  return /^[0-9]/.test(s) ? `app_${s}` : s;
}

/** The browser `localStorage` key holding the chosen locale. */
export function localeStorageKey(namespace: string): string {
  return `${namespace}.locale`;
}

/** The cookie (and LiveView session key) carrying the chosen locale to a
 *  server-rendered host. */
export function localeCookieName(namespace: string): string {
  return `${namespace}_locale`;
}

/** The browser storage key a persisted page store keeps its state under —
 *  one key per store, the same on every frontend. */
export function storeStorageKey(namespace: string, storeName: string): string {
  return `${namespace}.store.${storeName}`;
}

/** A name as a lower-kebab token (`ShopFloor` → `shop-floor`): the spelling an
 *  npm package name and a container name take. */
function kebabToken(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The system's name as a lower-kebab token, `app` when nothing survives. */
export function systemSlug(systemName: string): string {
  return kebabToken(systemName) || "app";
}

/** A generated project's npm package name: `<system>-<deployable>`
 *  (`shop-web`), or `<system>-e2e` for the system-level test package
 *  (no deployable). */
export function projectPackageName(systemName: string, deployableName?: string): string {
  const d = deployableName === undefined ? "e2e" : kebabToken(deployableName);
  return d === "" ? systemSlug(systemName) : `${systemSlug(systemName)}-${d}`;
}

/** The npm package name of a deployable's Playwright suite. */
export function e2ePackageName(systemName: string, deployableName: string): string {
  return `${projectPackageName(systemName, deployableName)}-e2e`;
}
