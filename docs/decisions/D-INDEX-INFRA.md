# D-INDEX-INFRA — manual performance indexes live on the storage binding, not the aggregate

**Status:** PINNED.

**Problem.** Domain uniqueness is a `unique (...)` invariant on the aggregate, but
a plain **performance** index (speed up a frequent filter) has no domain meaning —
putting it on the aggregate conflates infrastructure with the model.

**Decision.** A performance index is declared on the `resource` binding via
`index: [Entity.col, Entity.(a, b)]` (grammar `IndexSpec`). It is **pure
infrastructure** and always **non-unique** (uniqueness stays the domain
invariant). The target entity is named **explicitly** (`Project.name`), never
inferred from which table owns the column — the binding knows the context's shape,
and the entity may be an aggregate *or* a contained part. Lowers to `manualIndexes`
in the IR and lands as `CREATE INDEX` in the derived migration.

**Affects.** `uniqueness-and-indexes.md` §3.2 (canonical); `../resources.md`
(surface); `../migrations.md`.
