// The `mock` platform: a contract-class backend.  A deployable on it hosts
// contexts and `serves:` apis so a frontend can `targets:` it exactly as it
// targets a domain backend, but it runs no domain logic and owns no
// database (`facts.servesContractOnly`).  Its project is a Hono app with the
// node backend's routes and schemas, answering from an in-memory store of
// generated rows (`./mock/`).  It shares the node backend's dependency pins.

import { TARGET_CAPABILITIES } from "../util/target-capabilities.js";
import { BACKEND_PINS } from "./hono/v5/pins.js";
import { generateMockProject, MOCK_HEALTH_PATH, MOCK_LISTEN_PORT } from "./mock/index.js";
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
  emitProject({ contexts, deployable, sys }): Map<string, string> {
    return generateMockProject({ contexts, deployable, sys, pins: BACKEND_PINS });
  },
  operations: {
    // The app has no dependency to be ready for: `/ready` answers as soon as
    // `/health` does.
    health: { liveness: MOCK_HEALTH_PATH, readiness: "/ready", compose: MOCK_HEALTH_PATH },
    // The alpine image's busybox `wget`; `@hono/node-server` listens
    // dual-stack, so `localhost` reaches it whichever family it resolves to.
    healthcheck: wgetHealthcheck,
    healthcheckBinaries: ["wget"],
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
