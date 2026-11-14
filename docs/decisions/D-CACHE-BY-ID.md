# D-CACHE-BY-ID — the cache resource caches the by-id read's wire answer, keyed by scope

**Status:** PINNED (owner rulings 2026-11-02).

**Question.** What does `kind: cache` cache, and how does a cached read keep
the read scopes (tenancy, policy, masks, soft delete) a database read applies?

**Decision.**
- **The by-id read only** (`GET /{id}`). Lists, finds and paged reads go to the
  database.
- **The cached value is the read's wire answer, and the scope goes in the
  key.** The entry holds one answer per scope fingerprint — every principal
  member the read scope, the policy rungs and the masks read, the operating
  tenant among them — and the read stance (which restrictions apply, which
  fields are masked) is hashed into the prefix. Restricting the cache to
  unscoped aggregates and re-checking scope after a hit were both rejected.
- **Every repository `save` / `delete` evicts the id's whole entry.**
- **A store failure never fails the request.** A read falls back to the
  database; a failed write or eviction is logged (`cache_unavailable`) and the
  entry expires at its ttl.
- `src/ir/plan/cache.ts` is the one decision; backends render it, and
  `test/system/cache-plan-census.test.ts` forbids a backend from composing a
  key or an eviction set itself.

**Consequence.** An aggregate whose answer depends on other rows (an `exists`
row rule, a referenced row) cannot be keyed by principal inputs alone, so it is
read from the database and `loom.cache-read-uncached` says so; event-sourced
aggregates and inheritance hierarchies are read from the database the same way.

**Proof.** `test/fixtures/corpus/cache-by-id.ddd`: hits, eviction on update,
operation, workflow, soft delete and delete, and isolation across tenant, mask
role and the `own` rung, on every backend.
