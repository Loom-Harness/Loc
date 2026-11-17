// What one Boot brings up: the storages of the system's Node deployables and
// every deployable on the storage it binds.  Pure — the root vitest suite
// imports it.

import type { BundleOk } from "../bundle/protocol.js";
import type { BackendBundle } from "../engine/runtime-engine.js";
import type { BootPlan, MigrationPlan } from "../runtime/protocol.js";
import type { OidcSetup } from "../backend/oidc-personas.js";
import type { StoragePlan } from "./protocol.js";

export interface BootableBackend {
  slug: string;
  entry: string;
  bundle: BundleOk;
}

/** The backends that bundled — what a boot starts.  A system boots partly:
 *  a backend whose bundle failed is left out (see `unavailableDeployables`)
 *  and the others run.  Null when none bundled. */
export function bootableBackends(backends: readonly BackendBundle[]): BootableBackend[] | null {
  const out: BootableBackend[] = [];
  for (const b of backends) {
    if (b.bundle.ok) out.push({ slug: b.slug, entry: b.entry, bundle: b.bundle });
  }
  return out.length > 0 ? out : null;
}

/** A deployable of the system that does not run in this boot, and why. */
export interface UnavailableDeployable {
  slug: string;
  reason: string;
}

/** The system's deployables a boot of `booted` leaves out: the Hono backends
 *  that did not bundle (`honoSlugs` not booted), and the deployables on a
 *  platform the browser cannot run (`unsupported`, with its platform label).
 *  Sorted by slug. */
export function unavailableDeployables(
  honoSlugs: readonly string[],
  booted: readonly string[],
  unsupported: readonly { slug: string; label: string }[],
): UnavailableDeployable[] {
  const out: UnavailableDeployable[] = [
    ...honoSlugs
      .filter((slug) => !booted.includes(slug))
      .map((slug) => ({ slug, reason: "its bundle failed (see the Bundle stage)" })),
    ...unsupported.map((d) => ({ slug: d.slug, reason: `${d.label} runs outside the playground` })),
  ];
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
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
  /** The fake identity provider's realms and personas: when set, every
   *  deployable whose env names an `OIDC_ISSUER` boots its generated OIDC
   *  verifier; otherwise every deployable boots the dev stub. */
  oidc: OidcSetup | null = null,
  /** The system's deployables this boot leaves out: a call to one fails
   *  with its reason. */
  unavailable: readonly UnavailableDeployable[] = [],
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
    ...(oidc ? { oidc: { realms: oidc.realms, personas: oidc.personas } } : {}),
    ...(unavailable.length > 0 ? { unavailable: [...unavailable] } : {}),
    storages: groups
      .filter((g) => bound.has(g.key))
      .map((g) => {
        const { dataDir, island } = placement(g.key);
        if (island !== null) islands.push(island);
        return { key: g.key, dataDir, migrations: g.plan };
      }),
    backends: backends.map((b) => {
      const env = envOf?.(b.slug);
      return {
        slug: b.slug,
        bundleCode: b.bundle.code,
        storage: storageOf(b.slug),
        ...(env ? { env } : {}),
        ...(oidc && env?.OIDC_ISSUER ? { verifier: "configured" as const } : {}),
      };
    }),
  };
  return { plan: out, islands };
}
