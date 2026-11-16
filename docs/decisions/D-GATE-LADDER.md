# D-GATE-LADDER — one refusal order for every request on an aggregate row, on every backend

**Status:** owner ruling, 2026-11-13; applied to operation routes, `can_<op>`, the canonical `destroy`, the generic `update` and the polymorphic base read on all five backends.

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

Two shapes place a gate by what it reads, not by where it is written. On a
merge-patch `update` (RS-47) a gate that reads a parameter reads the merged
value — the stored one when the body omits the key — so it needs the row and
runs at the row-reading rung, as does a `mask unless` write gate
(`mergePatchUpdateLadder`). The polymorphic base read (`GET /api/<bases>`, TPH
`/{id}`) runs every concrete's list-read gate before its load (`readLadder`),
and its derived operations declare that 403.

Only an operation body's leading run of `requires` is on the ladder. A later
`requires` runs in the domain method, after the load, `If-Match` and `when`;
the compiler warns (`loom.requires-not-leading`) when such a gate reads no field
and no `let`, since then it can move into the leading run unchanged.

**Why.** A caller refused at the row-independent gate gets the same 403 for an
existing id, a missing id, a stale `If-Match` and a row in the wrong state, so
the refusal is no existence, version or state oracle. Shape precedes `requires`
because every backend's framework binding validates the body before any handler
runs; the shape rung depends only on the body and the published schema, so
answering it first leaks nothing (D-CREATE-GATE-ORDER).

**Consequence.** Pinned by the gate-order and `can_<op>` rungs of
the `authzLadder` of the `auth-simple`, `read-gates` and
`inheritance-read-gates` corpus fixtures (their `.corpus.json` sidecars),
run by every behavioural runner.

**Enforced by:** `test/system/gate-ladder-census.test.ts`, `test/fixtures/corpus/auth-simple.ddd`, `test/fixtures/corpus/read-gates.ddd`, `test/fixtures/corpus/inheritance-read-gates.ddd`
