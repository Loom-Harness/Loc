# D-VANILLA-PHOENIX-FOUNDATION — `foundation: vanilla` is added to the Elixir foundation menu

> **Superseded (2026): the Ash foundation was removed.** `platform: elixir` is plain Ecto/Phoenix only; `foundation: ash` is now a validation error and `vanilla` is the default and only valid value. The Ash-vs-vanilla reasoning below is historical.

**Status:** PINNED — **amended by D-ELIXIR-PLATFORM** (the foundation menu lives
on `platform: elixir` after the rename; "Phoenix menu" wording below refers to
the same surface). The decision's substance — `foundation: vanilla` as a
first-class second adapter on the Elixir backend, `foundation: ash` remaining
the default, the validator R5 gate — is unchanged. (Concretises one menu slot of
**D-REALIZATION-AXES**; spec in `proposals/vanilla-phoenix-foundation.md`.)

**Problem.** D-REALIZATION-AXES pinned the `foundation:` axis with `phoenix: ash ·
vanilla` as the menu, but the validator (`src/language/validators/data/platform-rules.ts:184`)
currently returns the single-element `["ash"]` and the lowerer
(`src/ir/lower/lower-platform.ts:46`) defaults to `ash` — `vanilla` is a planned
value with no emitter behind it. Two operationally distinct strains on
`foundation: ash` motivate building the second emitter:

1. **Exception-less alignment.** A4 of `proposals/exception-less.md` deletes
   route-layer try/catch towers on every backend in favour of variant dispatch
   on typed `or`-union returns. The current Phoenix emitter has the tower as a
   design feature (`Plug.ErrorHandler` translates `Ash.Error.Invalid` → 422,
   `Ash.Error.Forbidden` → 403, `Ash.Error.Query.NotFound` → 404).  Vanilla
   Ecto's `{:ok, _} | {:error, changeset}` is the natural typed-error carrier;
   the tower collapses into per-variant `with`-block dispatch (the same shape
   TS/.NET adopt post-A4).
2. **Pure event sourcing.** The cross-backend pure-ES contract (no state
   table, per-aggregate `<agg>_events` stream, fold-on-load, emit-and-apply
   command bodies) is live on Hono/Drizzle, Hono/MikroORM, .NET/EF, and
   .NET/Dapper. Under `foundation: ash` there is no clean fit — AshEvents is
   hybrid (state table, single centralised event log, action-wrapping);
   AshCommanded is closer but heavy; a custom `Ash.DataLayer` over event
   streams is months of work (re-implements AshCommanded's internals).

Both strains are **Ash-foundation limitations, not Phoenix-platform
limitations** — Phoenix itself (Plug + Endpoint + Router + LiveView) is
domain-layer-agnostic; what doesn't fit is `Ash.Resource`'s changeset-shaped
action model + `Ash.DataLayer`'s queryable-store callback contract.

**Decision.** `foundation: vanilla` is added to the Phoenix menu as a
first-class second adapter. Emits plain `Phoenix.Endpoint` + `Phoenix.Router` +
LiveView over plain `Ecto.Schema` / `Ecto.Changeset` / `Ecto.Repo` — no
`Ash.Resource`, no `AshPostgres`, no `AshPhoenix.Form`. The existing
`foundation: ash` path is unchanged and remains first-class; neither is
deprecated.

**Affects.** `src/language/validators/data/platform-rules.ts:184` (lift the
single-element menu); `src/ir/lower/lower-platform.ts:46` (keep `ash` default —
see D-VANILLA-DEFAULT); a new `src/generator/phoenix-live-view/vanilla/`
subtree (sibling emitters: `schema-emit`, `changeset-emit`, `policy-emit`,
`context-emit`, `repository-emit`, `vanilla/api-emit`,
`vanilla/problem-details-emit`); a new `ecto-postgres-persistence` adapter; the
strict-parity conformance gate. **Depends on D-REALIZATION-AXES**;
**enables D-VANILLA-ES-HOME**.
