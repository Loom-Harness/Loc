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
  carriers, the events a UI notification names, the workflows a client starts
  or observes (start body, the created record's route segment when the start
  answers its id, the instance row) and the projections it reads (one row or a
  list, the row fields), and the value objects (fields, derived members,
  wire-validated invariants) and enums the contract names.

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

**The host rides beside the contract, not in it.** What a target needs about
the deployable it emits for (port, design pack, theme, source locale, the
target's port, the apis it reads through, the `auth: ui` guard, whether the
target serves the realtime wire, the stream credential and the event types the
deployable's contexts broadcast there) is a `FrontendHost`
(`src/ir/contract/host.ts`). The auth guard and the realtime wire are decided
there once, so every frontend target renders them and never re-derives them
(`test/system/frontend-host-census.test.ts`). Realtime is a
host fact, not a contract one: the broadcast set is the deployable's own
contexts', and a system may serve several frontends over different backends.

**Operations and finds carry their decisions.** A contract operation carries
the facts a client needs about the domain operation behind it — its name,
whether the backend guards the write on the row version (`ifMatch`), and which
body params a merge-patch form may omit (`optionalParams`) — and a find carries
the `{api, path}` routes that serve it. A client keeps the first route on an api
its host reads through (`clientFinds`, `src/generator/_frontend/contract.ts`),
which is the route the target backend mounts.

**Workflows and projections are decided once.** Which workflows a client
starts or observes and which projections it reads, with their shapes, are
contract facts; every frontend's workflows and projections api module renders
them (`clientWorkflows` / `clientProjections`) and none re-derives them from the
domain IR (`test/system/frontend-workflow-projection-census.test.ts`).

**A request is its declared command record.** A `create` names the declared
command record its body is (`request`, found by `declaredCreateCommandFor` in
`src/ir/util/declared-request.ts`): `Create<Agg>Command`, or for an
event-sourced aggregate its first `create` action's `<Verb><Agg>Command`, whose
fields are that action's params and never the folded state. A record field
keeps its default, which a create form seeds or fetches from the server. A
`create` or `operation` carries the invariants a client validates its body
against: the aggregate's invariants (and an operation's preconditions) that read
only the request's fields (`classifyForWire`).

**Masks ship as a flag.** A masked response field carries `maskable: true`. The
`mask unless` predicate and the mask-taint analysis stay server-side.

**Which derivations are shared.** `invariant-classify`, `wire-policy` and
`wire-projection` are shared read helpers; `wire-projection` (the access
filters and the create/update input derivations) is internal-only and never
part of a published contract package's API. `mask-taint` is
server-only.

**Why an allowlist, not a pruned clone.** Types erase on serialization, so the
only protection the contract has is what its bytes contain. A pruned clone
ships every field nobody remembered to prune, including back-links into the
pruned subtrees; an allowlist ships only what someone added on purpose.

**React generates from the contract alone.** `generateReactFromContract(contract,
host, options)` (`src/generator/react/from-contract.ts`) is the one entry
everything React emits goes through: the api modules, the pages and components,
the page objects, the app shell, the locale catalogs and the usage-gated
runtimes. It reads the contract and the `FrontendHost`; the enriched-side
`generateReactForContexts` only builds the host and, under `--sourcemap`, the
construct-id → source-origin sidecar the contract does not carry (origins name
local files). The shared layers React renders through answer from contract-built
models — `walkerModelOfContract`, `frontendAggregatesOfContract`, the
contract-built workflows-module scope, page names, workflow page objects,
value-object index and usage flags — each beside an enriched builder the other
targets keep, and each pair is held equal over every tracked model, multi-file
graphs included. The contract's ui half is JSON-exact, so React reads it through
`contractUiOf`, which restores a positional argument's `undefined` name slot.

**Enforced by:** `test/system/react-contract-layering.test.ts`, `test/ir/contract/frontend-contract-gate.test.ts`, `test/ir/contract/frontend-contract-corpus.test.ts`, `test/ir/contract/frontend-contract-census.test.ts`, `test/generator/_walker/walker-model-equivalence.test.ts`, `test/generator/_frontend/aggregate-model-equivalence.test.ts`, `test/generator/_frontend/frontend-scope-equivalence.test.ts`, `test/system/walker-model-census.test.ts`, `test/system/frontend-aggregate-census.test.ts`
