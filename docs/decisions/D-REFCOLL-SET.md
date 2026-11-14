# D-REFCOLL-SET — `X id[]` is a set: membership only, no stored order, no ordinal on the join table

**Status:** owner ruling ("ordered `X id[]`" is a non-feature).

**Decision.** An `X id[]` reference collection is contractually a SET. Its
association join table is just its key `(owner_fk, target_fk)`, the whole-row
composite primary key, so inserts are idempotent; it carries no payload
column (`tableForAssociation` in `src/system/migrations-builder.ts`).

**Why.** Order is a read-time projection, not a storage property. When the
domain needs a position, it declares one — an explicit ordering field, or a
child entity with a rank — and sorts the read.

**Consequence.** Value-object collections are different and keep
`(parentFk, ordinal)`, because the ordinal is part of their key. Do not add an
ordinal to the association table "for determinism".
