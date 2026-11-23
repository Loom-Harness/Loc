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
