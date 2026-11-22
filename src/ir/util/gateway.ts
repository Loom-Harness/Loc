// Where a gathered web deployable is served: the gateway that lists it in its
// `gathers:` clause, and the base path it sits under there.
//
// A part's build, its compose healthcheck, its chart probes and the gateway's
// own routes all read the same answer, so it is decided here once.  The root
// path `/` is no base path: a part served at the root builds exactly as it
// does without a gateway.

import type { DeployableIR, GatheredPartIR, SystemIR } from "../types/loom-ir.js";

/** The gateways of a system: the deployables with a `gathers:` clause. */
export function gatewaysOf(sys: SystemIR): DeployableIR[] {
  return sys.deployables.filter((d) => d.gathers !== undefined);
}

/** The gateway that gathers `deployable`, and its entry there.  A part sits
 *  behind at most one gateway (`loom.gateway-part-shared`). */
function gatheringOf(
  sys: SystemIR,
  deployable: string,
): { gateway: DeployableIR; part: GatheredPartIR } | undefined {
  for (const gateway of gatewaysOf(sys)) {
    const part = gateway.gathers?.find((g) => g.deployable === deployable);
    if (part) return { gateway, part };
  }
  return undefined;
}

/** The base path `deployable` is built and served under (`/ops`), or
 *  undefined when no gateway gathers it or it sits at the gateway's root. */
export function gatheredBasePath(sys: SystemIR, deployable: string): string | undefined {
  const path = gatheringOf(sys, deployable)?.part.path;
  return path === undefined || path === "/" ? undefined : path;
}

/** One app a gateway serves on the same origin as `deployable`: its own and
 *  every sibling part, in the gateway's `gathers:` order. */
export interface GatheredApp {
  deployable: string;
  /** The ui it renders, by name (absent for a part with no ui). */
  uiName?: string;
  /** Where the browser reaches it on the gateway's origin: `/`, `/ops/`. */
  href: string;
}

/** The apps of the gateway that gathers `deployable`, or undefined when no
 *  gateway does. */
export function gatheredApps(sys: SystemIR, deployable: string): GatheredApp[] | undefined {
  const gathering = gatheringOf(sys, deployable);
  if (!gathering) return undefined;
  const byName = new Map(sys.deployables.map((d) => [d.name, d]));
  return (gathering.gateway.gathers ?? []).map((g) => {
    const uiName = byName.get(g.deployable)?.uiName;
    return {
      deployable: g.deployable,
      ...(uiName !== undefined ? { uiName } : {}),
      href: g.path === "/" ? "/" : `${g.path}/`,
    };
  });
}
