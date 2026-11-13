// Tests-tab discovery: load every generated suite of a tree, each on its own.
//
// A suite that fails to build or import is reported by name, and the others
// stay listed and runnable — one broken suite (a UI spec the harness cannot
// load) must not empty the Tests list.  Pure: the loaders are injected, so the
// root vitest suite drives it without a worker or a booted runtime.

import type { SuiteLoadFailure } from "./suite-deps.js";

export interface SuiteToLoad<T> {
  /** The suite's label in the Tests list ("orders", "UI", "API"). */
  label: string;
  /** The generated file it loads from. */
  path: string;
  load: () => Promise<T>;
}

export interface DiscoveryPlan<U, I, A> {
  units: SuiteToLoad<U>[];
  ui: SuiteToLoad<I> | null;
  api: SuiteToLoad<A> | null;
}

export interface Discovered<U, I, A> {
  units: { label: string; path: string; cases: U }[];
  ui: I | null;
  api: A | null;
  failures: SuiteLoadFailure[];
}

/** Load the plan's suites in order (units, UI, API), announcing each through
 *  `step`.  Null when `cancelled()` turns true between suites. */
export async function discoverSuites<U, I, A>(
  plan: DiscoveryPlan<U, I, A>,
  hooks: { step: (label: string) => void; cancelled: () => boolean },
): Promise<Discovered<U, I, A> | null> {
  const failures: SuiteLoadFailure[] = [];
  const attempt = async <T>(s: SuiteToLoad<T>): Promise<T | null> => {
    hooks.step(s.label);
    try {
      return await s.load();
    } catch (e) {
      failures.push({ suite: s.label, path: s.path, message: e instanceof Error ? e.message : String(e) });
      return null;
    }
  };
  const units: Discovered<U, I, A>["units"] = [];
  for (const s of plan.units) {
    if (hooks.cancelled()) return null;
    const cases = await attempt(s);
    if (cases !== null) units.push({ label: s.label, path: s.path, cases });
  }
  if (hooks.cancelled()) return null;
  const ui = plan.ui ? await attempt(plan.ui) : null;
  if (hooks.cancelled()) return null;
  const api = plan.api ? await attempt(plan.api) : null;
  if (hooks.cancelled()) return null;
  return { units, ui, api, failures };
}
