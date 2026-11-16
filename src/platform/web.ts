// The `web` platform: a static-bundle frontend host.  It targets a backend,
// inherits that backend's contexts, owns no database, and renders its bound
// ui in that ui's `framework:` — react, vue, svelte or angular — served as a
// built bundle (D-WEB-PLATFORM).  The framework, not the platform, picks the
// generator and the default port.

import { API_BASE_PATH } from "../util/api-base.js";
import { TARGET_CAPABILITIES } from "../util/target-capabilities.js";
import { dispatchFrontendProject } from "./frontend-dispatch.js";
import { FRONTEND_OPERATIONS } from "./operations.js";
import {
  type ComposeServiceShape,
  type PlatformSurface,
  STATIC_BUNDLE_FRAMEWORKS,
} from "./surface.js";
import { TARGET_FACTS } from "./target-facts.js";

const webPlatform: PlatformSurface = {
  name: "web",
  // The port of a React bundle; a deployable rendering another framework
  // takes that framework's `webDefaultPort` (lowering reads both).
  defaultPort: 3001,
  // Frontends are SPAs hitting a peer backend; they own no DB.
  needsDb: false,
  mountsUi: true,
  isFrontend: true,
  // Standalone static-asset host: serves any static-bundle framework.
  hostableFrameworks: STATIC_BUNDLE_FRAMEWORKS,
  capabilities: TARGET_CAPABILITIES.web,
  facts: TARGET_FACTS.web,
  emitProject({
    contexts,
    sys,
    deployable,
    topLevelComponents,
    frontendContract,
    sourcemap,
    translations,
  }): Map<string, string> {
    // The bound ui's framework picks the generator; React renders a ui that
    // states none.
    return dispatchFrontendProject(deployable.uiFramework, "react", {
      contexts,
      sys,
      deployable,
      topLevelComponents,
      frontendContract,
      sourcemap,
      translations,
    });
  },
  operations: FRONTEND_OPERATIONS,
  composeService({ deployable, sys }): ComposeServiceShape {
    const target = sys.deployables.find((t) => t.name === deployable.targetName);
    return {
      env: [["VITE_API_BASE_URL", `http://localhost:${target?.port ?? 8080}${API_BASE_PATH}`]],
      dependsOnDb: false,
      internalPort: 3000,
      injectsApiProxyTarget: true,
    };
  },
};

export default webPlatform;
