# D-TPH-BEATS-SHAPE — a TPH concrete's `shape:` never reaches storage

**Status:** PINNED (2026-09-13, wave C2 packet 2e).

**Question.** What does `aggregate Container extends Shipment shape: embedded`
mean when `Shipment` is `inheritanceUsing: sharedTable`? Two header modifiers
each claim to decide where the concrete's row lives, and nothing said which wins
— so each emitter answered on its own, and three of them answered differently.

**What the code already ruled, before anyone wrote it down.** Phase ⑨ decides
what tables EXIST, and `tablesForOneAggregate`
(`src/system/migrations-builder.ts`) tests `isTphConcrete`/`isTphBase` **before**
the shape arms: a TPH concrete gets the shared base table plus RELATIONAL child
tables for its containments, and **no jsonb column anywhere**. The drizzle
schema emitter agrees. So the DDL a `shape: embedded` TPH concrete runs against
has never had a place to put an embedded document, on any backend.

**Decision.** **TPH wins.** A concrete that shares its base's table owns no table
of its own, therefore has nowhere to put a jsonb containment column, therefore
its `shape:` modifier does not apply: containments persist relationally, FK'd to
the shared row. Every backend's schema emitter and repository builder must agree
with the phase-⑨ DDL, which is the single authority on what exists.

This is the same rule `loom.es-tph-forced-own-table` already enforces for the two
shapes that CANNOT degrade — `persistedAs: eventLog` and `shape: document` have
no queryable root row to share, so the validator makes the author write
`inheritanceUsing: ownTable` explicitly. `embedded` is the one shape that *can*
degrade (its root already is a queryable row), which is why it is allowed through
rather than refused.

**Follow-up, deliberately NOT taken here.** A silent degrade is still a silent
degrade: the author wrote `shape: embedded` and got relational children. The
honest alternative is to extend rule 4 of `src/language/validators/inheritance.ts`
so `shape: embedded` under a `sharedTable` base is refused the same way, with the
same "declare `inheritanceUsing: ownTable`" remedy. That is a **language-layer**
change touching every backend's expectations at once (it would also close
pairwise F11 on node by deleting the crossing), so it belongs to the packet that
owns `src/ir/**` + `src/language/**` — wave **C2 packet 2f** — not to a
per-backend packet. Until it is taken, the degrade is at least *coherent*: every
target does the same thing, and the same thing is what the DDL creates.

**Consequences.** Pairwise **F13** closes as a python conformance fix (the schema
emitter's TPH arms move ahead of the shape arms; a TPH concrete takes the
relational repository builder). Pairwise **F11** on node is re-read the same way:
the drizzle repository must target the owner table, not the concrete's own. The
crossing enters the curated corpus with `tph-crossings.ddd`, whose header names
the embedded half as the widening step once F11 closes.

**Superseded in part at the wave fold (2026-09-13).** The follow-up this entry declined to take was taken in the same wave by packet 2c as [`D-EMBEDDED-TPH`](D-EMBEDDED-TPH.md): `shape: embedded` under a `sharedTable` base is now REFUSED at phase ④ (`loom.es-tph-forced-own-table`), so the crossing this entry ruled on is unreachable from `.ddd` and there is no degrade left to be coherent about. What survives of this entry is its floor: the python schema emitter and repository builder test the TPH arms before the shape arms, mirroring `migrations-builder.ts`, so a TPH concrete can never again be handed a table phase ⑨ does not create. The python gate that drove the crossing (`tph-embedded-storage.test.ts`) was deleted at the fold because its fixture no longer validates; the ordering is pinned by the phase-④ refusal plus the migrations builder's own arm order, and the coordinator recorded the trade in `[docs/new-plan/waves/wave-c2.md](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/waves/wave-c2.md)`.

**Sources.** `src/system/migrations-builder.ts` `tablesForOneAggregate`;
`src/ir/util/inheritance.ts` `tableOwnerName`;
`src/language/validators/inheritance.ts` rule 4;
[`inheritance.md`](../inheritance.md);
[`docs/audits/pairwise-corpus-findings-2026-08.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/audits/pairwise-corpus-findings-2026-08.md) §F11/§F13.
