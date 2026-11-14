# D-LIFECYCLE-SHAPE — POST for every bodied lifecycle action, DELETE only for canonical destroy; three keywords; bodies never call persistence

**Status:** design ruling behind the shipped `create` / `operation` /
`destroy` surface (the URL half is D-LIFECYCLE-VERB / D-URLSTYLE).

**Decision.**
- No lifecycle route uses PATCH. The canonical edit is `operation update(…)` →
  `POST /<plural>/{id}/update`, routed like any other operation.
- Three keywords: `operation`, `create`, `destroy`. `destroy`, not `delete`,
  because it says nothing about hard vs soft removal and so composes with
  `softDeletable`.
- No generic `action`/`run`/`call` kind for non-mutating work, and no
  per-operation `route:` alias.
- Lifecycle bodies never call persistence: the framework picks
  INSERT/UPDATE/DELETE from the kind.

**Why.** One HTTP shape per action and no PATCH-vs-POST branch in the
generator. One keyword with a kind modifier (`operation update cancel()`)
reads as a contradiction, and three keywords that replace `operation` would
break every model. A non-mutating "action" is always really a mutation with a
marker, a read (find/projection) or a workflow, and an escape hatch gets
abused. A `route:` alias puts HTTP into the domain layer; URL shape belongs to
the api-level `urlStyle`. Persistence-free bodies keep one body
platform-neutral across all five backends.

**Consequence.** Re-open any of these only on purpose.
