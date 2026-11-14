# D-RENAME — aggregate-inheritance layout modifier

**Status:** PINNED.

**Decision.** Inheritance table layout is a **header colon modifier**
`inheritanceUsing: sharedTable|ownTable` (was the body clause
`inheritanceStrategy: shareTable | ownTable`). Amended by
D-DOCUMENT-AXIS §4 — all aggregate config moves to the header;
nothing in the body. (Drafted as the paren call
`inheritanceUsing(ownTable)`; recolonized by M-T5.17 phase 2 — the
paren form no longer parses.) Values stay **table-baked**, spelled
`sharedTable | ownTable` (refines the earlier `shareTable`, reads as
"shared table"); the medium-neutral `shared | own` spelling is
rejected (the choice is specifically about table layout, and naming it
so keeps it honest when document/JSON saving enters via `shape`).

**Validator rules implied.**

- `inheritanceUsing: …` is only valid on an aggregate that participates
  in inheritance (`abstract` base or `extends` subtype).
- `sharedTable` = TPH (single table + discriminator column);
  `ownTable` = TPC/TPT (table per concrete). The exact TPC-vs-TPT
  choice is a backend detail, not surfaced in the modifier.

**Affects.** `aggregate-inheritance.md` (its `storage: shared|own`
clause is this modifier); `document-and-json-hierarchies.md` §4a (same
header line). Interacts with D-ES-TPH below.
