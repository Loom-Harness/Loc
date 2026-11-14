# D-INHERITED-CAPABILITIES — a capability on an abstract base applies to every subtype

**Status:** PINNED (owner ruling 2026-10-25, epic #3954).

**Question.** `abstract aggregate Vehicle with softDeletable` + `aggregate Car
extends Vehicle`. Does `Car` hide soft-deleted rows, and may a `Car` read say
`ignoring softDeletable`? Before this ruling the base's fields reached the
subtype but its capability identity did not: the subtype carried `is_deleted`
and nothing filtered it (node, Python, Java, Elixir, .NET Dapper, .NET EF
TPC), and `ignoring softDeletable` on the subtype was refused as an unknown
capability. Tenancy only held because `loom.tenancy-stance-unmarked` forced the
author to repeat `with tenantOwned` on every concrete.

**Decision.** A `Car` is a `Vehicle`, so everything a capability on the base
contributes applies to every concrete that `extends` it, transitively: its
filters and bare `filter` declarations, its stamps, its capability tags and its
`crossTenant` stance.

- **Where.** Once, in phase ⑥ (`src/ir/enrich/inherited-capabilities.ts`).
  Every backend reads the merged `contextFilters` / `contextFilterOrigins` /
  `contextStamps` / `capabilities` and carries no inheritance logic, and the
  `ignoring` and tenancy validators resolve against the same set.
- **Order.** Ancestors' filters first (root-most first), then the concrete's
  own; `inheritedFilterCount` (`src/ir/util/inheritance.ts`) reads that prefix.
- **Repeats.** A subtype re-applying its base's capability gets that filter once
  (the inherited entry wins); a stamp assignment the base already makes on the
  same event is dropped from the subtype's own rules.
- **.NET EF TPH.** The root config registers the root's filters once,
  unguarded; a subtype neither re-registers them nor prefixes their names, so
  `ignoring <rootCap>` on a subtype lifts the root's filter.
- **Tenancy.** An unmarked subtype of a `tenantOwned` (or `crossTenant`) base
  has that stance. A subtype declaring the opposite one is
  `loom.tenancy-inherited-stance-conflict`.

Gate: `test/generator/inherited-capability-filter.test.ts` — one case per
backend × TPH/TPC; a Truck read carries the base's `is_deleted` filter and
`ignoring softDeletable` on Truck drops it.
