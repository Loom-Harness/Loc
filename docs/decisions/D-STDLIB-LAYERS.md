# D-STDLIB-LAYERS — irreducible ops are compiler intrinsics kept as registry rows; the prelude is expression-form Loom; `duration` is absolute-only

**Status:** design ruling behind [`stdlib.md`](../stdlib.md)'s Layer 0 / Layer 1
split.

**Decision.** Layer 0 ops are compiler intrinsics, kept as DATA — one row in
`src/util/intrinsics.ts`, not five `render-expr.ts` edits. Layer 1, the ambient
prelude, is ordinary expression-form Loom functions inlined at lowering, so the
backends and the query path only ever see Layer-0 ops. `duration` is an
absolute span; there is no `months(n)`.

**Why.** A Loom expression has dual semantics: it renders as host code AND as a
queryable predicate (finds, views, criteria, filters). A stdlib function
written as a Loom block body could never push down to SQL. `months(n)` was
cut because a calendar month has no fixed width: it forced python-dateutil, a
positional validator gate and five divergent calendar paths, and conflated
absolute duration with calendar offset (java.time's `Duration` vs `Period`).

**Consequence.** Calendar units belong to a separate `period` type if one is
ever added, not to `duration`.
