# D-ES-TPH — event-sourced concrete subtype of a TPH abstract

**Status:** PINNED.

**Decision.** A `persistedAs: eventLog` concrete subtype of a
`sharedTable` (TPH) abstract base is **forced to
`inheritanceUsing: ownTable`** — an event-sourced stream cannot share a
state table with its siblings. Generalises across `shape` per
D-DOCUMENT-AXIS: a `shape: document` (document) concrete of a
`sharedTable` base is likewise forced to `ownTable`. The validator
raises an error (not a silent coercion) so the author writes the
forced modifier explicitly.

**Extended by D-EMBEDDED-TPH** (wave C2): `shape: embedded` joins the
forced set — the third non-relational shape, missed when this rule was
generalised, and the one compile waivers F11 / F13 were recording.

**Affects.** `aggregate-inheritance.md`; the persistence adapter's
table-layout resolution.
