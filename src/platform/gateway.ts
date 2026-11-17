// The `gateway` platform: one front door over the web deployables its
// `gathers:` clause lists, each served under its own base path.  It hosts no
// ui, no context and no database, and its parts all target one backend.
//
// The surface carries the descriptor facts the validators read.  It emits no
// project files, and the system orchestrator composes no service for it
// (`TargetFacts.gathersWebDeployables`).

import { TARGET_CAPABILITIES } from "../util/target-capabilities.js";
import { FRONTEND_OPERATIONS } from "./operations.js";
import type { ComposeServiceShape, PlatformSurface } from "./surface.js";
import { TARGET_FACTS } from "./target-facts.js";

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
  // A reverse proxy answers its probes at its root, like a static bundle.
  operations: FRONTEND_OPERATIONS,
  composeService({ deployable }): ComposeServiceShape {
    return { env: [], dependsOnDb: false, internalPort: deployable.port };
  },
};

export default gatewayPlatform;
