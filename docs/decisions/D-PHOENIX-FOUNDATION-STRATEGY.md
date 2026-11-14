# D-PHOENIX-FOUNDATION-STRATEGY — vanilla is the home for everything that fights Ash; Ash stays for the CRUD sweet spot, feature-frozen at the boundary, not deprecated

> **Superseded (2026): the Ash foundation was removed.** `platform: elixir` is plain Ecto/Phoenix only; `foundation: ash` is now a validation error and `vanilla` is the default and only valid value. The Ash-vs-vanilla reasoning below is historical.

**Status:** PINNED. (Go-forward stance over **D-VANILLA-PHOENIX-FOUNDATION** /
**D-VANILLA-ES-HOME** / **D-VANILLA-DEFAULT**, prompted by a third Ash-fit
deferral.  No new mechanism — a prioritisation + feature-direction policy.)

**Problem.** The friction between Ash's model and Loom's contracts is not a
one-off; it recurs, and each occurrence is paid as a per-feature Phoenix
deferral or an off-Ash workaround:

1. **Pure event sourcing** — no clean fit on `foundation: ash`; deferred to
   vanilla (D-VANILLA-ES-HOME; `proposals/workflow-and-applier.md`).
2. **Workflow saga / correlation state** — kept a plain `Ecto.Schema`
   deliberately *off the Ash action surface*, because the dispatcher mutates
   it imperatively (load-or-allocate / route-or-drop), not via changeset
   actions (`proposals/channels.md`; `dispatch-emit.ts`).
3. **Exception-less variant returns** — Phoenix is the odd backend out; the
   `Plug.ErrorHandler` rescue tower that translates `Ash.Error.*` is a
   *designed-in* feature on Ash that fights the cross-backend typed-`or`-union
   dispatch (`proposals/exception-less.md`; D-VANILLA-PHOENIX-FOUNDATION §1).

The common cause is structural and consistent: **`Ash.Resource`'s
changeset-shaped action model + `Ash.DataLayer`'s current-state queryable
contract do not fit Loom's imperative / non-CRUD / event-sourced / typed-error
paths.** Ash remains a *good* fit for what it was built for — declarative CRUD
aggregates, AshPostgres migrations, admin-shaped LiveView forms. The boundary is
the issue, not the framework.

**Decision.**

1. **Feature-direction policy.** New Phoenix domain capabilities that hit the
   Ash action-model boundary — event sourcing,
   exception-less returns, future saga / projection / outbox work — target
   **`foundation: vanilla`** as their Phoenix home. `foundation: ash` is
   **feature-frozen at that boundary**: it is fully supported for the CRUD/admin
   sweet spot and gets cheap parity where it falls out naturally, but we do
   **not** grow bespoke Ash workarounds (custom data layers, AshEvents/AshCommanded
   bridges, action-wrapping) to force ill-fitting patterns onto it. This makes
   explicit the de-facto pattern already in the tree (1–3 above).
2. **Vanilla is the next foundation investment.** Building the vanilla emit
   subtree (P2 of `proposals/vanilla-phoenix-foundation.md`) is now the gating
   dependency for *multiple* deferred features, so its cost is paid once instead
   of re-paid as recurring deferrals. Prioritise it ahead of further per-feature
   Phoenix-on-Ash special-casing.
3. **Ash is NOT deprecated now.** Deprecating `foundation: ash` is premature:
   vanilla is unbuilt and unproven, Ash's declarative DX is a real asset for the
   CRUD case, and D-VANILLA-DEFAULT already sequences vanilla-as-default behind a
   stabilisation cycle. The "neither is deprecated" stance of
   D-VANILLA-PHOENIX-FOUNDATION holds.
4. **Sunset is a *later, conditional* decision.** Whether `foundation: ash` is
   eventually deprecated is deferred and **revisited only after** vanilla (a)
   ships, (b) passes the strict cross-backend parity gate, and (c) clears the
   same stabilisation signals D-VANILLA-DEFAULT defines (a green
   `phoenix-vanilla-build.yml` minor-release cycle + no obs-e2e regressions). At
   that review, weigh the cost of maintaining two Phoenix emitters against Ash's
   residual value for the CRUD sweet spot. Do not pre-commit either way here.

**Affects.** No code change. Sequencing/roadmap: elevates
`proposals/vanilla-phoenix-foundation.md` P2 to the next Phoenix work item;
sets the policy any future
Ash-boundary feature are evaluated against. **Depends on
D-VANILLA-PHOENIX-FOUNDATION**; **informs D-VANILLA-DEFAULT** (its
stabilisation signals double as the sunset-review trigger).
