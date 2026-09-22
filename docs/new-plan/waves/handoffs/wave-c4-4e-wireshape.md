# Wave C4 · packet 4e — M-T5.10's `wireShape` retirement: measured, declined, re-scoped

Branch `claude/c4-wireshape`, base `21af4ecc8` (coordinator head with 4a + 4c folded).
Plan row: [`../wave-c4.md`](../wave-c4.md) §Packets, "4e M-T5.10 `wireShape` retirement — measure, then build or decline".

**Verdict: DECLINE the retirement, INVERT it.** Proposal steps 6–7 already
shipped; the thing the spin-off called an XL refactor is a stale count, and the
direction it points in would widen a live defect. The measurement is recorded as
[`D-WIRESHAPE-KEEP`](../../../decisions.md) (proposed, 48-hour default) and
**M-T5.39** (open, L, P1); M-T5.10 stays `partial` with exactly one remaining
item. One in-fence slice was built — the last dead reader of the retired stamp.

---

## 1. The finding that changes the packet — steps 6 and 7 are shipped

The mission's spun-off item reads "the `wireShape` retirement (proposal steps
6–8) — 179 refs / 49+45 files, XL". On the merged tree:

| proposal step | state | evidence |
|---|---|---|
| 6 — delete the phase-⑥ stamp + `wireShapeFor` | **shipped** | #1920 (Phase 1) + #1937 (Phase 2, `5a00804a0`). `AggregateIR` / `EntityPartIR` / `ValueObjectIR` carry no `wireShape`; `EnrichedEntityPartIR` and `EnrichedValueObjectIR` alias their base types (`src/ir/types/loom-ir.ts:2108-2110`); `wireShapeFor` does not exist. |
| 7 — union bundles off the stamp | **shipped in effect** | #1937 moved `src/generator/_payload/union-wire.ts` onto `wireFieldsFor*`. Its LETTER ("response-contract-keyed bundles") is unfulfilled and is now blocked by the same facts as §3 below. |
| 8 — retire `.loom/wire-spec.json` | **declined here** | #1937 deliberately took the proposal's *option 3* (keep the artefact, derive it from `wireFieldsFor`). `src/system/wire-spec.ts:351` still reads it and the conformance-parity tier parses it. |

So the 179 `wireShape` matches in `src/` are **not** readers of a denormalised
IR field. They are call sites of the pure recompute helpers in
`src/ir/enrich/wire-projection.ts` plus the *different* field
`ProjectionIR.wireShape` (28 property reads, a read-model row shape with no
contract-record counterpart — it stays) and comment prose. Recomputing on demand
is what CLAUDE.md's "derive, don't stamp" asks for; there is nothing left to
retire on that axis.

## 2. Consumer census — 207 call sites / 66 files

Call sites only (imports, re-exports and comments excluded) of the
`wire-projection.ts` surface: the three `wireFieldsFor*` walks + `wireFieldsFor`,
the five access filters, the create-input helpers and `wireTypeForField`.
Instrument: `node scripts/…` equivalent kept in the packet scratchpad; the
committed durable half is `test/system/wire-contract-divergence.test.ts`.

