# D-EMBEDDED-TPH — a `shape: embedded` concrete of a `sharedTable` base is forced to `ownTable`, like the other two non-relational shapes

**Status:** applied — the proposed default took effect 2026-09-16 (merged to `main` 2026-09-14 in #2907; no override recorded by 2026-09-28; flipped by Wave C5 packet 5.0).

**Question.** `shape: embedded` × TPH (`inheritanceUsing: sharedTable`) does not
work on any backend that implements `embedded`. Is that a cross-emitter mission,
or does the language refuse the crossing the way it already refuses the other two
non-relational shapes under a shared table?

**Options.** (a) build it — the TPH owner table grows one nullable jsonb column
per embedded concrete's containment, on node (drizzle + mikroorm), python and
.NET, plus the matching phase-⑨ DDL; (b) extend Rule 4's `forcesOwn` set with
`embedded`, so the author declares `inheritanceUsing: ownTable` exactly as an
event-sourced or document concrete must; (c) leave it — a recorded compile
waiver per backend.

**Decision.** (b).

**Rationale.**

- **The rule already exists and already covers the neighbours.** `persistedAs:
  eventLog` and `shape: document` are forced to `ownTable` by
  `loom.es-tph-forced-own-table` (`src/language/validators/inheritance.ts`
  Rule 4, D-ES-TPH) for the same underlying reason: their truth is not a row in
  a shared table. `embedded` is the third non-relational shape and was simply
  missed — (b) adds one disjunct to a set, one word to a message and nothing to
  the surface. (a) adds a per-backend feature nobody has asked for.
- **What (c) was actually recording, measured.** On node, the drizzle embedded
  repository named `schema.things` while a TPH concrete's row lives in
  `schema.thingBases` (19 × TS2339 per case, compile waiver **F11**; MikroORM
  had the same defect one name over, `ThingRow` vs `ThingBaseRow`) — and the
  schema emitter did not put the jsonb containment column on the owner table
  either: it emitted a relational `lines` CHILD TABLE, so re-pointing the
  repository would have moved the error rather than removed it. Python emits
  BOTH tables (**F13**); .NET maps no containment at all. Three backends, three
  different wrong answers, and the phase-⑨ migration DDL mirrors the schema
  emitter's mistake on all of them.
- **(a) is a four-file change per backend for a shape with no demand.** Two
  emitters and the phase-⑨ DDL on each of node/python/.NET, held together by a
  drizzle-schema-vs-migration agreement nothing currently gates. The crossing
  came from the pairwise MATRIX, not from a user: it is a cell the generator
  enumerates, not a shape anyone wrote.
- **The forced form is not a downgrade.** `embedded × ownTable` compiles and runs
  on both node adapters today (verified: `tsc --noEmit` clean on the generated
  project for drizzle and mikroorm), and it is what the author wanted anyway —
  an aggregate whose containments fold into ITS row needs a row of its own.

**Consequences.** `loom.es-tph-forced-own-table` gains `shape: embedded`; its
message names the shape rather than only the event-sourced arm. `COMPILE_WAIVERS`
entry **F11** is deleted (the crossing can no longer be written), and the pairwise
composer writes the forced override for `embedded` as it already does for
`document` / `eventLog`, so the cover reaches `embedded × ownTable` instead of
spending its TPH cells on a validator floor. The python twin **F13** loses its
source the same way — 2e deletes its own entry. M-T2.10's "`embedded` on Drizzle
still emits relationally" clause is resolved by the same measurement: it emits
jsonb correctly, and emitted relationally ONLY under TPH.

**Reversible.** If a real model ever needs the crossing, (a) is unblocked by
deleting one disjunct — nothing here bakes the refusal into an emitter.

**Sources.** `test/pairwise/waivers-compile.ts` F11 (and F13);
[`targets-completeness-2026-08-30.ledger.json`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/audits/targets-completeness-2026-08-30.ledger.json);
[`T2-data-evolution.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/T2-data-evolution.md) M-T2.10;
[`inheritance.md`](../inheritance.md); D-ES-TPH (the rule this extends).
