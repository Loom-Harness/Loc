// ---------------------------------------------------------------------------
// hono@v5 — the cross-major successor backend package (see ./pins.ts).
//
// A backend package version reuses the shared emitter slices by ordinary
// import and overrides only what its major change touches.  v5 is purely
// a pin set fed through the shared `makeHonoPlatform` factory
// (`../v4/index.ts`, which registers no version of its own).  It is the
// only registered `node` version; `node@v4` (zod 3 / TS 5) was retired.
// ---------------------------------------------------------------------------

import type { LoomBackendManifest } from "../../manifest.js";
import type { PlatformSurface } from "../../surface.js";
import { makeHonoPlatform } from "../v4/index.js";
import { BACKEND_PINS } from "./pins.js";

/** The descriptor the resolver discovers this package by.  `family:
 *  "node"` names the JS runtime platform; `loomVersion: "v5"` is the
 *  package's own version — driven by the zod 4 / TS 6 majors rather than
 *  a Hono major (Hono stays 4.x). */
export const loomManifest: LoomBackendManifest = {
  kind: "backend",
  family: "node",
  loomVersion: "v5",
  core: "^1.0.0",
};

const honoV5Platform: PlatformSurface = makeHonoPlatform(BACKEND_PINS);

export default honoV5Platform;
