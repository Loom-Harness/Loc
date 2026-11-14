# D-GATE-LADDER — one refusal order for every request on an aggregate row, on every backend

**Status:** owner ruling, 2026-11-13; applied to operation routes, `can_<op>`, the canonical `destroy` and the generic `update` on all five backends.

**Decision.** A request on an aggregate row is refused in one order:
authn (401) → request shape (422) → a `requires` that reads no row (403) →
load through the read scope (404) → a `requires` that reads the row, and the
write scope (403 / 404) → version `If-Match` (409) → `when` (409) →
preconditions and invariants (409 / 422). `src/ir/plan/gate-ladder.ts` encodes
it; every backend renders the checks it lists in that order.
`GET /{id}/can_<op>` runs the same ladder without a body: the by-id read gate
refuses (403) and a row outside the read scope is 404, as `GET /{id}` answers;
the operation's own `requires` and `when` answer `{ "allowed": false }`, and a
gate that reads an operation parameter answers `false`.

**Why.** A caller refused at the row-independent gate gets the same 403 for an
existing id, a missing id, a stale `If-Match` and a row in the wrong state, so
the refusal is no existence, version or state oracle. Shape precedes `requires`
because every backend's framework binding validates the body before any handler
runs; the shape rung depends only on the body and the published schema, so
answering it first leaks nothing (D-CREATE-GATE-ORDER).

**Consequence.** Pinned by the gate-order and `can_<op>` rungs of
`AUTHZ_LADDERS["auth-simple"]` and `AUTHZ_LADDERS["read-gates"]` in
`test/behavioral/cases.mjs`, run by every behavioural runner.
