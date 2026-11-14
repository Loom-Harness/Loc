import type { BootFailAt, DeployableBootInfo } from "../runtime/protocol";

export type DeployableState = "booted" | "error" | "not-booted" | "unavailable";

export interface DeployableRow {
  slug: string;
  state: DeployableState;
  /** The storage the deployable binds, once a boot has said. */
  storage: string | null;
  /** Why an `unavailable` deployable does not run in the playground. */
  reason?: string;
}

/** One row per bundled deployable: booted, failed at, or not booted.  The
 *  failed one is the deployable the boot named; the others never started
 *  (a failed boot leaves nothing half-started).  Then one row per deployable
 *  the boot left out (`unavailable`), with why. */
export function deployableRows(
  bundled: readonly string[],
  booted: readonly DeployableBootInfo[],
  failAt: BootFailAt | null,
  unavailable: readonly { slug: string; reason: string }[] = [],
): DeployableRow[] {
  const away = new Set(unavailable.map((d) => d.slug));
  const slugs = [...new Set([...booted.map((b) => b.slug), ...bundled])].filter((slug) => !away.has(slug));
  return [...slugs.map((slug) => {
    const b = booted.find((x) => x.slug === slug);
    const state: DeployableState = b
      ? "booted"
      : failAt?.deployable === slug
        ? "error"
        : "not-booted";
    return { slug, state, storage: b?.storage ?? null };
  }), ...unavailable.map((d): DeployableRow => ({ slug: d.slug, state: "unavailable", storage: null, reason: d.reason }))];
}