| consumer family | refs | files | replaceable by a declared `<Agg>Response` / `command` / `query` record? |
|---|---:|---:|---|
| `src/ir/enrich/**` (the pass itself) | 32 | 2 | **n/a** — this IS the projection. It would become a scaffold-time helper, not disappear (the proposal says so). |
| backend: elixir | 31 | 11 | **partly.** The response-DTO/OpenApiSpex half already reads the record (PR6). The rest — changeset, Ecto struct, `to_wire` serializer, event-sourced struct, audit history — is the PERSISTED/serialised shape, which no record describes. |
| backend: java | 29 | 11 | same split (PR5): `emit/dto.ts` + `openapi-customizer.ts` read the record; entity/repository/service/validator/tests read the wire walk. |
| backend: hono/node | 18 | 6 | same split (PR3). `repository-wire-builder.ts` (`toWire`) is the one that must NOT move — it is the serializer the record is supposed to describe. |
| backend: dotnet | 17 | 8 | same split (PR2). |
| backend: python | 17 | 6 | same split (PR4). |
| frontend: angular | 14 | 2 | **no record exists** — a frontend reads the wire, and no `<Agg>Response` is emitted into any shipping model (§3). |
| `generator/_frontend` (shared zod / page objects / api module) | 7 | 3 | **no** — same reason; also `createInputFields`, which is the CREATE side, described by a `command` record only under the macro. |
| frontend: feliz | 7 | 1 | no |
| frontend: flutter | 6 | 2 | no |
| `src/ir/validate/**` | 6 | 2 | **no** — an IR check must hold for models that declare no records at all. |
| `src/system/wire-spec.ts` | 5 | 1 | **no** — the proposal's own "smallest clean edge" candidate, and the one §3 kills outright. |
| `generator/_payload/union-wire.ts` | 4 | 1 | step 7's target; blocked by §3. |
| `src/ir/util/**` (audit-history, sortable-fields, verify-ir) | 4 | 3 | no |
| `generator/_walker/primitives/forms.ts` | 3 | 1 | already correct per the proposal (reads `op.params`), the `createInputFields` call is the create shape. |
| `web/src/builder/system/model.ts` (playground) | 2 | 1 | no |
| svelte / `_persistence` / `construction-default` / `_i18n` / `src/api` | 5 | 5 | no |
| **total** | **207** | **66** | — |

Read across the rows: the only families where a record EXISTS to read are the
five backend response-DTO emitters, and they **already read it** (PR2–PR7, the
work M-T5.10 recorded as landed). Every remaining family is either the
serialised/persisted shape (which no record describes), a frontend, or an
IR-level check that must work with no records present. There is no untouched
"smallest consumer family with a clean edge" left.

## 3. Can enrichment rebuild the same shape from the records? Two measured noes

**(a) For every shipping model there is no record to rebuild from.**
`with scaffoldHandlers` is the only thing that splices contract records
(`src/macros/stdlib/scaffold/_contracts-shared.ts` `contractRecords`), and
exactly **five** tracked `.ddd` files use it — `test/e2e/fixtures/{ts,dotnet,java,python}-build/scaffold-handlers.ddd`
and `elixir-vanilla-build/vanilla-scaffold-handlers.ddd`, the per-backend compile
gates PR7 added. All 79 corpus fixtures, every `examples/*.ddd` and every
playground example use `api X from Subdomain`. Measured: **0 of 117 corpus
aggregates, 0 parts and 0 value objects carry a `<Agg>Response`** (and
`examples/acme.ddd`, the fixture the baseline tree is captured from, likewise:
3 aggregates / 1 part / 1 value object, 0 records). Any
"re-derivation from the records" is therefore gated on proposal **step 4** —
rewriting the implicit `api … from …` derivation to expand through the scaffold
— which is unbuilt.

**(b) Where records do exist, the two shapes disagree — 25 of 126 nodes.**
Injecting `with scaffoldHandlers` into every corpus fixture materialises the
records for all 79 (they all still validate clean), giving 126 contracted nodes:

| class | rows | difference | live defect today |
|---|---:|---|---|
| **A1** capability-injected fields | 7 | `softDeletable`'s `deletedAt`, `auditable`'s `createdAt`/`updatedAt`, `tenantRegistry`'s `parent`/`dataKey` are in the derived walk, absent from the record | **yes** |
| **A2** inherited base fields | 8 | enrichment merges the `extends` chain into the concrete; the record's AST-level walk does not | **yes** |
| **B3** `provenanced<T>` | 1 | `wireTypeForField` wraps the carrier for the wire; the record declares bare `T` | **yes** |
| **B1** containment element type | 7 | record names `<Part>Response`, derived names the raw part | no — a declared offset (`isResponsePayloadName` un-suffixes) |
| **B2** optional containment | 1 | `optional<MemoResponse>` in the type vs `Memo` + the `optional` flag | no — representation |
| **C** field ORDER | 1 | `versioned`'s `version` is a property (before containments) derived, appended after in the record | **yes on positional DTOs** (.NET/Java/F# records) |

