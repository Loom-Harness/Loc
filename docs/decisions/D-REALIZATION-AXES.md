# D-REALIZATION-AXES — the deployable platform-config axes (and the `foundation:` amendment)

> **Superseded (2026): the Ash foundation was removed.** `platform: elixir` is plain Ecto/Phoenix only; `foundation: ash` is now a validation error and `vanilla` is the default and only valid value. The Ash-vs-vanilla reasoning below is historical.
>
> **Superseded (2026): the realization block was pruned to two axes.** The bundle-decomposition instinct below stands, but four of the six axes were inert or theater and were removed, leaving only the two with real per-backend choice — **`persistence`** and **`directoryLayout`**. Removed: `foundation:` (single value `vanilla` everywhere — grammar clause, `DeployableIR.foundation`, the R4/R6 rules, the `foundation-default-flipping` warning all deleted); `application:`/style (each backend has one fixed emission style — `cqrs` on dotnet, `layered` elsewhere — kept as an internal `StyleAdapter`, no longer a user knob); and `transport:`/`runtime:` (name-only `TransportAdapter`/`RuntimeAdapter` registries that no emitter ever read — pure validation theater, deleted whole). Every reserved *stub* adapter (`marten`/`jooq`/`axon`/`minimalApi`/`orleans`/`genserver`/`worker`/the `cqrs`/`flat`/`layered` style stubs) was removed too — a stub that throws on `emit*` is speculative-generality debt, not a shipped capability. All `foundation:`/`application:`/`transport:`/`runtime:` reasoning below (the amendment, ownership rules, rung table, gating matrix, the R2–R7 rules) is historical.

**Status:** PINNED. (Amends **D-PHOENIX-SURFACE**'s domain-axis mechanism;
depends on **D-ADAPTER-HOME** and **D-STORAGE-SPLIT**. Full matrix, gating rules,
and examples in `proposals/platform-realization-axes.md`.)

**Problem.** `platform: dotnet` bundles EF Core + MediatR-CQRS + minimal API with
no exposed knobs (`storage-and-platform-config.md:58`). The decomposition into
`platform: <name> { … }` config needs (a) a fixed, reviewed *vocabulary* of
axes, and (b) a resolution of D-PHOENIX-SURFACE open-item 1 (where the Ash/Ecto
domain-framework axis lives). The storage doc's `style:`/`layout:` names are
weak/colliding, and folding the domain framework into `persistence:` destroys the
ability to pick the data layer *underneath* a framework.

**Decision.** A backend deployable's realization is **six orthogonal, optional,
validator-gated axes**, each named for the layer it realizes. Each is a
menu+default exposed off the backend's `PlatformSurface` (D-ADAPTER-HOME); a bare
`platform: <name>` equals the full default block (byte-identical to today).

| Axis | Realizes | Values (dotnet shown; menu is per-platform) | Default |
|---|---|---|---|
| `foundation:` | opinionated domain/app framework, or none | `vanilla` · `abp` (phoenix/elixir: `vanilla` only — `ash` removed; node: `vanilla` · `nestjs`) | `vanilla` (phoenix/elixir: `vanilla`) |
| `application:` | application-layer orchestration topology | `flat` · `serviceLayer` · `cqrs` | `cqrs` |
| `persistence:` | data-access library only | `efcore` · `dapper` · `marten` | `efcore` |
| `directoryLayout:` | source-tree organization | `byLayer` · `byFeature` | `byLayer` |
| `transport:` | HTTP surface | `controllers` · `minimalApi` | `controllers` (the attribute-routed `[ApiController]` surface the backend has always emitted; the labels were historically inverted and swapped 2026-06-10 — `minimalApi` is the reserved/unbuilt alternative) |
| `runtime:` | aggregate execution / concurrency model | `transactional` · `orleans` · `akka` (phoenix: `transactional` · `genserver`) | `transactional` |

**Rulings folded in:**

- **`foundation:` is its own keyword** — *this is the amendment to
  D-PHOENIX-SURFACE.* The Ash/Ecto (and EF/ABP, Drizzle/NestJS) domain-framework
  axis is **not** a `persistence:`/`style:` value; it is `foundation:` (default
  `vanilla`). This keeps the data layer pickable under a framework
  (`foundation: ash` + `persistence: ashSqlite`; `foundation: abp` +
  `persistence: dapper`). It preserves D-PHOENIX-SURFACE's correct **no
  `domain:` keyword** instinct — `foundation:` names the framework hosting the
  domain, not the domain (which is the `.ddd` source).
- **`persistence:` narrows** to the data-access library only (no domain
  framework). Prefer it over "dal" (dated acronym).
- **`style:` → `application:`** (layer-named; not `layering:`, which collides
  with its own value and miscasts CQRS). Values are a topology spectrum
  `flat` → `serviceLayer` → `cqrs`. `flat` (not `transactionScript` — that is an
  orthogonal logic-organization pattern spanning all three values; Loom is
  domain-model by construction so that axis is pinned and unexposed).
- **`layout:` → `directoryLayout:`** (explicit; disambiguates from the
  page-level `layout:` wrapper — a real collision).
- **`runtime:` default is `transactional`** (names the DB-transaction
  consistency model; the contrast to actor-mailbox serialization), not the
  earlier coinage `pooled`.
- **Foundation owns layers.** Each `foundation:` value declares which of
  `{application, transport, persistence-flavor}` it owns; setting an owned knob
  is an error. `vanilla` owns nothing.
- **Actor runtimes need a durable store, not necessarily a journal** — event
  sourcing is idiomatic for persistent actors, not required (Akka.NET + EF via a
  `DbContextFactory` is a valid, non-standard state-stored mode). `flat` × actor
  runtime is a *warning*, not an error.

All axes are **optional**; lowering normalizes each omitted knob to its platform
default, so the IR carries concrete values and `ddd snapshot` round-trips the
normalized form (mirrors `design:` via `BUILTIN_PACK_LATEST`).

**Affects.** `proposals/platform-realization-axes.md` (the full spec);
`proposals/storage-and-platform-config.md` (its `style:`/`layout:` names and the
"`platform: dotnet` defaults" row are renamed per this decision);
`proposals/elixir-ecto-and-api-only-backends.md` (its Phase-2 "`style:` vs
`persistence:` field" question is answered: `foundation:`); the `Platform` /
deployable grammar; `DeployableIR`; `checkDeployable`; each backend's
`PlatformSurface` (menu+default fields). **Amends D-PHOENIX-SURFACE** open-item 1;
**depends on D-ADAPTER-HOME**.
