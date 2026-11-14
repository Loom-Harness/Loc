# D-NO-MIXED-FOUNDATION — one foundation per deployable; per-aggregate override not added

> **Superseded (2026): the Ash foundation was removed.** `platform: elixir` is plain Ecto/Phoenix only; `foundation: ash` is now a validation error and `vanilla` is the default and only valid value. The Ash-vs-vanilla reasoning below is historical.

**Status:** PINNED — **amended by D-ELIXIR-PLATFORM** (substance unchanged;
`platform: phoenix` references in the body now read `platform: elixir`
post-rename). (Structural consequence of **D-REALIZATION-AXES** + the
deployable model; recorded explicitly to forestall the per-aggregate override
extension request.)

**Problem.** A natural-sounding feature request is "let me keep Ash resources
for state-based aggregates and use vanilla emit for the ES aggregate in the
*same* deployable." The motivation is real (some domains genuinely mix
state-based-CRUD aggregates with one or two ES aggregates), but the
implementation cost compounds at every call site: workflow bodies branch on
per-aggregate strategy, forms split between `AshPhoenix.Form` and stock
`to_form(changeset)`, authorization splits between Ash policies and plain
guard functions, telemetry emission splits between Ash trace events and
hand-emitted equivalents.

**Decision.** A single deployable carries one `foundation` value. Per-aggregate
`foundation` override is **not** added.

**Crucially: this is a structural consequence, not an additional policy.**
Under D-REALIZATION-AXES, `foundation:` is a **per-deployable axis** on the
deployable's `platform:` config block (each deployable declares one platform
with one foundation). The per-deployable scope of the axis *already* makes
mixed foundation within a deployable inexpressible in the grammar — this
decision merely confirms the architecture won't grow a per-aggregate escape
hatch, with the rationale that the plumbing cost (above) outweighs the
mixed-foundation use case.

Users who need both Ash-resource and pure-ES aggregates have two principled
paths:

1. **Split bounded contexts across deployables.** State-based contexts deploy
   under `foundation: ash`; ES contexts deploy under `foundation: vanilla`.
   Each deployable is internally coherent; cross-deployable consumption uses
   the api surface as on any cross-deployable boundary.
2. **Pick `foundation: vanilla` for the whole deployable.** State-based
   aggregates emit as plain Ecto schemas (no loss vs Ash for simple CRUD);
   ES aggregates emit as fold+repository. Single mental model.

**Affects.** `proposals/vanilla-phoenix-foundation.md` (the "Mixed-mode within a
context" section is the conversational origin of this decision). No grammar
change required (the constraint is already structural); no validator rule
needed beyond today's per-deployable `foundation:` typing.
