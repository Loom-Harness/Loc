# D-ADAPTER-HOME — persistence/style/layout adapters live on the backend surface

**Status:** PINNED.

**Problem.** The storage F-series introduced a persistence/style/layout
adapter taxonomy with the contracts correctly in core
(`src/generator/_adapters/`), but a **central** registry
`src/platform/adapter-registry.ts` that statically imports every
backend's adapter implementations. That central fan-in (a) becomes a
`core → package` edge — the direction `backend-packages-layering.test.ts`
forbids — the moment a backend relocates into `packages/`, and (b)
already causes a load-time import cycle (`adapter-registry ← cqrs-style
← … ← platform/registry ← platform/dotnet`), which forced F5d/F6d to
bind each orchestrator's **own local sibling adapters** instead of
resolving through it.

**Decision.** Adapter **implementations** belong to the backend, exposed
through its `PlatformSurface` (an additive contract field carrying the
adapter menu + defaults). `@loom/core` owns only the **contracts**
(`src/generator/_adapters/`) + the `resolve*` helpers, which read
menu/defaults off the *discovered* surface. The central
`src/platform/adapter-registry.ts` is **interim** and does **not**
survive the alignment pass.

**Mechanism / status.**

- The *emit* half is already decentralised (F5d/F6d orchestrators
  dispatch through local adapters). Remaining work: source the menu +
  defaults from the surface, then delete the central registry's static
  fan-in.
- Version-divergent adapters (efcore8 vs efcore10, Ash 3 vs 4) ship
  inside the version's backend package — that divergence *is* the
  package's reason to exist. No shared cross-framework adapter layer
  (e.g. a `node`-shared drizzle) until ≥2 real consumers exist
  ("consolidate the present, don't design for the future").

**Affects.**

- `storage-and-platform-config*.md` — the adapter-registry shape they
  describe is interim per this decision.
- Depends on D-BACKEND-PKG (the surface is the discovery unit).
