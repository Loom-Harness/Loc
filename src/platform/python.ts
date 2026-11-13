import { generatePythonForContexts } from "../generator/python/index.js";
import { databaseOf } from "../ir/util/databases.js";
import { serviceSlug } from "../util/service-slug.js";
import { TARGET_CAPABILITIES } from "../util/target-capabilities.js";
import {
  BACKEND_HEALTH,
  BROKER_BASELINE,
  BROKER_BASELINE_GAPS,
  MIGRATIONS_BASELINE,
  wgetHealthcheck,
} from "./operations.js";
import { backendEnvContract } from "./operations-env.js";
import {
  type ComposeServiceShape,
  EMBEDDABLE_FRAMEWORKS,
  type PlatformSurface,
} from "./surface.js";
import { TARGET_FACTS } from "./target-facts.js";

// ---------------------------------------------------------------------------
// Python platform — FastAPI + SQLAlchemy 2 backend deployable
// (canonical language-ecosystem name, like `node`/`dotnet`/`elixir`;
// the `fastapi` framework-spelled platform alias was RETIRED — `python`
// is the only spelling, mirroring the retired `hono`/`phoenix` aliases).
//
// Backend-only: serves an api (`serves:`), owns a Postgres database
// (`needsDb: true`), mounts no `ui:` in v1 (static SPA hosting is a
// later slice — `hostableFrameworks` records the static-asset-host
// capability the dormant `hosts:` check will consume).
//
// All project emission (pyproject.toml, Dockerfile, app/*, Alembic
// migrations) lives under `../generator/python/`; this module is the
// thin `PlatformSurface` wiring.  The adapter menu (`adapters()` /
// `adapterDefaults()`) lands with the persistence slice — until then
// `hasAdapters("python")` is false and the orchestrator passes no
// resolved style/layout.
// ---------------------------------------------------------------------------

const pythonPlatform: PlatformSurface = {
  name: "python",
  // uvicorn convention.
  defaultPort: 8000,
  needsDb: true,
  // Dual-mode like dotnet: a backend-only python deployable has no
  // `uiName`; with `ui:` it hosts the embedded React SPA from wwwroot/.
  mountsUi: true,
  isFrontend: false,
  // Static-asset host (FastAPI StaticFiles): can serve any
  // static-bundle framework.  D-PHOENIX-SURFACE.
  hostableFrameworks: EMBEDDABLE_FRAMEWORKS,
  capabilities: TARGET_CAPABILITIES.python,
  facts: TARGET_FACTS.python,
  emitProject({
    contexts,
    deployable,
    sys,
    migrations,
    emitTrace,
    sourcemap,
  }): Map<string, string> {
    return generatePythonForContexts({
      contexts,
      deployable,
      sys,
      migrations,
      emitTrace,
      sourcemap,
    });
  },
  operations: {
    health: BACKEND_HEALTH,
    healthcheck: wgetHealthcheck,
    healthcheckBinaries: ["wget"],
    env: (args) =>
      backendEnvContract(
        args,
        pythonPlatform.composeService({ ...args, slug: serviceSlug(args.deployable.name) }),
      ),
    listen: "ipv4",
    log: { format: "loom-json", levelEnv: "LOG_LEVEL" },
    // The FastAPI relay backs off on an unreachable broker without spending attempts.
    broker: BROKER_BASELINE,
    migrations: MIGRATIONS_BASELINE,
    gaps: BROKER_BASELINE_GAPS,
  },
  composeService({ slug, deployable, sys }): ComposeServiceShape {
    const database = databaseOf(sys, deployable)?.name ?? slug;
    return {
      env: [
        ["DATABASE_URL", `postgresql+asyncpg://postgres:postgres@db:5432/${database}`],
        // Runtime log-level knob (default info; overridable here / in k8s).
        ["LOG_LEVEL", "info"],
      ],
      dependsOnDb: true,
      // Compose healthcheck → /ready (DB-aware), /health stays for
      // cheap liveness probing — same split as dotnet/hono.
      internalPort: 8000,
    };
  },
};

export default pythonPlatform;
