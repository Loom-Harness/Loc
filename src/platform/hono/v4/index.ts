// ---------------------------------------------------------------------------
// The shared Hono backend surface.  `makeHonoPlatform(pins)` builds the
// `PlatformSurface` over the TypeScript/Hono emitter in this directory;
// the registered package version (`../v5/`) owns the dep pins and calls
// it.  This directory holds no registered version of its own.
// ---------------------------------------------------------------------------

import type {
  PlatformAdapterDefaults,
  PlatformAdapters,
} from "../../../generator/_adapters/index.js";
import { TARGET_CAPABILITIES } from "../../../util/target-capabilities.js";
import {
  type ComposeServiceShape,
  type PlatformSurface,
  STATIC_BUNDLE_FRAMEWORKS,
} from "../../surface.js";
import { byFeatureLayoutAdapter } from "./adapters/by-feature-layout.js";
import { byLayerLayoutAdapter } from "./adapters/by-layer-layout.js";
import { drizzlePersistenceAdapter } from "./adapters/drizzle-persistence.js";
import { layeredStyleAdapter } from "./adapters/layered-style.js";
import { mikroOrmPersistenceAdapter } from "./adapters/mikroorm-persistence.js";
import { type BackendPins, generateTypeScriptForContexts } from "./emit.js";

/** Build the Hono `PlatformSurface` for a given dep-pin set.  The
 *  surface shape is identical across Hono package versions — only the
 *  `BACKEND_PINS` fed to the shared emitter differ — so each registered
 *  version passes its own `pins.ts` rather than copying the surface. */
export function makeHonoPlatform(pins: BackendPins): PlatformSurface {
  return {
    name: "node",
    defaultPort: 3000,
    needsDb: true,
    mountsUi: false,
    isFrontend: false,
    // Static-asset host (static middleware): serves any static-bundle
    // framework.  D-PHOENIX-SURFACE.
    hostableFrameworks: STATIC_BUNDLE_FRAMEWORKS,
    // Hono repository auto-emits these per aggregate — see
    // src/generator/typescript/repository-builder.ts (`async save`,
    // `async findById`, `async getById`).  A user-declared find with
    // one of these names would compile-error with TS2393 "Duplicate
    // function implementation".
    reservedRepositoryFindNames: new Set(["save", "findById", "getById", "delete"]),
    capabilities: TARGET_CAPABILITIES.node,
    emitProject({
      contexts,
      deployable,
      sys,
      migrations,
      emitTrace,
      styleAdapter,
      layoutAdapter,
      sourcemap,
    }): Map<string, string> {
      // The package supplies its own pins to the shared emitter —
      // edge points package → shared, never the reverse.  The deployable's
      // resolved style / layout adapters (D-REALIZATION-AXES) are forwarded
      // straight through into the generator's EmitCtx.
      return generateTypeScriptForContexts(
        contexts,
        pins,
        { deployable, sys, migrations, styleAdapter, layoutAdapter },
        { emitTrace, sourcemap },
      );
    },
    composeService({ slug }): ComposeServiceShape {
      return {
        env: [
          ["DATABASE_URL", `postgres://postgres:postgres@db:5432/${slug}`],
          // Runtime log-level knob (default info; overridable here / in k8s).
          ["LOG_LEVEL", "info"],
        ],
        dependsOnDb: true,
        // Compose healthcheck → /ready (DB-aware).  Sets the service
        // `healthy` only once the app can reach its DB, so dependent
        // services / smoke tests don't race the schema bootstrap.
        // /health stays for cheap liveness probing (k8s livenessProbe).
        healthPath: "/ready",
        internalPort: 3000,
      };
    },
    // hono (Node backend) — `drizzle` + `mikroorm` persistence + `layered` style
    // + `byLayer` / `byFeature` layout.  Built lazily (see PlatformSurface jsdoc).
    adapters(): PlatformAdapters {
      const menu: PlatformAdapters = {
        persistence: {
          drizzle: drizzlePersistenceAdapter,
          mikroorm: mikroOrmPersistenceAdapter,
        },
        styles: {
          layered: layeredStyleAdapter,
        },
        layouts: {
          byLayer: byLayerLayoutAdapter,
          byFeature: byFeatureLayoutAdapter,
        },
      };
      return menu;
    },
    adapterDefaults(): PlatformAdapterDefaults {
      return {
        persistence: { state: "drizzle", eventLog: "drizzle" },
        style: "layered",
        layout: "byLayer",
      };
    },
    // (Node debug wiring) — moved verbatim from the old
    // `NodeLaunchTarget`-based `renderVsCodeLaunchJson` (src/system/
    // launch-config.ts) when the seam generalized to per-backend
    // `debugLaunch` (M26).  BYTE-IDENTICAL with the pre-M26 shape:
    // `test/system/sourcemap.test.ts`'s byte-identical gate covers node
    // output. Plain Node against the deployable's own `index.ts` with
    // `--enable-source-maps` — no `--experimental-strip-types`: the docker
    // image this project ships (`node:24-alpine`) has type-stripping
    // unflagged by default, so the config targets that runtime. A LOCAL
    // host Node older than 23.6 needs the flag added by hand; a host Node
    // older than 22.6 doesn't support stripping at all. Requires the
    // sibling `addTsExtensionsForNodeDebug` import rewrite
    // (src/generator/typescript/debug-imports.ts, applied in
    // src/platform/hono/v4/emit.ts) — both are gated on the same flag, so
    // they always ship together.
    debugLaunch({ deployable, slug }): Record<string, unknown> {
      return {
        type: "node",
        request: "launch",
        name: `Debug ${deployable.name} (node --enable-source-maps)`,
        program: `\${workspaceFolder}/${slug}/index.ts`,
        cwd: `\${workspaceFolder}/${slug}`,
        runtimeArgs: ["--enable-source-maps"],
        outFiles: [`\${workspaceFolder}/${slug}/**/*.ts`],
        resolveSourceMapLocations: [`\${workspaceFolder}/${slug}/**`, "!**/node_modules/**"],
        skipFiles: ["<node_internals>/**"],
        console: "integratedTerminal",
      };
    },
  };
}
