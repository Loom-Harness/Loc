# D-PHOENIX-FOUNDATION-ROUTING — Phoenix feature parity is reached by routing to `vanilla`, not by investing in Ash

> **Superseded (2026): the Ash foundation was removed.** `platform: elixir` is plain Ecto/Phoenix only; `foundation: ash` is now a validation error and `vanilla` is the default and only valid value. The Ash-vs-vanilla reasoning below is historical.

**Status:** PINNED — ratified 2026-06 (backend feature-parity plan, W4).
Generalises **D-VANILLA-ES-HOME** from event sourcing to *every* feature with
no idiomatic Ash fit; **depends on D-VANILLA-PHOENIX-FOUNDATION**.

**Problem.** Several features (event-sourced storage, event-sourced workflows,
provenanced fields, full `shape: document` ops, `emit`/`add`/`remove`-bodied
`or`-union-returning ops) emit cleanly on `foundation: vanilla` but have **no
idiomatic Ash fit**. The recurring question is whether to close the
Phoenix-side gap by routing those contexts to `vanilla` (treating the `ash`
gates as the deliberate final answer) **or** by investing in an Ash-idiomatic
emission (AshEvents/AshCommanded for ES, an Ash `:map` document, an Ash
provenance extension, a custom `Ash.DataLayer`).

**Decision.** **Route, don't invest.** "Full parity" on Phoenix is reached by
`foundation: vanilla` for these features; `foundation: ash` keeps each one a
**fail-fast validator error** that names the constraint and points at
`foundation: vanilla` (never a silent downgrade). The Ash-side build-out is
**explicitly out of scope** — the cost is multi-week-to-month for *partial*
fits (see the "explicitly not pursued" list in D-VANILLA-ES-HOME), against a
zero-additional-cost vanilla port of a proven cross-backend shape. This is the
canonical case that "parity" means *emitted **or** fail-fast-gated*, not "every
backend emits every feature" (`plans/backend-parity-plan.md`).

**Already in place (no new compiler work).** Every routed feature already
emits on vanilla and gates on ash today: ES storage/workflows
(`EVENT_SOURCING_BACKENDS` + foundation predicate), provenance
(`PROVENANCE_BACKENDS` + `validateProvenancedStorage`), document-CRUD
(`loom.vanilla-document-unsupported`), returning-op bodies
(`loom.operation-return-unsupported`). Each is compiled against real
Elixir/Ecto by `elixir-vanilla-build.yml`. W4 is therefore a **documentation +
ratification** workstream, not an emission one.

**Affects.** `docs/platforms.md` (the *Phoenix foundations* routing table);
`docs/generators.md` (the five-backend matrix's `elixir·ash` / `elixir·vanilla`
columns); the `loom.*` gate diagnostics already cited above (unchanged — this
decision ratifies their finality).
