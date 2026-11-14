# D-CREATE-GATE-ORDER — wire validation (422) precedes a lifecycle create gate (403) on every backend

**Status:** applied on all five backends.

**Decision.** For a guarded canonical `create` with an INVALID body, every
backend answers 422, not 403. Node, .NET, Java and Python validate at the route
boundary ahead of the handler that evaluates the gate; Elixir's
`create_<agg>/2` runs `Ecto.Changeset.apply_action(…, :insert)` on the base (or
document) changeset before the gate check, covering both the REST and LiveView
doors (`src/generator/elixir/vanilla/context-emit.ts`).

**Why.** The wire rung depends only on the body and the published schema, so
answering it first leaks nothing a client could not compute from the OpenAPI
document. Deny-first would have moved four backends and their route-boundary
validators.

**Consequence.** Pinned by the `lifecycle-guard` surface "guarded create,
INVALID body" in `test/behavioral/cases.mjs` (anonymous unpinned, unauthorized 422,
authorized 422). The body-rung pointer is `/<field>` for a
single-field-shaped rule and `""` (the whole request) otherwise; a
message-less domain-floor rule carries no `errors[]`.
