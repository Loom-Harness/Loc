# D-WIRE-RECORDS — the declared contract records are the only wire source

**Status:** PINNED. Supersedes D-WIRESHAPE-KEEP.

**Rule.** What crosses the wire is what the context's contract records
declare:

- **Reads.** An aggregate's or entity part's read wire is its declared
  `response <X>Response` record. `responseWireFor`
  (`src/ir/util/response-wire.ts`) turns a record into the ordered rows every
  backend's DTO, serializer, OpenAPI schema and api-client renders, and every
  frontend's response schema reads (`id`, then the record's fields; a
  `provenanced` field in its `Provenanced<T>` carrier). The aggregate's masks
  ride on the record through `declaredResponseFor`
  (`src/ir/util/declared-response.ts`), so a record never drops a redaction
  the serializer applies.
- **Value objects.** A value object has no record of its own; its declaration
  is its wire (`valueObjectWire`).
- **Requests.** A create, operation, destroy or get-by-id request is its
  declared `command` / `query` record. The scaffold splices one for every
  concrete aggregate of an exposed context, whether its repository is
  declared in source or added by enrichment (`requestTargets`,
  `src/macros/stdlib/scaffold/_handlers-shared.ts`), because the deployable
  serves both.
- **The artefact.** `.loom/wire-spec.json` renders the same records
  (`aggregates`, `parts`, `valueObjects`, `requests`) and is what `ddd diff`
  compares.

There is no second, derived wire shape: no helper computes an entity's wire
from its members. `src/ir/enrich/wire-projection.ts` keeps the access
filters (`forApiRead`, `forCreateInput`, …) and the create / update input
derivations the backends' request handling reads.

**Why.** Two sources for one wire disagreed in practice: a serializer reading
the derived shape served fields its own OpenAPI schema (read from the record)
did not declare, and a spec built from the derived shape published `internal`
fields no serializer sent. With one source, a backend, a frontend and the
diffed artefact cannot describe different JSON.

**Held by.** `test/system/wire-spec-requests-census.test.ts` (every served
create, operation and command-started workflow has a request record) and
`test/system/create-request-census.test.ts` (every served creatable aggregate
has a declared create record), both at zero;
`test/ir/contract/frontend-contract-census.test.ts` (the Frontend Contract
names no derived-wire helper).

**Enforced by:** `test/system/wire-spec-requests-census.test.ts`, `test/ir/contract/frontend-contract-census.test.ts`
