import type { PlatformAdapterDefaults, PlatformAdapters } from "../generator/_adapters/index.js";
import { byFeatureLayoutAdapter } from "../generator/elixir/adapters/by-feature-layout.js";
import { ectoPersistenceAdapter } from "../generator/elixir/adapters/ecto-persistence.js";
import { layeredStyleAdapter } from "../generator/elixir/adapters/layered-style.js";
import { generateElixirProject } from "../generator/elixir/index.js";
import { databaseOf } from "../ir/util/databases.js";
import { deterministicHex } from "../util/deterministic-secret.js";
import { serviceSlug } from "../util/service-slug.js";
import { TARGET_CAPABILITIES } from "../util/target-capabilities.js";
import {
  BACKEND_HEALTH,
  BROKER_BASELINE,
  BROKER_BASELINE_GAPS,
  MIGRATIONS_BASELINE,
  RESOURCES_BASELINE,
  SECURITY_BASELINE,
  wgetHealthcheck,
} from "./operations.js";
import { backendEnvContract } from "./operations-env.js";
import type { ComposeServiceShape, PlatformSurface } from "./surface.js";
import { TARGET_FACTS } from "./target-facts.js";

// ---------------------------------------------------------------------------
// Elixir platform — fullstack Phoenix deployable
// (D-ELIXIR-PLATFORM: platform names the language-ecosystem).
//
// Unlike `dotnet`/`hono` (backend-only) and `react`/`static` (frontend-only),
// an `elixir` deployable ships ONE project that both serves a JSON
// API (when `serves:` is populated) AND mounts a `ui:` rendered as
// Phoenix LiveView modules against the `coreComponents` HEEx design
// pack, all on plain Ecto/Phoenix (the `vanilla` foundation).  It owns
// its own Postgres database (`needsDb: true`), matches the backend
// platforms for `serves:` validity, and matches the frontend platforms
// for `ui:` mount validity (`mountsUi: true`).
//
// All project emission (mix.exs, configs, Dockerfile, lib/<app>/*,
// migrations, LiveView modules, controllers) lives under
// `../generator/elixir/`; this module is a thin `PlatformSurface`
// wiring that delegates to the orchestrator.
// ---------------------------------------------------------------------------

const elixirPlatform: PlatformSurface = {
  name: "elixir",
  defaultPort: 4000,
  needsDb: true,
  mountsUi: true,
  isFrontend: false,
  // The keystone (D-PHOENIX-SURFACE): Phoenix is the only platform that
  // is BOTH a server-render runtime (LiveView, spelled `phoenixLiveView`)
  // AND a static-asset host (`priv/static`) — it hosts its
  // runtime-coupled LiveView plus every static bundle (react / vue /
  // svelte / angular), all served from `/app`.  The SvelteKit bundle builds
  // with `paths.base = "/app"` and the Angular bundle with `baseHref = "/app/"`
  // (angular.json + the `<base>` tag) so their asset URLs + base-aware links
  // resolve under the prefix — the same `basePath` thread react/vue use for
  // their vite `base`.
  hostableFrameworks: new Set([
    "phoenixLiveView",
    "react",
    "static",
    "vue",
    "svelte",
    "angular",
    "feliz",
  ]),
  capabilities: TARGET_CAPABILITIES.elixir,
  facts: TARGET_FACTS.elixir,
  emitProject({
    contexts,
    deployable,
    sys,
    migrations,
    emitTrace,
    styleAdapter,
    sourcemap,
    translations,
    frontendContract,
  }): Map<string, string> {
    // Forward the deployable's resolved style adapter (D-REALIZATION-AXES
    // `application:`) into the generator's EmitCtx; the layout axis has no
    // Phoenix consumer, so it's dropped.
    return generateElixirProject({
      contexts,
      deployable,
      sys,
      migrations,
      emitTrace,
      styleAdapter,
      sourcemap,
      translations,
      frontendContract,
    });
  },
  operations: {
    health: { ...BACKEND_HEALTH, compose: "/health" },
    healthcheck: wgetHealthcheck,
    healthcheckBinaries: ["wget"],
    env: (args) =>
      backendEnvContract(
        args,
        elixirPlatform.composeService({ ...args, slug: serviceSlug(args.deployable.name) }),
        // Ecto's pool size; MIX_ENV / MIX_TEST_PARTITION are Mix's own (the
        // release runs `prod`; the partition only shards `mix test`).
        ["POOL_SIZE", "MIX_ENV", "MIX_TEST_PARTITION"],
      ),
    listen: "dual-stack",
    log: { format: "loom-json", levelEnv: "LOG_LEVEL" },
    // The Phoenix relay halts its pass and backs off on an unreachable broker.
    broker: BROKER_BASELINE,
    migrations: MIGRATIONS_BASELINE,
    security: SECURITY_BASELINE,
    resources: RESOURCES_BASELINE,
    gaps: BROKER_BASELINE_GAPS,
  },
  composeService({ slug, sys, deployable }): ComposeServiceShape {
    const database = databaseOf(sys, deployable)?.name ?? slug;
    return {
      env: [
        ["DATABASE_URL", `ecto://postgres:postgres@db:5432/${database}`],
        // Phoenix signs/encrypts sessions with secret_key_base and requires
        // ≥64 bytes.  DERIVED per (system, deployable) — 64 bytes → 128 hex
        // chars — so no two deployables and no two systems share a
        // session-signing key, without `generate system` losing determinism:
        // the previous `crypto.getRandomValues()` re-minted this line on every
        // run, so a regen always rewrote `docker-compose.yml`, showed up as a
        // spurious VCS diff, and rotated the key of a RUNNING dev stack
        // (logging every user out).  Dev default only — `config/runtime.exs`
        // raises in prod unless the environment supplies `SECRET_KEY_BASE`,
        // and k8s routes it to a Secret (see `secretEnvKeys`).  To rotate,
        // override the env var (`mix phx.gen.secret` still mints one).
        ["SECRET_KEY_BASE", deterministicHex(64, "SECRET_KEY_BASE", sys.name, slug)],
        ["PHX_HOST", "localhost"],
        ["PHX_SERVER", "true"],
        ["PORT", "4000"],
        // Runtime log-level knob (default info; overridable here / in k8s).
        ["LOG_LEVEL", "info"],
      ],
      // SECRET_KEY_BASE signs/encrypts sessions — sensitive, so the k8s
      // emitter routes it to a Secret rather than a plaintext ConfigMap.
      secretEnvKeys: ["SECRET_KEY_BASE"],
      dependsOnDb: true,
      internalPort: 4000,
    };
  },
  // elixir — plain Ecto/Phoenix.  Persistence is `ecto` (the DB-agnostic data
  // layer); the application style is `layered` (plain Phoenix's controller →
  // context → repository pipeline).
  adapters(): PlatformAdapters {
    const menu: PlatformAdapters = {
      persistence: { ecto: ectoPersistenceAdapter },
      styles: { layered: layeredStyleAdapter },
      layouts: { byFeature: byFeatureLayoutAdapter },
    };
    return menu;
  },
  adapterDefaults(): PlatformAdapterDefaults {
    return {
      // Both state + eventLog persist through the `ecto` data layer (plain
      // Phoenix on Ecto).
      persistence: { state: "ecto", eventLog: "ecto" },
      style: "layered",
      layout: "byFeature",
    };
  },
};

export default elixirPlatform;
