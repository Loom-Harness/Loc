// The `gateway` platform: one front door over the web deployables its
// `gathers:` clause lists, each served under its own base path.  It hosts no
// ui, no context and no database, and its parts all target one backend.
//
// Its project (an nginx config routing `/api` and every gathered path) is a
// composition of the system's other services, so the system orchestrator
// renders it (`src/system/gateway.ts`); the surface carries the descriptor
// facts and the compose shape.

import { GATEWAY_HEALTH_PATH } from "../util/api-base.js";
import { TARGET_CAPABILITIES } from "../util/target-capabilities.js";
import { FRONTEND_OPERATIONS, type PlatformOperations } from "./operations.js";
import type { ComposeServiceShape, PlatformSurface } from "./surface.js";
import { TARGET_FACTS } from "./target-facts.js";

/** The port the gateway's nginx listens on inside its container. */
export const GATEWAY_LISTEN_PORT = 8080;

/** The gateway answers its own probe, so it reports healthy whether or not a
 *  part is up. */
const GATEWAY_OPERATIONS: PlatformOperations = {
  ...FRONTEND_OPERATIONS,
  health: {
    liveness: GATEWAY_HEALTH_PATH,
    readiness: GATEWAY_HEALTH_PATH,
    compose: GATEWAY_HEALTH_PATH,
  },
};

const gatewayPlatform: PlatformSurface = {
  name: "gateway",
  defaultPort: 8080,
  needsDb: false,
  mountsUi: false,
  isFrontend: false,
  hostableFrameworks: new Set(),
  capabilities: TARGET_CAPABILITIES.gateway,
  facts: TARGET_FACTS.gateway,
  emitProject(): Map<string, string> {
    return new Map();
  },
  operations: GATEWAY_OPERATIONS,
  composeService({ deployable, sys }): ComposeServiceShape {
    const byName = new Map(sys.deployables.map((d) => [d.name, d]));
    const parts = (deployable.gathers ?? []).map((g) => g.deployable);
    const backends = parts.flatMap((p) => byName.get(p)?.targetName ?? []);
    return {
      env: [],
      dependsOnDb: false,
      internalPort: GATEWAY_LISTEN_PORT,
      awaits: [...new Set([...backends, ...parts])].filter((n) => byName.has(n)),
    };
  },
};

export default gatewayPlatform;
