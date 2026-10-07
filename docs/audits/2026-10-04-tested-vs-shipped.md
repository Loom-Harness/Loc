# Tested vs shipped — does each gate run the artifact a user runs?

*Snapshot: 2026-10-04, `main` @ `bce7f409`. Scope: every gate or harness that compiles,
builds or boots GENERATED output. Companion to
[`2026-09-29-fixture-shape-coverage.md`](2026-09-29-fixture-shape-coverage.md), which asked
whether a gate's fixture has the right **shape**. This audit asks whether it runs the right
**artifact**.*

## The thesis

Of the 155 bugfix PRs merged in September 2026, CI found **13**. The recurring reason a
defect walks past ~67 green workflows is that **the tested artifact is not the shipped
artifact**. The gate runs a mechanism that differs from what `docker compose up`,
`npm run build` or `mix compile` actually does. So the gate is green while the shipped
app is broken:

| shape | evidence |
|---|---|
| harness DB built from the ORM schema, not the emitted migrations | #2919, #2988 (node oracle read an enum in declaration order on a schema no deployed app has), #2773 (harness DDL had no FKs at all) |
| migrations compiled, never applied | #3060 (elixir index on a column its own collapse removes — "green and broken") |
| boot leg without the compile flags the build gate uses | #2994 ("a green booted app is not a green compile") |
| build that strips types without checking them | #2749 (frontend `build` = `vite build`), #2770 (vitest/esbuild), F-007 / #3085 (node Dockerfile = tsup) |
| narrower compile scope than what is under test | #2905 (Angular `tsconfig.app.json` include) |
| gate that ran or asserted nothing | #2986, #3075, #2989, #2843 |

## The table

**Same path?** compares the gate with what a user runs:
- ✅ means the gate does what ships, or is stricter.
- ⚠️ means it diverges, but the divergence has not been shown to hide a defect.
- ❌ means a divergence that hides, or hid, a defect.

