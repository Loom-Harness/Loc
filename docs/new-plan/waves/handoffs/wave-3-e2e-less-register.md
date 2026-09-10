# Wave 3 · row 3.3 — the E2E-less register (M-T9.13)

**Claim.** This is the claim ticket for wave-3 row 3.3. It is a DRAFT while the
drain is in progress; the packet table in `docs/new-plan/waves/wave-3.md` is the
live status. Do not open a second PR against `E2E_LESS_CORPUS_FIXTURES`,
`test/behavioral/cases.mjs`, or the corpus fixtures listed under "Blast radius"
without reading this first.

## What this drains

`E2E_LESS_CORPUS_FIXTURES` (`test/ir/api-caller-census-pins.ts`) waives **13**
corpus fixtures from the api-operation caller census — re-verified against fresh
`main` @ `93bc82d6a`, still exactly 13, unchanged since the row was written.

Two are witness-by-design and STAY waived, because their oracle genuinely lives
at another tier rather than being absent:

| fixture | why it is honest |
|---|---|
| `collection-op-shapes` | compile-tier witness; a behavioural block would add uncalled routes and unrecorded goldens for no extra oracle |
| `numeric-operands` | compile + unit witness; its `test` block IS the runtime oracle, and a wire golden would sit inside the un-ruled cross-backend decimal divergence (F11 / M-T5.22) |

The other 11 each name a prose blocker. The register's own history is the reason
to distrust those sentences: `archive/refresh-log.md` records **three for three
— every drain so far uncovered a live defect the waiver was hiding**, and in all
three the STATED blocker was not the real one (`policy-document` #2696,
`lifecycle-guard` #2717, `policy-deny` #2517). So each entry gets its nouns
re-derived against the emitters before its blocker is believed.

## The root blocker, verified rather than assumed

Row 3.3 says to start with `projection-agg-filters`,
`projection-document-aggregation` and `tenancy-hierarchy` "using the two-principal
harness (M-T9.28 slice 1)". That harness landed — but it is a **permission**
second identity, not a **tenancy** one. On fresh `main`, `test/behavioral/cases.mjs`:

```js
export const DEV_CLAIMS             = { tenantId: "acme", orgId: "acme", role: "agent",   … }
export const DEV_CLAIMS_UNAUTHORIZED = { tenantId: "acme", orgId: "acme", role: "visitor", … }
```

Both principals share the tenant **by design** — the file says so, and the
register says so twice more (`tenancy-hierarchy`: "the behavioural suite
authenticates as one whose claim is not a registry id at all";
`policy-document`: "`DEV_CLAIMS_UNAUTHORIZED` shares the tenant by design").

So today's harness can prove *denied by predicate* (403) but cannot prove *row
hidden because it belongs to another tenant* — and all three headline cells are
cross-tenant statements. **The first slice is therefore minting a genuine
second-tenant principal in the behavioural harness, not writing callers.** Any
caller written before that would assert the wrong thing and pass.

## Order of work

1. **Second-tenant principal** in `test/behavioral/cases.mjs` — a distinct
   `tenantId`, and for the registry cells a claim that IS a registry id, which is
   the half `R.tenantRegistryRow` and `tenancy-hierarchy` share. Mutation-proved:
   the new assertions must FAIL against today's single-tenant claims.
2. **The two leak cells** — `projection-agg-filters` and
   `projection-document-aggregation`. These exist *because of* a cross-tenant
   COUNT leak, so they are the cells the new principal was minted for.
3. **`tenancy-hierarchy`** — deep-rung subtree scoping, same principal work.
4. **The cheap real drains** — `handler-triad`'s `Echo`/`Sum` are pure-computation
   routes needing no data at all, the single cheapest genuine drain in the
   register. `extern` / `extern-handlers` / `handler-triad` share one fixture-shape
   blocker: `Order` has no `crudish` and no author-declared create, so no route can
   mint a row. Precedent for that fixture change is `scaffold-macros`' `Item`
   (#2468) and `eventsourced-workflow`'s `Order` (M-T9.12).

Entries whose blocker is a genuine SIDECAR (`channels-broker`, `outbox`,
`resources`, `handler-resource-ops`, `api-call`) are expected to stay waived —
their runtime homes are the label/post-merge legs. If one of them turns out to be
drainable anyway, that is a finding and gets said out loud rather than quietly
drained.

## Blast radius

- `test/behavioral/cases.mjs` + the behavioural runners (the new principal)
- `test/ir/api-caller-census-pins.ts` (the register; it RATCHETS, so a drained
  entry is deleted in the same PR — a stale pin fails the gate)
- corpus fixtures for the drained cells, and their wire goldens
- **possibly an emitter**, if the pattern holds and a waiver was hiding a defect

## Rule this packet is held to

A drain lands only with its own runtime assertion actually running, and the gate
mutation-proved: reverting the fix (or seeding the defect) must turn the new
assertion RED. A green first run proves nothing — that is the recurring failure
shape in `experience_gathered.md` §59/§63, and the register is exactly the kind
of ratchet where a check that never reaches the thing it names would go unnoticed.
