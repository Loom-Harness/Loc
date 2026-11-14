// The hermetic fake-service kit — one in-process stand-in per external service a
// generated backend talks to, the same way on every behavioural leg.
//
// Every fake module exports `start(opts) → { kind, env, observe(), reset(),
// stop() }`:
//   * `env`       — what the generated backend already reads to find the
//                   service, named by `src/util/resource-env.ts` (never by the kit);
//   * `observe()` — a normalised, order-stable list of what the backend sent it;
//   * `reset()`   — forget the observations; `stop()` — release the ports.
//
// `startSidecars` (sidecars.mjs) derives which fakes a case needs from its
// model.  The runners append the observations to the wire recording as its
// `effects` section, keyed by `kind`, and diff it against the golden with
// `diffEffects` on every leg.

export { quiesce } from "./quiesce.mjs";
export { mayNeedSidecars, plannedFakes, startSidecars, STORAGE_FAKES, SYSTEM_FAKES } from "./sidecars.mjs";

/**
 * Structural diff of two `effects` sections.  Returns one `{ path, golden,
 * actual }` per divergence; `path` is JSONPath-like (`$.mail[0].subject`).  A
 * kind present on one side only is one divergence for the whole kind, and a
 * list whose length differs is one divergence for the length followed by the
 * per-index ones of the shared prefix.
 *
 * @param {Record<string, unknown[]> | undefined} golden
 * @param {Record<string, unknown[]> | undefined} actual
 */
export function diffEffects(golden, actual) {
  const out = [];
  const walk = (g, a, path) => {
    if (JSON.stringify(g) === JSON.stringify(a)) return;
    if (Array.isArray(g) && Array.isArray(a)) {
      if (g.length !== a.length) out.push({ path: `${path}.length`, golden: g.length, actual: a.length });
      for (let i = 0; i < Math.min(g.length, a.length); i++) walk(g[i], a[i], `${path}[${i}]`);
      return;
    }
    if (g && a && typeof g === "object" && typeof a === "object" && !Array.isArray(g) && !Array.isArray(a)) {
      for (const k of [...new Set([...Object.keys(g), ...Object.keys(a)])].sort()) walk(g[k], a[k], `${path}.${k}`);
      return;
    }
    out.push({ path, golden: g, actual: a });
  };
  walk(golden ?? {}, actual ?? {}, "$");
  return out;
}

/** True when an `effects` section records nothing. */
export function isEmptyEffects(effects) {
  return !effects || Object.keys(effects).length === 0;
}
