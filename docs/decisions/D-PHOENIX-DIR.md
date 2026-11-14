# D-PHOENIX-DIR — generator directory + platform module + CI workflow renames

**Status:** PINNED. (Mechanical completion of the D-ELIXIR-PLATFORM rename;
spec in `proposals/elixir-platform-rename.md`.)

**Problem.** When D-PHOENIX-SURFACE renamed `platform: phoenixLiveView` →
`platform: phoenix`, the legacy directory `src/generator/phoenix-live-view/`,
the platform module `src/platform/phoenix-live-view.ts`, and the CI workflows
`phoenix-*.yml` were not renamed alongside. After D-ELIXIR-PLATFORM the
debt compounds: the LiveView part of the name is no longer accurate (the
emitter outputs the whole Phoenix project — API controllers, OpenAPI,
shell scaffolding — most of which has nothing to do with LiveView), and
the `phoenix` part needs to align with the new `elixir` platform name.

**Decision.** Three coordinated renames, no back-compat alias at the
directory / module / workflow level (callers reach these through the
registered platform surface and the CI matrix, not directly):

| Today | After |
|---|---|
| `src/generator/phoenix-live-view/` | `src/generator/elixir/` |
| `src/platform/phoenix-live-view.ts` | `src/platform/elixir.ts` |
| `generatePhoenixLiveViewProject` | `generateElixirProject` |
| `GeneratePhoenixLiveViewArgs` | `GenerateElixirArgs` |
| `phoenixPlatform` (registry alias) | `elixirPlatform` |
| `.github/workflows/phoenix-build.yml` | `.github/workflows/elixir-ash-build.yml` |
| `.github/workflows/phoenix-dialyzer.yml` | `.github/workflows/elixir-ash-dialyzer.yml` |
| `.github/workflows/phoenix-obs-e2e.yml` | `.github/workflows/elixir-ash-obs-e2e.yml` |

The CI rename uses the `elixir-ash-` prefix (foundation in the name) so a
future `elixir-vanilla-build.yml` pairs cleanly when P2 of
`vanilla-phoenix-foundation.md` ships.

**Affects.** ~80 import paths across `src/` and `test/` (mechanical `sed`,
TypeScript imports resolve through the rename); workflow display names
updated alongside (`Phoenix LiveView build verification` → `Elixir / Ash
build verification`, etc.). The `ashPhoenix` design pack name is **not**
renamed in this pass — its foundation-aware rework belongs to P2 of
`vanilla-phoenix-foundation.md`. **Depends on D-ELIXIR-PLATFORM**.
