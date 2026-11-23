// The `mock` platform: a contract-class backend.  A deployable on it hosts
// contexts and `serves:` apis so a frontend can `targets:` it exactly as it
// targets a domain backend, but it runs no domain logic and owns no
// database (`facts.servesContractOnly`).  Its project is a dependency-free
// Node server that answers `/health` and refuses every other route with 501
// (`src/generator/mock/`).

import {
  generateMockProject,
  MOCK_HEALTH_PATH,
  MOCK_LISTEN_PORT,
} from "../generator/mock/index.js";
import { TARGET_CAPABILITIES } from "../util/target-capabilities.js";
import { wgetHealthcheck } from "./operations.js";
import type { ComposeServiceShape, PlatformSurface } from "./surface.js";
import { TARGET_FACTS } from "./target-facts.js";

const mockPlatform: PlatformSurface = {
  name: "mock",
  defaultPort: 3000,
  needsDb: false,
  mountsUi: false,
  isFrontend: false,
  hostableFrameworks: new Set(),
  capabilities: TARGET_CAPABILITIES.mock,
  facts: TARGET_FACTS.mock,
  emitProject({ deployable }): Map<string, string> {
    return generateMockProject({ deployable });
  },
  operations: {
    // The server has no dependency to be ready for, so one path serves all
    // three probes.
    health: { liveness: MOCK_HEALTH_PATH, readiness: MOCK_HEALTH_PATH, compose: MOCK_HEALTH_PATH },
    // The alpine image's busybox `wget`; the listener is dual-stack, so
    // `localhost` reaches it whichever family it resolves to first.
    healthcheck: wgetHealthcheck,
    healthcheckBinaries: ["wget"],
    // `server.listen(port)` with no host binds `::`, which accepts IPv4 too,
    // and falls back to `0.0.0.0` on a host with no IPv6.
    listen: "dual-stack",
    log: { format: "text" },
    // `PORT` defaults to the listen port in the image.
    env: () => [{ name: "PORT", need: "optional" }],
  },
  composeService(): ComposeServiceShape {
    return {
      env: [],
      dependsOnDb: false,
      internalPort: MOCK_LISTEN_PORT,
    };
  },
};

export default mockPlatform;
