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
- **Every repository `save` / `delete` evicts the id's whole entry**, in every
  process that writes the context: a deployable that hosts a cached context on
  the database the cache is filled from must list the cache resource
  (`loom.cache-writer-not-evicting`), and an `inMemory` cache, which is per
  process, is listed by one deployable only (`loom.cache-in-memory-shared`).
  Refusing these topologies was preferred to evicting from deployables that do
  not list the cache, which would hand them a store connection their model
  never asked for and still could not reach another process's memory.  A deployable that lists an `inMemory` cache runs as one instance: the Helm
  chart refuses `replicas` above 1 for it.  The raw `k8s/` manifests pin one
  replica and the dev compose runs one container per service; scaling those
  by hand is outside what the generator checks, and keeping them at one
  instance is the operator's responsibility.
- **One stored envelope on every backend.** An entry is a JSON object from
  scope fingerprint to `{body: <wire JSON text>, etag: <tag> | null}`, so
  backends sharing a redis read each other's entries.  An entry or answer a
  backend cannot read is a miss that the next write replaces — never an error.
- **An `inMemory` store is bounded**, the same way everywhere: at most a fixed
  number of entries; a write to a full store drops the expired ones and is
  skipped if it is still full.  No timer.
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

**Proof.** `test/fixtures/corpus/cache-by-id.ddd` (`inMemory`) and its redis
twin `cache-by-id-redis.ddd` (on the valkey sidecar): hits, eviction on update,
operation, workflow, soft delete and delete, and isolation across tenant, mask
role and the `own` rung, on every backend.  The twin's `effects.cache` golden
records the entries each backend stored, so every backend is held to the one
envelope.  `test/system/cache-plan-census.test.ts` forbids a backend from
spelling the envelope or the `inMemory` bound itself.
`test/ir/validate/cache-topology.test.ts` holds the two topology refusals and
shows the fix each message names clears it.  The Helm chart's single-replica
guard for an `inMemory` cache is review-tier: `test/system/kubernetes-helm.test.ts`
pins the guard's text in the rendered template, and a reviewer of a change to
the chart's deployment template checks that the guard still refuses `replicas`
above 1 when `helm template` evaluates it; no booted `helm template` render
gates it.

**Enforced by:** `test/fixtures/corpus/cache-by-id.ddd`, `test/fixtures/corpus/cache-by-id-redis.ddd`, `test/system/cache-plan-census.test.ts`, `test/ir/validate/cache-topology.test.ts`, `test/system/kubernetes-helm.test.ts`
