# D-PROJECTION-FOLD — a projection fold means the same thing on every backend, and one plan says what

**Status:** owner ruling, 2026-11-13.

**Decision.** A materialized projection's `on(e: Event) { … }` fold body is
compiled once, by `foldSteps` (`src/ir/plan/projection-fold.ts`), into ordered
steps. Every backend renders those steps and decides nothing about them.

- *The key is immutable.* An assignment to the projection's key field is
  refused (`loom.projection-key-assign`). The row is allocated with the key
  the fold routes by: `e.<key>`, or the handler's `by <expr>`.
- *Sequential.* Each statement reads the row as the statements before it left
  it. Two `+=` on one column both count.
- *Collection `-=` removes every match.* Repeating a removal changes nothing.
  Collection `+=` appends one element.

**Why.** These were order decisions written five times, and the five copies
disagreed: two backends moved the row on a key assignment, two removed every
match while three removed the first, and one built its write from the
pre-fold row so a later statement read a stale value. A fact computed once
cannot disagree with itself.

**Enforced by** `test/system/projection-fold-census.test.ts`: no emitter under
`src/generator/` or `src/platform/` reads a fold handler's raw `statements`
(checked with the TypeScript type checker), and every fold emitter calls
`foldSteps`.
