# D-STORAGE-SPLIT — split the overloaded `storage` keyword

**Status:** PINNED.

**Problem.** `storage-and-platform-config.md` §3.1/§3.2 use one
`storage` rule for two unrelated concerns — a physical instance
(`storage pg { type: postgres }`) vs. a logical aggregate-to-physical
binding with rich per-binding config (`storage orderEvents { use: pg,
for: Sales.Order, kind: eventLog, schema: "sales" }`). The two forms
share nothing beyond the word — the physical form carries
`type`/`instance`/`connection`/`outbox`/`follows`; the logical form
carries `schema`/`tablePrefix`/`kind`/`ttl`/`every`/`retain`/etc.
Disambiguation by "presence of `for:`" is an accident, not a design.

**Decision.** Three distinct keywords, one job each:

| Keyword | Role | Carries |
|---|---|---|
| `storage` | Physical infrastructure instance | `type`, `instance`, `connection`, `outbox`, `follows` |
| `resource` | Logical (context, kind) → storage binding | `for: <Context>`, `kind: <state\|eventLog\|snapshot\|cache\|replica>`, `use: <storage>`, plus per-`kind` config (`schema`/`ttl`/`every`/`retain`/`keyPrefix`/…) |
| `deployable` | Process/runtime unit | `contexts: [...]`, `dataSources: [...]`, platform config |

Worked example:

```ddd
storage pg     { type: postgres }
storage kafka  { type: kafka }
storage redis  { type: redis }

resource ordersState      { for: Orders, kind: state,    use: pg }
resource ordersEvents     { for: Orders, kind: eventLog, use: kafka }
resource ordersCache      { for: Orders, kind: cache,    use: redis, ttl: 60 }
resource ordersSnapshot   { for: Orders, kind: snapshot, use: redis,
                          every: 100, retain: 5 }

deployable api {
  platform:    node
  contexts:    [Orders]
  dataSources: [ordersState, ordersEvents, ordersCache, ordersSnapshot]
}
```

**Rationale.**

- The two forms are *not* synonyms with shared structure; they are
  separate concepts that happen to live in the same domain. A naming
  rule that makes them parse identically and rely on a sentinel field
  (`for:`) is fragile.
- `resource` reads naturally for "a configured source/sink of data
  for one purpose within one context."
- Keeping `storage` for the physical form preserves the most-typed
  surface (every project has physical stores; only some need rich
  per-context data-source config).
- `deployable.dataSources:` is the new clause; it pairs with the
  existing `contexts:` clause.

**Validator rules implied.**

- `resource` requires both `for:` (a context) and `kind:`. Missing
  either → parse / validate error.
- For each `(context, kind)` actually needed by aggregates in the
  context, exactly one `resource` must exist with matching `for:`
  and `kind:`. State-based aggregate → `kind: state` required;
  ES aggregate → `kind: eventLog` required; `cache`-annotated
  aggregate → `kind: cache` required; etc.
- A deployable's `dataSources:` must include exactly the dataSources
  `for:` the contexts it hosts (one per needed kind) — validator
  rejects under-listing (missing binding for a needed kind) and
  over-listing (a resource `for:` a context the deployable does
  not host).
- Per-`kind:` config keys validated against the resolved physical
  store's `type` (e.g., `ttl:` only on Redis kinds).

**Affects (proposal rewrites needed).**

- `storage-and-platform-config.md` — §2.1 invariant 4 (which
  asserted "no storage homogeneity per BC") conflicts with
  D-GRANULARITY below and needs rewriting; §3.2 ("Logical storage")
  becomes the `dataSource` section; §3.9 ("Module bindings — bare
  form") replaced by deployable's `dataSources:` clause; §3.8
  ("Per-deployable `overrides`") deferred under D-ENV-SWAP.
- `bounded-context-model.md` — the deployable-side
  `storage: { Orders: pg, Subscriptions: pg }` shorthand becomes
  `dataSources:` instead; framework choice on `context` is
  unchanged.
- `storage-and-platform-config-plan.md` and
  `storage-and-platform-config-micro-plan.md` — F1 sub-PRs that
  introduce the logical form ship `dataSource` from day one;
  per-aggregate `for:` does not land in v1 (see D-GRANULARITY).
