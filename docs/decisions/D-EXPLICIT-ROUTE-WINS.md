# D-EXPLICIT-ROUTE-WINS — an explicit `route` owns its slot; the auto-derived REST surface yields it

**Status:** DECIDED (orchestrator ruling, accepted by the owner, 2026-10-11).

**Question.** An api's explicit `route <METHOD> <PATH> -> <Ctx>.<Handler>` can
land on the same router slot (method + shape-normalised path) as a route of the
always-on auto-derived REST surface. `with scaffoldHandlers` + `with
scaffoldApi` does it for every create / operation / find / get-by-id / destroy;
a hand-written route that shadows `GET /orders/{id}` does it once. Two
registrations on one slot break differently per framework: elixir fails `mix
compile --warnings-as-errors`, .NET and java throw ambiguity errors at request
time, node and python silently serve whichever mounted first (the explicit
handler was dead code there, and python minted each operationId twice). Which
layer owns the slot?

**Decision.** **The explicit layer wins.** An explicit route is declared
intent; the derived surface is a default. `enrichLoomModel` records the slots
each subdomain's explicit routes occupy (`BoundedContextIR.explicitRouteSlots`,
keyed by the subdomain of the route's TARGET context), the shared derivation
(`deriveAggregateOperations`) flags a matching operation
`claimedByExplicitRoute`, and all five route emitters skip a flagged operation
(`servedOperations`). Every explicit route mounts under `API_BASE_PATH` — the
root-mount stop-gap that kept a colliding route out of `/api` is gone.

- The flagged operation stays in the derived list. The slot is still served
  (by the explicit handler), so the typed api-clients keep calling it, and the
  commands, queries, DTOs and service methods behind it are still emitted.
- Where an OpenAPI document is built from the routes themselves (node, python),
  the explicit route's entry is the slot's single operation. Where it is built
  from the derived list (elixir's `OpenApiSpex` spec, java's customizer), the
  derived entry keeps documenting the slot, since those documents do not list
  explicit routes. Either way one operationId per slot.
- Phoenix matches in registration order, so an explicit route that takes over
  a derived slot is spliced where the derived route would have gone — after
  the derived static finds — instead of `first`.
- Models with no explicit route claiming a derived slot generate byte-identical
  output.

**Consequences.** `scaffoldApi`'s routes are real, reachable code that `unfold`
ejects and the user can customise. The generated-name uniqueness census
(`test/system/generated-name-uniqueness.test.ts`) is the ratchet: it carries no
waiver for the scaffold shape and fails if a derived route and an explicit one
share a slot again. Not covered: the two aggregate-scoped routes the derivation
does not lift (`GET <base>/{id}/history`, `GET <base>/prepare`) — an explicit
route on one of those slots still double-registers.
