import type { BootFailAt, DeployableBootInfo } from "../runtime/protocol";

export type DeployableState = "booted" | "error" | "not-booted";

export interface DeployableRow {
  slug: string;
  state: DeployableState;
  /** The storage the deployable binds, once a boot has said; null too for a
   *  deployable with no database layer. */
  storage: string | null;
  /** A mock backend: it serves the api from generated rows, no rules. */
  mock: boolean;
}

/** One row per bundled deployable: booted, failed at, or not booted.  The
 *  failed one is the deployable the boot named; the others never started
 *  (a failed boot leaves nothing half-started). */
export function deployableRows(
  bundled: readonly string[],
  booted: readonly DeployableBootInfo[],
  failAt: BootFailAt | null,
  mocks: readonly string[] = [],
): DeployableRow[] {
  const slugs = [...new Set([...booted.map((b) => b.slug), ...bundled])];
  return slugs.map((slug) => {
    const b = booted.find((x) => x.slug === slug);
    const state: DeployableState = b
      ? "booted"
      : failAt?.deployable === slug
        ? "error"
        : "not-booted";
    return { slug, state, storage: b?.storage ?? null, mock: mocks.includes(slug) };
  });
}