| gate (workflow → runner) | DB source | build path | warnings fatal | tsconfig | same path? |
|---|---|---|---|---|---|
| `behavioral-e2e` → `test/behavioral/run.mjs` (node **oracle**) | was `synthDDL(schema)`. **Now the emitted `db/migrations`** (this PR) | esbuild bundle of a synthetic entry that calls `createApp`. It never runs `index.ts`, tsup or the Dockerfile | n/a | n/a | ❌ → ✅ for the DB. ⚠️ build: no typecheck here, but `hono-build` type-checks the same tree |
| `behavioral-ui-e2e` / `frontend-fullstack-e2e` → `run-ui.mjs` + `ui-stack.mjs` | was `synthDDL`. **Now the emitted migrations** | frontend: the real `npm run build`. Backend: esbuild | – | pack tsconfig | ❌ → ✅ |
| `schemathesis` → `run-schemathesis.mjs` (node), `pagination.mjs` | was `synthDDL`. **Now the emitted migrations** | esbuild | – | – | ❌ → ✅ |
| `behavioral-e2e-dotnet` → `run-dotnet.mjs` | `Database.Migrate()`, the shipped path | Debug `dotnet run`. Ships as `publish -c Release` | **no** (the build gate uses `/warnaserror`) | – | ⚠️ |
| `behavioral-e2e-dapper` → `run-dapper.mjs` | emitted `DbSchema.EnsureAsync`, the shipped path | Debug `dotnet run` | no | – | ⚠️ |
| `behavioral-e2e-java` → `run-java.mjs` | Flyway at startup (`ddl-auto: none`), the shipped path | `gradle bootJar`, the same task as the Dockerfile | **yes**: `-I test/e2e/support/java-werror.init.gradle` (`-Xlint:all -Werror`), as the compile legs | – | ✅ |
| `behavioral-e2e-python` → `run-python.mjs` | emitted `app/db/migrate.py` in lifespan, the shipped path | `uv sync` + uvicorn, as the image does | (ruff/mypy in the build gate) | – | ✅ |
| `behavioral-e2e-elixir` → `run-elixir.mjs` | `mix ecto.migrate`. Ships as release `Release.migrate()`; same migration files | `MIX_ENV=dev` compile, no release | **no** (#2994) | – | ⚠️ W-as-E |
| `behavioral-e2e-mikroorm` → `run-mikroorm.mjs` | `orm.schema.updateSchema()` at boot, the shipped path | `npm run dev` (**tsx**). It never runs tsup or the Dockerfile | – | – | ❌ **the shipped image does not build** (D-1 below) |
| `hono-build` → `generated-build.test.ts` | none | `tsc --noEmit` + `npm run build` (tsup) | strict tsc | project | ✅ stricter than the image, which runs tsup only. Fixed by #3085 for v4 **and** v5 (same emitter) |
| `corpus-build` (tsc) → `corpus-tsc-build.test.ts` | none | `tsc --noEmit` only | strict | project | ⚠️ no bundle |
| `dotnet-build` / corpus dotnet + dapper | none | Debug `dotnet build /warnaserror` | **yes**, as a CLI flag only. The csproj never sets it, and the image's `publish -c Release` has no flag | – | ⚠️ Release config never built |
| `java-build` / corpus java | none | `gradle testClasses bootJar` | **yes** since f4fbce47: `-Xlint:all -Werror` via `test/e2e/support/java-werror.init.gradle` | – | ✅ |
| `python-build` / corpus python | none | `uv sync`, ruff, `mypy --strict`, pytest | lint as errors | – | ✅ stricter |
| `elixir-vanilla-build` | none | `mix deps.get --only prod && mix compile --warnings-as-errors` | yes. `_build` is cache-restored, but Elixir 1.18 replays stored warnings and re-checks a changed module's dependents, so the cache hides none (measured in the gate's image) | – | ✅ |
| `corpus-elixir-build` → `corpus-elixir-build.test.ts` | **was none: migrations compiled, never applied** (#3060). Now applied (#3147) | `mix compile --warnings-as-errors` | yes | – | ❌ → ✅ |
| `generated-react-build` | none | `tsc --noEmit` + `vite build`, the pack `build` script's two halves (#2749) | – | `tsconfig.json`. `tsconfig.node.json` (vite.config) unchecked | ✅ |
| `generated-vue-build` | none | `vue-tsc --noEmit` + `vite build`, as the script does | – | tsconfig.json | ✅ |
| `generated-svelte-build` | none | `svelte-check --fail-on-warnings` + `vite build` | stricter | tsconfig.json | ✅ |
| `generated-angular-build` | none | `ng build`, `defaultConfiguration: production` | strictTemplates | `tsconfig.app.json`, the production one (#2905 widened the gate's include) | ✅ |
| `generated-feliz-build` | none | `dotnet fable` + `vite build` | – | – | ✅ |
| `generated-flutter-build` | none | `flutter analyze --no-fatal-infos`, test, `build web --release` | **yes** (warnings fatal; infos, the style lints, stay advisory) | – | ✅ |
| `schema-load` → `schema-load.test.ts` | the emitted `.sql` through `psql ON_ERROR_STOP` | – | – | – | ✅ but sql-pg only (node/python/java); not EF, not Ecto |
| `conformance-parity` / `conformance-full` → `e2e.test.ts` | the shipped migrations | **the shipped Dockerfiles** via `docker compose build` | as shipped | as shipped | ✅ the only true shipped path. Per-PR: one example, backend APIs only, no SPA images |
| `migration-evolution-e2e`, `auth-oidc-compose-e2e`, `tenancy-e2e` | shipped | shipped | – | – | ✅ (label / queue) |

## Defects the stricter paths surfaced

- **D-1 — a `persistence: mikroorm` node app cannot build its image.**
  - The cause is the Dockerfile emitter (`src/platform/hono/v4/emit.ts`, `DOCKERFILE_TS`). It is emitted unconditionally and ends with `COPY --from=build /app/db/migrations ./db/migrations`.
  - MikroORM applies its schema with `updateSchema()` and emits no `db/migrations`, so `docker build` fails with `"/app/db/migrations": not found`. Reproduced on `core-domain` with `persistence: mikroorm`.
  - It stayed green because the only gate that boots MikroORM runs `npm run dev` (tsx), and no gate builds its image.
  - Fixed in #3146.
- **The node behavioural leg on the emitted migrations: 141 passed, 0 failed, 0 wire divergences across 68 cases.** That is identical to the `synthDDL` baseline. No live node defect hid behind the synthesised schema on today's corpus.
  - The switch is mutation-proved. With a migration CHECK missing an enum member, the old harness passes `state-gate` and the new one fails it.
  - It now gates every future migration-only defect (FKs, uniques, CHECKs, composite PKs, the enum representation).

## Families and where each closes

| family | status |
|---|---|
| A — harness DB from the emitted migrations | **#3136**: `run.mjs`, `ui-stack.mjs`, `run-schemathesis.mjs`, `pagination.mjs` via `test/behavioral/emitted-schema.mjs`; ratchet `test/system/harness-schema-source.test.ts`. `synthDDL` stays the playground's (browser) DDL, the only path that ships it |
| B — elixir migrations applied in the compile tier | **#3147**: `corpus-elixir-build` runs `mix ecto.create && mix ecto.migrate` (`MIX_ENV=prod`) on a Postgres sidecar after the compile; mutation-proved on #3060's index defect (`column "berth_ship" does not exist`). Sweep: all 93 vanilla projects apply on `main` |
| C — warnings fatal on the boot legs | **#3150**: `run-dotnet`/`run-dapper` build with `/warnaserror` and `run-elixir` with `--warnings-as-errors`, each as the case's FIRST compile (an incremental rebuild re-emits no warning, measured). The five shared `systems/*.ddd` were the models only these legs compiled; all 15 cells are clean. Java (`run-java.mjs`, pairwise-java) and `flutter analyze` followed in #3191, so every compile/analyze leg now fails on a warning |
| D — the shipped build path type-checks and builds | node Dockerfile typecheck = #3085 (v4 and v5 share the emitter). Frontend `build` scripts already type-check on every pack. **D-1, the MikroORM image build: #3146** (fix + `dockerfile-copy-sources.test.ts`; image built and booted) |
| ratchet — every `LOOM_*` gate is reachable | already pinned by `test/system/skip-gate-reachability.test.ts` (from #3075). The residual "selected nothing" shape (an unknown `LOOM_CORPUS_ELIXIR_CASE` under `--passWithNoTests` reported green) fails loudly since #3147 |
