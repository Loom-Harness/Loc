# Wave 3 · row 3.3 — the E2E-less register (M-T9.13)

**Claim.** This is the claim ticket for wave-3 row 3.3. It is a DRAFT while the
drain is in progress; the packet table in `docs/new-plan/waves/wave-3.md` is the
live status. Do not open a second PR against `E2E_LESS_CORPUS_FIXTURES`,
`test/behavioral/cases.mjs`, or the corpus fixtures listed under "Blast radius"
without reading this first.

## What this drains

`E2E_LESS_CORPUS_FIXTURES` (`test/ir/api-caller-census-pins.ts`) waives the
corpus fixtures the api-operation caller census cannot reach. The count is **14**
as of `main` @ `09427a5f9` — it was 13 when this packet was claimed, and
`auth-id-claim` joined from `main` while the packet was open. That is the
register behaving correctly (it RATCHETS, and a growing population is not a
regression), but it is also the reason this note carries a date-stamped count
rather than a bare number: row 3.3's own "13 fixtures" is already stale.

`auth-id-claim` arrives as witness-by-design and is NOT this packet's to drain:
its whole bug class is caught statically by the compile legs, and the harness's
mock issuer mints no `customer_id`, so the claim value would read null on every
booted backend. It is re-checked here rather than inherited — but the checking
found the waiver honest.

Three entries are therefore witness-by-design and STAY waived, because their
oracle genuinely lives at another tier rather than being absent:

| fixture | why it is honest |
|---|---|
| `collection-op-shapes` | compile-tier witness; a behavioural block would add uncalled routes and unrecorded goldens for no extra oracle |
| `numeric-operands` | compile + unit witness; its `test` block IS the runtime oracle, and a wire golden would sit inside the un-ruled cross-backend decimal divergence (F11 / M-T5.22) |
| `auth-id-claim` | compile-tier witness (arrived from `main` mid-packet); the mock issuer mints no `customer_id`, so the claim value is not assertable at runtime at all |

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

**Slice 1 is LANDED; slices 2–4 are not started.** This packet ships
incrementally rather than as one PR: slice 1 is the instrument every later slice
depends on, it stands on its own, and holding it back would only let it rot
against a `main` that moves ~100 commits a week.

1. ✅ **Second-tenant principal** in `test/behavioral/cases.mjs` — a distinct
   `tenantId`, carried on a new opt-in `cross-tenant` rung of the authz ladder
   and wired through all seven runner legs.

   **Mutation-proved, and it found something.** Dropping every capability filter
   at the single funnel (`allContextFilterEntries` → `[]`) turns the new
   cross-tenant by-id arm RED (404 expected, 200 got) while its control stays
   green — but `tenancy-owned`'s own `test e2e` block **still passes**. Its
   `items.length` and the `total` written specifically to catch a cross-tenant
   COUNT leak both survive the removal of every tenancy filter in the system,
   because with one tenant seeding the rows an unfiltered read returns exactly
   the same rows. That block was passing vacuously and no assertion expressible
   inside it could have noticed: the missing ingredient is a request made AS
   SOMEBODY ELSE.

   Two limits, both deliberate: the ladder asserts STATUS, so a leaking LIST
   still answers 200 and is the CONTROL rather than the statement (the by-id read
   is where hiding is status-visible); and under OIDC there is no tenancy claim
   to vary, so the rung reports SKIPPED rather than green.

   Still owed by a later slice: the registry-id principal (a claim that IS a
   registry id), which is the half `R.tenantRegistryRow` and `tenancy-hierarchy`
   share and which a static constant cannot supply.
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