The per-row list, with the class comments, is the `BASELINE` in
`test/system/wire-contract-divergence.test.ts`. `UNCONTRACTED` pins the one node
the scaffold mints no record for at all (`part-rules-private-op.ddd`
`Billing.Invoice.Line`, reachable only through a private operation's rules) —
the census's blind spot, pinned so it cannot grow and shrink the count without
anything being fixed.

**A1/A2/B3 are live emission defects, not IR curiosities.** PR2–PR7 pointed
every backend's response-DTO and schema emitter at the record while the
repository serializer kept reading the derived shape. Generated on `node` from
a `with scaffoldHandlers` context:

```
aggregate Order with softDeletable { code: string  status: string = "new"  create(code: string) { code := code } }
```
```ts
// api/db/repositories/order-repository.ts:105
toWire(root: Order): unknown { return { id: …, code: …, status: …, deletedAt: …, version: root.version }; }
// api/http/order.routes.ts:30   ← no `deletedAt`
export const OrderResponse = z.object({ id: z.string(), code: z.string(), status: z.string(), version: z.number().int() });
// api/http/order.routes.ts:136
return c.json(repo.toWire(found) as z.infer<typeof OrderResponse>, 200);
```

The cast is why `tsc` never sees it: the response carries a field its own
OpenAPI schema does not declare. `aggregate Customer extends Party` is worse —
`CustomerResponse` is `{id, tier, version}` against a `toWire` of
`{id, name, email, tier, version}`, so **every inherited field is missing from
the schema** and from any client generated off it.

**And the failure mode differs per backend, which makes A2 worse than a schema
mismatch.** The same `.ddd` on `platform: java`:

```java
// api/.../features/customers/CustomerResponse.java
public record CustomerResponse(UUID id, String tier, int version) {
    public static CustomerResponse from(Customer value) {
        return new CustomerResponse(value.id().value(), value.tier(), value.version());
    }
}
```

The record-based backends do not merely mis-declare the shape — the projection
mapper is generated FROM the record, so `name` and `email` are **never
serialised at all**. On node the data is on the wire and the schema understates
it; on java (and by the same construction .NET) the API silently truncates the
response. Both are wrong, and only one of them is visible by reading the JSON.

Why seven PRs missed it: no `.ddd` anywhere combines `scaffoldHandlers` with a
capability or an `extends`. The five compile fixtures are minimal by design, so
they compile and prove nothing about these shapes.

## 4. Slice 1 — declined as specified, and what was built instead

The packet's slice 1 is "one consumer family moved onto the contract records,
byte-identical". It cannot be built:

- `src/system/wire-spec.ts` (the named candidate) would emit an EMPTY or absent
  schema for 100 % of shipping models (§3a), and a different schema for 25 of
  126 nodes under the macro (§3b). Not byte-identical by a wide margin.
- Any backend DTO emitter is already on the records — moving a *second* family
  (serializer, frontend zod, union bundle) would spread A1/A2/B3 rather than
  remove them.
- A "read the record when present, recompute otherwise" fallback keeps both
  paths and adds the divergence as a silent runtime fork. That is the shape of
  the defect, not a fix for it.

**Built instead (in fence, `src/generator/**`), one hunk:** the last reader of
the retired stamp. `declaredValueObject` in
`src/generator/_walker/walker-core.ts:2203` hand-declared a return type carrying
`wireShape?` and cast every value object through `as never` to satisfy it; the
VO-construction site at `:1939` then read
`vo.wireShape?.map(…) ?? vo.fields.map(…)`. No `ValueObjectIR` has carried a
`wireShape` since #1937, so the first arm was dead. Both are gone; the call site
reads `vo.fields` with the reason it is the right source (positional arguments
bind to the CONSTRUCTOR's order, and a VO's `derived` members — which the wire
shape appends — are computed, never constructible, so the wire-shape arm would
have bound argument 3 to a derived name had it ever fired).

## 5. Byte-identical statement

`scripts/capture-corpus-snapshot.mjs`, before and after the `src/` hunk:
**BYTE-IDENTICAL — 395 cells, 26,534 emitted files, 0 non-generating, no
emitted file differs.**

**That result is vacuous for this hunk, and the packet says so rather than
resting on it.** Instrumenting the built `walker-core.js` at the site and
re-running the whole capture gives **0 hits**: the corpus never constructs a
value object in a page body. The load-bearing evidence is a targeted probe
(`Text(Money(9.99, "USD").currency)` in a react page):

- the site is reached **twice**, and `typeof vo.wireShape` is `undefined` on
  both — the branch was dead, not merely untaken;
- generating that probe with the PRE-fix expression and with the post-fix one
  gives **identical output across all 72 files**.

(Mutation/instrumentation reverted by file copy from a backup, never
`git checkout --`, per CLAUDE.md §mutation-prove.)

## 6. Mutation proofs for the new gate

`test/system/wire-contract-divergence.test.ts`, three mutations, each reverted
by file copy:

| mutation | failing assertion | rows |
|---|---|---|
| drop `derived` from `wireFieldsForAggregate` (a seeded defect in the derived walk) | `new wire/contract divergence — the scaffolded response DTO now describes a different shape than the serializer emits` | 12 novel nodes |
| delete the `stamps.ddd Shop.Order` baseline row | same assertion | 1 node |
| add a phantom baseline row (`core-domain.ddd Orders.NotAThing`) | `these nodes no longer diverge — delete their BASELINE rows (the ratchet only shrinks)` | 1 |

The first mutation also **found a flaw in the gate's own reporting**: the
classifier labelled "the record has fields the wire does not" as
`missing-in-record`, the exact opposite direction. It now reports by direction
and `extra-in-record` is a distinct class — a green first run would have hidden
that.

## 7. Gates on the merged tree

| gate | result |
|---|---|
| `npx tsc -b` | clean |
| `node scripts/test-typecheck.mjs` | ratchet **OK — 181 files, 469 errors, `src/` clean** (unchanged; the new suite is at 0 after fixing its two TS2345s rather than baselining them) |
| `npm run lint` (`biome ci .`) | 3285 files, 0 errors |
| corpus byte-identical | 395 cells / 26,534 files, identical (see §5 for why the probe carries the proof) |
| `node scripts/mission-counts.mjs --check` | up to date (regenerated with `--write` after minting M-T5.39) |
| `node scripts/ledger-counts.mjs --check` | `.md` matches the JSON |
| `node docs/build.mjs` | 0 errors |
| `test/system/unsupported-register.test.ts` | 9 passed (the mission-id check that guards a newly minted `## M-T5.x`) |
| full `npm test` | **2167 files passed / 1 failed, 25 997 tests passed / 2 failed, `NPM_TEST_EXIT=1`** — the one failing file is INHERITED, not this packet's; see below |

**The one red file is a 4c×`main` collision, reproduced on the base and handed
back.** `test/system/diagnostic-code-coverage.test.ts` fails twice:

```
src/language/validators now has 0 codeless site(s), below the pinned baseline of 122.
Lower BASELINE to 0 in this PR — a stale baseline is how a ratchet stops ratcheting.
  expected +0 to be 122
… > finds the whole population (guards the scanner): expected false to be true
```

That ratchet landed on `main` (`f1adfdaa3`, "122 of 320 AST-layer sites escape
all three diagnostic gates"). Packet **4c** then drained
`src/language/validators` to **0** codeless sites in the tree this packet is
based on (`21af4ecc8`) without lowering the baseline — which is exactly the
failure mode the assertion's own message names. Both assertions read only
`src/language/validators/**` and that test file, and this branch's whole diff
against the base is `docs/decisions.md`,
`docs/new-plan/{README.md,T5-language-core.md}`, the hand-off,
`src/generator/_walker/walker-core.ts` and
`test/system/wire-contract-divergence.test.ts` — none of them an input to it.
The failure is therefore present at the base and unaffected by this packet.

**Fix (4c's fence, deliberately NOT taken here):** lower `BASELINE` to `0` in
`test/system/diagnostic-code-coverage.test.ts` and drop (or invert) the
`all.some((s) => !s.coded)` population guard, which can no longer hold once the
drain reaches zero — a scanner guard written to assume the ratchet never
finishes. Left to 4c / the coordinator because that file is 4c's fence and it
may be mid-flight; naming it here so the fold does not discover it as a
mystery red.

## 8. Open-PR overlaps — cited, not duplicated

`list_pull_requests` (open, drafts included, 2026-09-22):

- **#2947** (optional part field / unconstructible `managed` field), **#2918**
  (collection create-input), **#2983** (frontend `Request` collision) — all
  named by the packet brief as touching the enrich/DTO area. None touches
  `wire-projection.ts`, `wire-spec.ts` or the walker hunk; left alone. #2947's
  `managed`-field row and #2918's collection create-input row are both on the
  CREATE side of `wire-projection.ts` and are adjacent to, but not part of,
  M-T5.39's read-side census.
- **#2942** (page emitter fails open) edits
  `src/generator/_walker/walker-core.ts` at ~line 1790. This packet's hunk is at
  lines 1939 and 2203–2214 of the same file — **named here per the shared-file
  rule**; the two hunks are disjoint and merge clean.
- **4d sibling** (`claude/c4-callable`) edits the grammar and `src/ir/lower/**`;
  this packet touched neither.

## 9. Hand-offs and decisions wanted

**H1 — M-T5.39 is the drain, and it is a `src/macros/**` packet, outside this
fence.** The four fixes (A1 macro ordering in `apiReadFields`, A2 the
`extends`-chain walk at record-build time, B3 the `provenanced` carrier wrap, C
the walk order) all live in `src/macros/api/factories.ts` +
`src/macros/stdlib/scaffold/_contracts-shared.ts`. The recipe, the ordering and
the reproduction are in the mission body. **Each fix deletes its rows from the
census baseline in the same PR.**

**H2 — add the missing fixture first.** No `.ddd` combines `scaffoldHandlers`
with a capability-bearing or inheriting aggregate. Adding one to
`test/e2e/fixtures/*-build/scaffold-handlers.ddd` (a `with softDeletable`
aggregate and an `extends` pair) makes A1/A2 fail the existing per-backend
compile/round-trip gates instead of hiding behind a cast. This is the cheapest
single action in the whole area and it is NOT in 4e's fence.

**D1 — decision wanted from the owner: `D-WIRESHAPE-KEEP`.** Proposed with the
48-hour default. It declines proposal step 8 outright (`.loom/wire-spec.json`
stays, deriving from `wireFieldsFor` as #1937 built it) and states two
conditions for re-opening the retirement. If the owner would rather keep step 8
live, the entry needs overriding before the default applies — but note that
option 1+2 ("contract source is the diffable artefact") rests on the records
existing, and §3a measures them at 0 %.

**D2 — decision recorded, not asked: M-T5.10 stays `partial`.** Its spun-off
item is closed (into M-T5.39 + D-WIRESHAPE-KEEP), but the line also carried
"Extern handler LSP/scaffold polish is a separate tail", which nothing else in
`docs/new-plan/` tracks. Flipping the mission to `done` would have dropped it,
so the mission now names that tail as the one remaining item. If the owner
considers that tail dead, M-T5.10 moves to `archive/T5-done.md` in one edit.

**H3 — `test/system/diagnostic-code-coverage.test.ts` is red on the folded tree
and it is 4c's row.** Full detail and the one-line fix in §7. It is red at the
base commit, before any of this packet's commits, so whoever folds 4e should not
read it as a 4e regression — but the wave cannot exit with it red, and the
`tests passed` check on the wave PR will fail until the baseline is lowered.

**N1 — noted in passing, not acted on (4f's fence), with the exact site.**
`src/ir/validate/checks/structural-checks.ts` reports as a **binary file** to
`grep`. Measured: exactly **one** NUL byte, at byte offset 63218 — line 1426,
`const key = ` + "`" + `${location}<NUL>${resourceName}.${verb}` + "`" + `;`. It is a deliberate
composite-key separator, but written as a RAW NUL byte in the source instead of
the `\0` escape. The fix is one character-class change (`\0` or `\u0000` in the
template) with no behaviour change at all — the runtime string is identical.

Why it matters beyond tidiness: a single raw NUL makes `grep` treat the whole
file as binary, so the file silently **drops out of every `grep`-based census in
the repo**, including this packet's first consumer sweep (it surfaced as a
`grep: … binary file matches` line, not as a row). That is M-T9.53's row
("NUL bytes + the repo-wide check") in packet 4f; handed over with the site
located so the repo-wide check has a known first positive to prove itself
against.
