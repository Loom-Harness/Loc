# D-VANILLA-ES-HOME — pure event sourcing on Elixir lands only under `foundation: vanilla`

> **Superseded (2026): the Ash foundation was removed.** `platform: elixir` is plain Ecto/Phoenix only; `foundation: ash` is now a validation error and `vanilla` is the default and only valid value. The Ash-vs-vanilla reasoning below is historical.

**Status:** PINNED — **amended by D-ELIXIR-PLATFORM** (the gap lives on
`platform: elixir` after the rename; the Ash-foundation-vs-Phoenix-platform
distinction in this decision's body is unchanged — the constraint is the
Ash *foundation*, on the Elixir *platform*). (Resolves the
`EVENT_SOURCING_BACKENDS` Elixir gap left open in
`proposals/workflow-and-applier.md`; **depends on
D-VANILLA-PHOENIX-FOUNDATION**.)

**Problem.** `validateEventSourcedStorage` (`src/ir/validate/checks/system-checks.ts`)
rejects `persistedAs: eventLog` aggregates on Phoenix today;
`ash-postgres-persistence.ts:60` advertises `supportedStrategies: ["state"]`
only. Once vanilla exists, the gate can lift on a foundation-sensitive basis —
but the question of *whether to also pursue Ash-foundation ES* (via AshEvents
adoption, AshCommanded adoption, or a custom `Ash.DataLayer`) is independent
and material.

**Decision.** Pure event sourcing on Phoenix lands **only** under `foundation:
vanilla`. `foundation: ash` + `persistedAs: eventLog` stays a hard error after
vanilla ships, with a structured diagnostic naming the Ash foundation as the
constraint and pointing the user at `foundation: vanilla` or a non-Phoenix
backend. The following alternatives are **explicitly not pursued**:

- **AshEvents adoption.** Its hybrid model (state table + centralised event
  log + action-wrapping + manual whole-resource replay) diverges from Loom's
  pure per-aggregate-stream / fold-on-load contract. Reconciling would force
  either a divergent Phoenix semantics or a fight-the-grain projection.
- **AshCommanded adoption.** Closest match semantically (Commanded aggregates
  + apply/2 + per-aggregate streams) but ships heavy infrastructure
  (Commanded + EventStore Postgres) for a single foundation, when the vanilla
  path achieves the same contract zero-dep.
- **Custom `Ash.DataLayer` over event streams.** Re-implements AshCommanded
  internals; ~months of work; half-bridges leak (`AshPhoenix.Form`,
  `AshGraphql`, `AshJsonApi`, relationships all assume the data layer answers
  queries about current state).

Rationale: the cross-backend pure-ES contract is live on four paths already
(Hono/Drizzle, Hono/MikroORM, .NET/EF, .NET/Dapper); vanilla joins them as a
fifth port of a proven shape (~2–4 days of work). The Ash paths each carry
multi-week-to-month costs to land *partial* fits. Routing ES through vanilla
costs nothing additional once vanilla exists.

**Affects.** `src/ir/validate/checks/system-checks.ts`
(`EVENT_SOURCING_BACKENDS` un-gate gains a foundation predicate — `phoenix` +
`foundation: vanilla` only); `test/ir/eventsourced-storage-support.test.ts`
(extend the matrix); the structured diagnostic from
`proposals/vanilla-phoenix-foundation.md` P0; `MigrationsIR` consumers (the
shared `<agg>_events` shape extends to the Ecto migrations renderer in P4).
**Depends on D-VANILLA-PHOENIX-FOUNDATION**.
