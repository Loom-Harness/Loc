# D-NODE-PLATFORM — `node` is the JS-runtime platform; `hono` is a `transport:` value

**Status:** PINNED — **amended by D-ELIXIR-PLATFORM** (this decision's body
asserts *"`dotnet`/`phoenix` name the language-ecosystem"* — a rationalisation,
since `phoenix` is a web framework, not a language-ecosystem; the actual
ecosystem is **Elixir**. D-ELIXIR-PLATFORM completes the rename pattern by
making `elixir` the canonical language-ecosystem platform and `phoenix` a
back-compat alias. The framing in the original problem statement should now
be read as *"`dotnet`/`elixir` name the language-ecosystem"*.) (Mirrors
**D-PHOENIX-SURFACE**'s rename pattern; depends on **D-REALIZATION-AXES** for
the `transport:` axis. Rollout in `proposals/realization-axes-rollout.md`
Phase 3.)

**Amendment (alias retired).** The `hono` → `node` back-compat alias described
below has since been **removed** — `node` is now the only spelling. The
`hono` keyword is gone from the grammar `Platform` rule, `LEGACY_PLATFORM_ALIASES`
(`src/platform/metadata.ts`) and `canonicalPlatform` (`src/ir/lower/lower-platform.ts`)
no longer map it, and `platform: hono` / `platform: "hono@v4"` now fail validation
as unknown platforms. All in-tree sources, fixtures and docs were migrated to
`platform: node`. The Hono web framework keeps its name only as the `transport:`
value on `platform: node` (and as the `src/platform/hono/` / `@loom/backend-hono-v4`
package directory). The historical body below is preserved as the original
rationale for the rename. (2026-10: `node@v4` itself was later retired, see
#3687 — `@loom/backend-hono-v5` is now the only Hono package.)

**Problem.** `platform: hono` conflates the **JS runtime** (Node) with the **web
framework** (Hono) in one token — the same conflation just resolved for
`phoenixLiveView`. `dotnet` / `phoenix` name the language-ecosystem; `hono` names
only *one of several* interchangeable TS web frameworks (Hono / Express /
Fastify / Elysia). The codebase already splits these: language codegen lives in
`src/generator/typescript/`, while `src/platform/hono/` is the Hono web-framework
backend.

**Decision.**

- **`node` is the canonical JS-runtime platform** (language TypeScript, *derived*
  — not a name prefix; cf. `dotnet` is not `csharp-dotnet`). Legacy
  `platform: hono` is admitted as a **back-compat alias** that desugars to
  `platform: node { transport: hono }` (same mechanism as `phoenixLiveView` →
  `phoenix`).
- **The web framework is the `transport:` axis** (D-REALIZATION-AXES). `node`'s
  menu: `hono`\* · `express` · `fastify` · `elysia`; default `hono`. (`dotnet`
  transport stays `minimalApi`\*·`controllers`; `phoenix` `phoenixRouter`\*.)
- **NestJS is a `foundation:` value** (rung-3): it owns application + transport
  and runs on an underlying http adapter, so `foundation: nestjs` locks
  `transport:` via R4 — identical shape to `foundation: abp` on dotnet.
- **`language` is a derived surface property** (`typescript` for `node`/`react`,
  `csharp` for `dotnet`, `elixir` for `phoenix`), consumed by the Phase-F
  shared-contracts grouping — *not* a platform-name prefix.
- **Future JS runtimes** (`bun` / `deno` / `edge`) are **sibling `platform:`
  values** (distinct stdlib/deploy), all TypeScript — not a `typescript-X`
  prefix and not a new sub-axis.

**Affects.** `src/platform/registry.ts` (add `node`, alias `hono`→`node`); the
`Platform` IR union + grammar `Platform` rule (add `node`, keep `hono` as
back-compat keyword); the `transport:` menu (`hono` becomes its default value);
`src/platform/hono/` (reframed as node's Hono transport); the derived `language`
property on `PlatformSurface`. **Depends on D-REALIZATION-AXES**; mirrors
**D-PHOENIX-SURFACE**.
