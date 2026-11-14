# D-WIRESHAPE-KEEP — the derived wire shape stays the source of truth; the declared response record is the thing that must be made to agree with it

**Status:** interim — the derived shape stays for now; the goal is to retire
it (owner ruling on #3383). Raised and measured by wave C4 packet 4e, which was sent to build slice 1 of
the `wireShape` retirement or decline with the measurement. It declines.

**Question.** [`docs/old/proposals/unfoldable-api-derivation.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/unfoldable-api-derivation.md) steps 6–8 retire
the derived wire shape: every consumer stops calling
`forApiRead(wireFieldsFor*(node))` and reads the declared `<Agg>Response`
contract record instead, after which `.loom/wire-spec.json` retires too.
M-T5.10 spun that off as "179 refs / 49+45 files, XL". Is it still the right
direction, and what does its first slice cost?

**What the measurement found.** Three facts, all on the C4 coordinator head:

1. **Steps 6 and 7 already shipped.** #1920 (Phase 1) moved every response
   consumer off the stamp and #1937 (Phase 2) deleted it: there is no
   `wireShape` field on `AggregateIR` / `EntityPartIR` / `ValueObjectIR`, no
   phase-⑥ stamping, and no `wireShapeFor`. `EnrichedEntityPartIR` /
   `EnrichedValueObjectIR` alias their base types. What the 179 refs count is
   call sites of the **pure recompute helpers** in
   `src/ir/enrich/wire-projection.ts`, which is what "derive, don't stamp"
   asks for — not readers of a denormalised field. The spun-off item's premise
   is stale.
2. **The records do not exist for any shipped model.** `with scaffoldHandlers`
   is the only thing that splices them, and exactly five tracked `.ddd` files
   use it — the per-backend `scaffold-handlers` compile fixtures. All 79 corpus
   fixtures, every `examples/*.ddd` and every playground example use
   `api X from Subdomain`, which splices none: **0 of 117 corpus aggregates
   carry an `<Agg>Response` record.** "Move a consumer onto the records" is
   therefore not a refactor for the shipping paths; it is gated on proposal
   step 4 (rewriting the implicit `api … from …` derivation to expand through
   the scaffold), which is unbuilt.
3. **Where the records DO exist, they describe a different shape.** Injecting
   the macro into all 79 fixtures materialises 126 contracted nodes, of which
   **25 diverge** — capability-injected fields (`softDeletable` / `auditable` /
   `tenantRegistry`), every field inherited from an `abstract aggregate` base,
   the `provenanced<T>` carrier, the containment `<Part>Response` offset, the
   optional-containment representation, and one field-ORDER difference. Census
   and exact baseline: `test/system/wire-contract-divergence.test.ts`.

**Decision.** The derived shape stays the single source of truth for the wire.
A consumer is NOT moved onto the contract records until the records reproduce
the derived shape, because three of the divergence classes are live defects
today rather than representational offsets: PR2–PR7 already pointed every
backend's response-DTO and schema emitter at the record while the repository
serializer still reads the derived shape, so a scaffolded `softDeletable` or
inheriting aggregate serves fields its own OpenAPI schema does not declare
(`repo.toWire(found) as z.infer<typeof OrderResponse>` — the cast is why `tsc`
never sees it). Widening that split to a sixth consumer family would ship the
defect further, and it cannot be done byte-identically in any case.

**Consequences.**

- `.loom/wire-spec.json` does **not** retire (proposal step 8). #1937 already
  took the proposal's option 3 — keep the artefact, derive it from
  `wireFieldsFor` — and the conformance-parity tier reads it. Options 1+2
  ("drop entirely, a `--wire` snapshot flag as the escape hatch") presuppose that
  contract source is the diffable artefact, which fact 2 says it is not.
- The retirement is re-scoped as **M-T5.40** and inverted: first make the
  record reproduce the derived shape (closing the 25 rows, which fixes real
  defects), then — and only then — consider which consumer reads which.
- The access-modifier filter matrix and the three `wireFieldsFor*` walks stay
  where they are (`src/ir/enrich/wire-projection.ts`), as the one place both
  the derived shape and any future re-derivation from records agree on.

**Re-open it when** the record layer reproduces the derived shape for every
corpus node (M-T5.40 rows A1/A2/B3/C closed) **and** the implicit
`api … from …` form expands through `scaffoldHandlers`, so the records exist
for the paths that actually ship. Until both hold, retirement trades a pure
function for a source of truth that is absent 100 % of the time and wrong 20 %
of the rest.

**Both conditions now hold.**
- **Records match the derived shape.** Every row in classes A, B3 and C of
  `test/system/wire-contract-divergence.test.ts` is closed. The rows that
  remain are the representational `<Part>Response` naming (B1, B2), which
  every emitter un-suffixes.
- **Records exist for every shipped context.** Every context exposed by an
  implicit `api X from <Subdomain>` or by a deployable's `contexts: [...]`
  now carries the `scaffoldHandlers` contract records. The census reads the
  corpus as written and finds no uncontracted node.

One gap is still open, and the census pins it exactly: a record field cannot
carry `mask unless`. So `declaredResponseFor`
(`src/ir/util/declared-response.ts`) keeps masked aggregates on the derived
shape. The decision is open for re-review: what is left is moving consumers
onto the records and retiring `.loom/wire-spec.json`.

**Affects.** `src/ir/enrich/wire-projection.ts`; `src/system/wire-spec.ts`;
`src/macros/api/factories.ts` + `src/macros/stdlib/scaffold/_contracts-shared.ts`
(`apiReadFields`); the response-DTO emitters on all five backends; missions
M-T5.10 and M-T5.40;
[`docs/old/proposals/unfoldable-api-derivation.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/unfoldable-api-derivation.md) steps 6–8 and its coordination
note's item 3.
