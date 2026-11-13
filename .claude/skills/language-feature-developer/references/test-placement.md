# Test placement — which test proves a feature, and where it lives

The canonical guide is `docs/testing.md`; run commands and env gates are in
`CLAUDE.md` → "Build & test commands". This is the operational summary for a
feature author.

## The placement rule

Put each assertion at the **altitude where the claim is actually observable.**
Parse, validate, lower and IR claims are structural, so they go in the fast
suite. A claim about what generated code **does** (a status, a value, a
persisted row, rendered text) goes in a corpus fixture's `test e2e` block with
a wire golden. One fixture runs on every backend, and per-target `toContain`
copies of the same claim are the main source of suite bloat (#3863).
String-matching emitted source is for what no compile or booted tier can
observe: absence, import hygiene, spelling with no wire effect, and wiring
nothing boots. Say in the test which of these it is.
`test/system/string-tier-ratchet.test.ts` caps that tier, and raising a
ceiling needs a PR-body reason for why the claim can't be a fixture.

Two axes decide the tier: **structural vs behavioral**, and **docker-free
(in-process: PGlite, `app.fetch`, headless Chromium) vs docker (cross-backend
over real Postgres, nightly)**.

## Where each kind of test lives (`test/` mirrors the pipeline phases)

| Dir | Kind | Example |
|---|---|---|
| `test/language/parsing/` | parse-only AST assertions | `aggregate-inheritance.test.ts` |
| `test/language/validation/` | validator diagnostics (positive + negative) | `angular-deployable.test.ts` |
| `test/language/print/` | printer + round-trip | `print-completeness.test.ts` |
| `test/language/type-system/` | type inference / member typing | `event-payload-param-typing.test.ts` |
| `test/language/lsp/` | completion / code-actions | `capability-completion.test.ts` |
| `test/macro/` | macro expansion AST→AST | `capability-printer-roundtrip.test.ts` |
| `test/ir/` | lower → enrich → IR-validate (the bulk) | `access.test.ts` |
| `test/ir/wire/` | `wireShape` / DTO contract (snapshot) | `create-input-contract.test.ts` |
| `test/generator/hono/`, `typescript/` | node/TS emit (string-match) | `error-status-tiers.test.ts` |
| `test/generator/dotnet/` | .NET emit | `aggregate-test-currentuser.test.ts` |
| `test/generator/elixir/`, `elixir-vanilla/` | Phoenix vanilla Ecto + HEEx | `vanilla-audit.test.ts` |
| `test/generator/python/` | FastAPI/SQLAlchemy emit | `python-aggregate.test.ts` |
| `test/generator/java/` | Spring Boot/JPA emit | `generator-java-api.test.ts` |
| `test/generator/react/`, `vue/`, `svelte/`, `angular/`, `feliz/` | frontend emit | `auth-ui-emit.test.ts` |
| `test/generator/_walker/`, `_packs/` | shared `walkBody` / design-pack dispatch | `builder-page-live-sync.test.ts` |
| `test/platform/` | registry, `PlatformSurface`, **layering invariants** | `pipeline-layering.test.ts` |
| `test/system/` | multi-deployable compose, `.loom/` artifacts, migrations | `acme-explicit-architecture.test.ts` |
| `test/cli/` | CLI commands | `cli.test.ts` |
| `test/conformance/` | cross-backend OpenAPI/wire parity + coverage gates | `corpus-coverage.test.ts` |
| `test/behavioral/` | docker-free behavioral runners (`run.mjs` api/unit, `run-ui.mjs` React) + `corpus.json` | (no `.test.ts`) |
| `test/e2e/` | opt-in slow: generated-project compile/build/runtime + docker conformance | `generated-react-build.test.ts` |
| `test/fixtures/` | **excluded from vitest** — byte-for-byte baseline snapshots + shared corpus | — |

## Completeness / parity / layering gates (mechanical — they force mirror updates)

These fail CI until you update the matching mirror. Know them before you start —
they tell you the *second* place every grammar/primitive change has to land.

| Gate | Path | Forces |
|---|---|---|
| **print-completeness** | `test/language/print/print-completeness.test.ts` | every grammar node under a printable union has a printer arm in `src/language/print/*` |
| **walker-stdlib-completeness** | `test/language/type-system/walker-stdlib-completeness.test.ts` | `src/language/walker-stdlib.ts` matches `src/generator/_walker/registry.ts` key-for-key |
| **heex-coverage** | `test/generator/elixir/heex-coverage.test.ts` | the HEEx showcase reaches every walker primitive the capability table admits on LiveView, and every `WalkResult` accumulator |
| **pipeline-layering** | `test/platform/pipeline-layering.test.ts` | no runtime back-edge across `language → ir → generator → system` |
| **backend-packages-layering** | `test/platform/backend-packages-layering.test.ts` | shared `src/generator/` doesn't import a versioned backend package |
| **diagnostic-codes-completeness** | `test/ir/diagnostic-codes-completeness.test.ts` | every IR diagnostic carries a stable `loom.*` code |
| **queryable-subset-parity** | `test/ir/queryable-subset-parity.test.ts` | the `find`/`view` WHERE-clause queryable set agrees between the validator gate and the Hono lowerer |
| **corpus-coverage** | `test/conformance/corpus-coverage.test.ts` | every `.ddd` in the corpus has a manifest row and every declared (feature, backend) cell generates cleanly |
| **print round-trips** | `test/language/print/print-structural-roundtrip.test.ts` | `.ddd` → print → reparse is stable |
| **build-matrix-sync** | `test/e2e/{react,svelte}-build-matrix-sync.test.ts` | the CI build matrix lists every `{example × pack}` cell |

## Opt-in slow suites (each gated on a `LOOM_*` env var; excluded from `npm test`)

Reach for the one that matches the compiler your emitted code must satisfy.

| Script | Env gate | Checks |
|---|---|---|
| `test:tsc` | `LOOM_TS_BUILD=1` | emit TS projects → `tsc --noEmit` |
| `test:tsc-react` | `LOOM_REACT_BUILD=1` | React (examples × packs) → `tsc` |
| `test:svelte-build` / `test:vue-build` | `LOOM_SVELTE_BUILD=1` / `LOOM_VUE_BUILD=1` | `svelte-check` / `vue-tsc` + `vite build` |
| `test:vue-e2e` / `test:svelte-e2e` | `LOOM_VUE_E2E=1` / `LOOM_SVELTE_E2E=1` | runtime: `vite preview` + emitted Playwright smoke |
| `test:dotnet` | `LOOM_DOTNET_BUILD=1` | `dotnet build /warnaserror` + build and run the emitted xUnit project |
| `test:java` | `LOOM_JAVA_BUILD=1` | `gradle testClasses bootJar` |
| `test:python` | `LOOM_PYTHON_BUILD=1` | `uv sync` + ruff + `mypy --strict` + pytest |
| `test:phoenix` | `LOOM_PHOENIX_VANILLA_BUILD=1` | vanilla Ecto/Phoenix `mix compile --warnings-as-errors` (`LOOM_HEX_MIRROR=1` behind the TLS proxy) |
| `test:e2e` | `LOOM_E2E=1` | full docker-compose stack + `/health` + DSL e2e + Playwright + OpenAPI parity |
| `test/behavioral/run.mjs` | (own deps) | generated Hono on PGlite: api e2e + unit |

## Feature-change → required tests (walk in order; stop at the first match)

1. **New/changed grammar, validator, macro, lowering, or IR shape** → fast
   vitest: a parsing test + a negative validator test where relevant
   (`test/{language,macro,ir}/`). After a grammar edit, `langium:generate` and
   satisfy **print-completeness**. A new IR diagnostic → **diagnostic-codes-completeness**.
   A queryability change → **queryable-subset-parity**.
2. **A backend/frontend now emits something new** → if the claim is about
   behaviour, go to step 4 (one corpus fixture, all backends). Use a generator
   test per affected target (`test/generator/<platform>/`), string-matching the
   source, only for the unobservable claims named in the placement rule. A new UI primitive → register in both walker
   mirrors (**walker-stdlib-completeness**) and reach it from the HEEx showcase
   (**heex-coverage**). If the shape is a baseline fixture, regenerate it via
   `scripts/capture-baseline-fixture.mjs`.
3. **The emitted code might not compile** (new import/type/dep) → the matching
   per-backend / generated-frontend build gate (`LOOM_*`). Run at least one
   locally before pushing.
4. **The emitted code must behave** → a behavioral tier: add a
   `test e2e "…" against <node>` or aggregate `test "…"` to a `.ddd` and ensure
   the example is in `test/behavioral/corpus.json` (the docker-free behavioral
   corpus requires exactly one `platform: node` deployable). A React round-trip
   needs `"ui": true`. For cross-backend behaviour, add the block to a corpus
   fixture with a node-minted wire golden (`test/behavioral/wire-golden/README.md`).
   Every backend's per-PR `behavioral-e2e*` leg replays it.
5. **Cross-backend contract (OpenAPI / wire shape)** → conformance parity
   (mostly automatic from `wireShape`; a new dimension goes in the parity harness).

The recipe minimum for a real semantic feature: **1 parsing test + 1 negative
validator test + 1 IR test + 1 corpus fixture (`<id>.corpus.json` manifest row, `test e2e` block,
wire golden)**, then at least one `LOOM_TS_BUILD=1` / `LOOM_REACT_BUILD=1`
compile pass. Add per-target generator string tests only for the claims the
fixture cannot observe.
