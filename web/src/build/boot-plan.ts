// What one Boot brings up: the storages of the system's Node deployables and
// every deployable on the storage it binds.  Pure — the root vitest suite
// imports it.

import type { BundleOk } from "../bundle/protocol.js";
import type { BackendBundle } from "../engine/runtime-engine.js";
import type { BootPlan, MigrationPlan } from "../runtime/protocol.js";
import type { StoragePlan } from "./protocol.js";

export interface BootableBackend {
  slug: string;
  entry: string;
  bundle: BundleOk;
}

/** Every backend's bundle, when all of them bundled — a system boots whole or
 *  not at all.  Null when any failed or there is none. */
export function bootableBackends(backends: readonly BackendBundle[]): BootableBackend[] | null {
  if (backends.length === 0) return null;
  const out: BootableBackend[] = [];
  for (const b of backends) {
    if (!b.bundle.ok) return null;
    out.push({ slug: b.slug, entry: b.entry, bundle: b.bundle });
  }
  return out;
}

/** The storage of a source without a system: one database for its one
 *  backend. */
export const DEFAULT_STORAGE = "default";

/** The boot plan for `backends` over the build worker's storage plans.
 *  `placement` picks each storage's data dir, and names the OPFS island it
 *  uses (null for an in-memory one). */
export function bootPlan(
  backends: readonly BootableBackend[],
  plan: MigrationPlan,
  storages: readonly StoragePlan[],
  placement: (storageKey: string) => { dataDir: string; island: string | null },
  /** The process env of a deployable's compose service. */
  envOf?: (slug: string) => Record<string, string>,
  restSpecs: { origin: string; spec: object }[] = [],
): { plan: BootPlan; islands: string[] } {
  const groups: StoragePlan[] =
    storages.length > 0
      ? [...storages]
      : [{ key: DEFAULT_STORAGE, deployables: backends.map((b) => b.slug), plan }];
  const storageOf = (slug: string): string =>
    groups.find((g) => g.deployables.includes(slug))?.key ?? groups[0]?.key ?? DEFAULT_STORAGE;
  // Only the storages some bundled backend binds are opened.
  const bound = new Set(backends.map((b) => storageOf(b.slug)));
  const islands: string[] = [];
  const out: BootPlan = {
    ...(restSpecs.length > 0 ? { restSpecs } : {}),
    storages: groups
      .filter((g) => bound.has(g.key))
      .map((g) => {
        const { dataDir, island } = placement(g.key);
        if (island !== null) islands.push(island);
        return { key: g.key, dataDir, migrations: g.plan };
      }),
    backends: backends.map((b) => ({
      slug: b.slug,
      bundleCode: b.bundle.code,
      storage: storageOf(b.slug),
      ...(envOf ? { env: envOf(b.slug) } : {}),
    })),
  };
  return { plan: out, islands };
}
