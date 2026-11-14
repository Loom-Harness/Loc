# D-AGGREGATE-FUNCTION-PUBLIC — an aggregate `function` is a public, pure query

**Status:** owner ruling, 2026-10-21.

**Decision.** A `function` declared on an aggregate, entity part or value
object is a public, pure query. Workflows and domain services that hold a
loaded aggregate may call it (`t.hasSkill(skill)`), and every backend emits it
public: `public` on node, .NET and Java, an unprefixed method on Python, a
context-facade function on Phoenix. It stays pure (no mutation, no `emit`, no
repository or operation call) and is never an HTTP route.

**Why not refuse the call.** Refusing a workflow's call to an aggregate
function would force callers to duplicate the predicate or to wrap it in an
`operation`, which is a mutating member with its own gates. A pure query on an
already-loaded aggregate leaks no state the caller could not read, so the
public form costs nothing and matches what the emitters already do.
