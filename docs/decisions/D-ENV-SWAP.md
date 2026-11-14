# D-ENV-SWAP — per-environment storage swap mechanism

**Status:** DECIDED (owner ruling 2026-10-21) — option ①, no new grammar; option ② is declined.

**Context.** Storage proposal §2.1 invariant 5: *"Storage is
swappable per deployable."* The test deployable swaps Postgres for
in-memory without the domain noticing. Two shapes were considered:

- **Option ①** — alternate dataSources per environment, deployable
  picks: `dataSource ordersStateTest { … use: memTest }` listed in
  `deployable apiTest { dataSources: [ordersStateTest, …] }`.
  Verbose if many context × kind combinations, but needs no new
  grammar.
- **Option ②** — deployable `overrides { storage pg { type:
  inMemory } }` block (existing storage proposal §3.8). Terse;
  preserves one dataSource set across environments.

**Decision.** Option ①: a per-environment deployable lists its own
alternate dataSources, with no new grammar beyond what D-STORAGE-SPLIT
landed. Option ② (`overrides { storage … }`) is declined.

**Affects.** Storage proposal §3.8 (`overrides`) does not land.
