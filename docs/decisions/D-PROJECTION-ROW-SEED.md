# D-PROJECTION-ROW-SEED — what a fresh projection row starts at

**Status:** owner ruling, 2026-11-13.

**Decision.** When a fold allocates a row for a new key, each non-key column
starts at a value `foldRowSeeds` (`src/ir/plan/projection-fold.ts`) decides:

- a field with a declared default starts at it;
- a required field whose type has a neutral zero starts at it: `0` for an
  int, long, decimal or money, `false`, `""`, the empty list;
- an optional field starts null until a fold writes it.

A required field whose type has no neutral zero (a datetime, a date, an enum,
an id, a value object) and that declares no default is refused
(`loom.projection-field-no-start`, `foldRowUnseeded`): a required column never
starts null. Declare its default, or make it optional. A `+=` or `-=` on an
optional field without a default is refused
(`loom.projection-accumulate-optional`): it has no value to start from.

**Why.** One backend started an unwritten int at `0` and the others at null,
so the same read answered differently. A running total also needs a defined
start. A datetime, enum or id has no value that means "nothing yet", so
inventing one (the current instant, the first member) would read as data, and
starting it null would break the field's own declaration: the model asks the
author to say which.
