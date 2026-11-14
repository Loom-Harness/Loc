# D-PERSISTENCE-PER-BACKEND — persistence emission stays per-backend; only the seed spine and the existing substrate are shared

**Status:** concluded design audit (all five backends).

**Decision.** The shared persistence layer is the seed spine
(`src/generator/_persistence/seed-datasets.ts`) plus the substrate that was
already shared: `MigrationsIR`, `wireShape`, the Postgres renderer
(`src/generator/sql-pg.ts`), `ExprTarget`, the intrinsic keys and the
deny/deep stance detection. Entities, schema, repositories, events, ids, enums,
value objects and the find-where / capability-filter predicate lowering stay
per-backend.

**Why.** Each ORM composes differently — Drizzle combinators with role-split
operands, SQLAlchemy operator overloads, EF fluent configuration, JPA
annotations, Ecto changesets. "Regular-shaped" (a parallel decision tree per
backend) is strictly weaker than "byte-identical-extractable" (one shared
composition API), and only the latter pays for a seam. The write path is a hard
wall. A shared query target is a cost/benefit decline, not an impossibility: a
callback-returning target could unify the predicate walk, but .NET and Elixir
already lower through `ExprTarget`, so it would net three backends.

**Consequence.** A proposed seam is net-negative when it is a ~10-method
interface over mostly divergent arms; a contract method with one use folds back
into the leaf table.
