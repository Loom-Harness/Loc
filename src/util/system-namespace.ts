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
