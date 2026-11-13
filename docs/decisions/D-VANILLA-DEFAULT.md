# D-VANILLA-DEFAULT — vanilla becomes Elixir default after stabilisation, not on first ship

> **Superseded (2026): the Ash foundation was removed.** `platform: elixir` is plain Ecto/Phoenix only; `foundation: ash` is now a validation error and `vanilla` is the default and only valid value. The Ash-vs-vanilla reasoning below is historical.

**Status:** PINNED — **amended by D-ELIXIR-PLATFORM** (the default-flip target
is `platform: elixir` after the rename; sequencing and rationale unchanged).
(Sequences the default-flip of **D-VANILLA-PHOENIX-FOUNDATION**; deferred to a
later release than vanilla's initial ship.)

**Problem.** Today's Phoenix default is `foundation: ash`
(`lower-platform.ts:46`). Once vanilla ships and exception-less A4 is in
place, vanilla is objectively the lower-friction default — no
`Plug.ErrorHandler` rescue tower, direct typed-error mapping, broader contract
coverage (ES + state). But flipping the default in the *same* release that
introduces vanilla risks two things: (a) silent emit-shape change for every
bare-`platform: phoenix` deployable that hasn't been re-validated against
vanilla; (b) regression discovery happening in production before vanilla has
seen real usage.

**Decision.** Vanilla ships **opt-in only initially**. The default stays
`foundation: ash` for at least one minor release after vanilla lands. The flip
is gated on two operational signals:

1. Vanilla has run **at least one minor-release cycle with green CI** —
   `phoenix-vanilla-build.yml` (`mix compile --warnings-as-errors`) and the
   strict-parity matrix entry pass cleanly without ongoing-fix churn.
2. **No obs-e2e regressions** observed on `phoenix-obs-e2e.yml` (vanilla
   variant) for the same cycle.

When both signals are clear, flip in two steps:

1. **Warn-then-flip release.** Emit a `loom.foundation-default-flipping`
   warning on every bare `platform: phoenix` (no explicit `foundation:`)
   for one release cycle, telling the user to set explicit `ash` if they
   want to stay on the current behaviour.
2. **Flip release.** Change `lower-platform.ts:46`'s default from `ash` to
   `vanilla`. Users who didn't act on the warning get vanilla emit; the
   one-line escape hatch (`foundation: ash`) remains supported and
   first-class.

Rationale: zero-surprise migration; opt-in window gives real users time to
validate vanilla before it becomes the default emission; the warning cycle
makes the change visible without breaking anyone's build.

**Affects.** `src/ir/lower/lower-platform.ts:46` (default flip, gated on
release sequencing); `src/language/validators/data/platform-rules.ts`
(`loom.foundation-default-flipping` warning during the warn cycle); release
notes for the two flip-related releases. **Depends on
D-VANILLA-PHOENIX-FOUNDATION**.
