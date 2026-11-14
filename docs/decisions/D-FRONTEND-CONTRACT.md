# D-FRONTEND-CONTRACT — a frontend target emits from the Frontend Contract, an allowlisted projection of the UI and the exposed wire surface

**Status:** owner rulings, 2026-11-13 (the wire source and the four borderline
derivations); the contract's shape follows from them.

**Decision.** `src/ir/contract/` builds the Frontend Contract
(`buildFrontendContract`), and `ddd emit-frontend-contract <file.ddd>` writes it
as JSON (stdout, or `<out>/.loom/frontend-contract.json`). It has two halves:

- **UI:** the system's `ui`s, root components and layouts, with every page
  body, action, store and derived expression resolved (`refKind`,
  `receiverType` / `memberType`, `callKind`). Types are nominal, so a type edge
  names a wire record instead of embedding a domain node.
- **Wire:** the exposed API — the operations of every context an `api`
  exposes, one response record per exposed aggregate and part, the declared
  `command` / `query` / `error` / `payload` records with the paged and union
  carriers, the events a UI notification names, and the value objects (fields,
  derived members, wire-validated invariants) and enums the contract names.

**Built by allowlist.** Every reachable IR type has a spec in
`src/ir/contract/` naming each of its fields as kept, projected, dropped or
denied. The spec types are mapped over the IR types, so a field added to one
fails to compile until it is classified; a field present at runtime that no
spec names stops the build. Denied fields and kinds are the ones whose presence
means a domain fact would ship: a repository read, an `exists` read, a
capability filter, a domain-service, workflow-helper, private-operation or
service-to-service call, a mask-write gate, provenance capture, a domain
`emit`. Source origins are dropped. The result is JSON-exact: it equals its own
`JSON.parse(JSON.stringify(…))`.

**The wire half reads through `declaredResponseFor`.** Response records come
from `contractResponsesFor` (`src/ir/util/declared-response.ts`), which returns
the declared `<Entity>Response` records of an aggregate and its parts as
`declaredResponseFor` gives them, each field carrying its aggregate's mask. The
derived wire shape is never read: no contract module names a `wireFieldsFor*`
helper, `test/ir/contract/frontend-contract-census.test.ts` enforces it, and a
declared record states the `id` every backend serializes first. An aggregate
whose context declares no response record is not exposed over a declared
contract and is absent. Request shapes are the declared `command` / `query`
records; no derived create-input or operation-input shape ships, and the
synthesized `<Agg>Wire` record (a restatement of the derived shape) is left out.

**Masks ship as a flag.** A masked response field carries `maskable: true`. The
`mask unless` predicate and the mask-taint analysis stay server-side.

**Which derivations are shared.** `invariant-classify`, `wire-policy` and
`wire-projection` are shared read helpers; `wire-projection` (`wireFieldsFor*`)
is internal-only and never part of a published contract package's API, so its
retirement is not a breaking change for third-party frontends. `mask-taint` is
server-only.

**Why an allowlist, not a pruned clone.** Types erase on serialization, so the
only protection the contract has is what its bytes contain. A pruned clone
ships every field nobody remembered to prune, including back-links into the
pruned subtrees; an allowlist ships only what someone added on purpose.
