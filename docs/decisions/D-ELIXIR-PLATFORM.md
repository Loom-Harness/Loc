# D-ELIXIR-PLATFORM — `elixir` is the canonical language-ecosystem platform; `phoenix` is a back-compat alias

**Status:** PINNED. (Mirrors **D-NODE-PLATFORM**'s rename pattern; amends
**D-PHOENIX-SURFACE**'s platform-name choice; depends on **D-REALIZATION-AXES**
for the `transport:` axis. Spec in `proposals/elixir-platform-rename.md`.)

**Amendment (alias retired).** The `phoenix` / `phoenixLiveView` → `elixir`
back-compat platform aliases described below have since been **removed** —
`elixir` is now the only spelling, exactly mirroring the retired `hono` →
`node` alias (D-NODE-PLATFORM). The `phoenix` and `phoenixLiveView` keywords
are gone from the grammar `Platform` rule, `LEGACY_PLATFORM_ALIASES`
(`src/platform/metadata.ts`) and `canonicalPlatform`
(`src/ir/lower/lower-platform.ts`) no longer map them, and `platform: phoenix`
/ `platform: "phoenixLiveView"` now fail validation as unknown platforms. All
in-tree sources, fixtures and tests were migrated to `platform: elixir`. The
Phoenix web framework keeps its name only as the `transport: phoenix` value
(D-PHOENIX-TRANSPORT) and the `phoenixLiveView` **framework** value (with its
`liveview` alias, D-PHOENIX-SURFACE — *not* retired); the `ashPhoenix` design
pack and the generated-project code likewise keep the framework name. The
historical body below is preserved as the original rationale for the rename.

**Problem.** D-NODE-PLATFORM (the later decision) renamed `platform: hono` →
`platform: node` on the principle that *platform names the language-ecosystem,
transport names the web framework*. Its own text justifies itself by asserting
*"`dotnet`/`phoenix` name the language-ecosystem"* (decisions.md:1072) — a
rationalisation, since `phoenix` is a web framework, not a language-ecosystem.
The actual ecosystem is **Elixir**.

The result was visible repetition: `platform: phoenix, transport: phoenixRouter`
reads as "Phoenix Phoenix" — two restatements of the same framework. And the
generator scaffolding around the platform name (`src/generator/phoenix-live-view/`
the directory, `src/platform/phoenix-live-view.ts` the module, `phoenix-build.yml`
the CI workflow) carried the legacy `phoenixLiveView`-era spelling that
D-PHOENIX-SURFACE retired at the *platform name* level but never followed
through at the *scaffolding* level.

**Decision.**

- **`elixir` is the canonical language-ecosystem platform**. The platform
  surface that emits the fullstack Elixir/Ash + Phoenix LiveView project
  registers under `elixir` in `src/platform/registry.ts`.
- **`phoenix` and `phoenixLiveView` are back-compat aliases** that desugar to
  `elixir` at the lowering boundary (`canonicalPlatform` /
  `LEGACY_PLATFORM_ALIASES`), preserving any `@version` pin
  (`phoenix@v1` → `elixir@v1`; `phoenixLiveView@v1` → `elixir@v1`). Every
  existing `.ddd` source continues to parse, validate, lower, and emit
  byte-identical output. Identical mechanism to `hono` → `node`
  (D-NODE-PLATFORM).
- **`language` is a derived surface property** (`elixir` for `elixir`,
  `typescript` for `node`/`react`, `csharp` for `dotnet`), consumed by the
  Phase-F shared-contracts grouping — *not* a platform-name prefix. Matches
  D-NODE-PLATFORM's framing now that `phoenix` is no longer the platform.

**Affects.** `src/platform/registry.ts` (register under `elixir`; add `phoenix`
and `phoenixLiveView` to `LEGACY_PLATFORM_ALIASES`); the `Platform` IR union
(`"phoenix"` → `"elixir"`); grammar `Platform` rule (add `elixir` keyword);
`src/ir/lower/lower-platform.ts` (`canonicalPlatform` adds the `phoenix`
arm); every `family === "phoenix"` check across the toolchain (renamed to
`"elixir"`); CLI `--platform` (canonical `elixir`, `phoenix` accepted as
alias); the seven affected decisions get an amend-by-this-one note.
**Mirrors D-NODE-PLATFORM**; **amends D-PHOENIX-SURFACE**.
