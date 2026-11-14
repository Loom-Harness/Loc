# D-TENANCY-FLAT — data visibility is flat; the org tree manages sub-tenants; the operating org and its ancestors are resolved per request

**Status:** PINNED (owner ruling, 2026-11-09). Supersedes D-TENANCY-HIERARCHY
and amends D-TENANCY-REGISTRY. Implementation is tracked on GitHub (the
tenancy & identity epic and its slices).

**Problem.** D-TENANCY-HIERARCHY made hierarchical reach a per-role read level
(`deep` / `global`) and paid for it by stamping the owning org's materialized
path (`dataKey`) on every `tenantOwned` row, so a subtree read is a prefix
scan. That design has four standing costs:

- **No org can ever move.** The path is copied into every row of every table
  (and into event streams, permanently), so the registry's `parent` has to be
  immutable.
- **It is a stamped copy with no invalidation** — the shape "Derive, don't
  stamp" (CLAUDE.md) exists to prevent.
- **The path must be known at write time.** The record itself left that as an
  unverified assumption (session enrichment, or a per-request registry read);
  the gap surfaced as cross-deployable registry reads against a table the
  deployable does not host, and as a silent fall-back to the claim.
- **Prefix matching is fragile**: escaping, the segment separator, an opclass
  index, and five backends to get each right.

The owner also ruled that hierarchical *data* visibility is not wanted: reach
beyond the caller's own org is an explicit act (a share or a row rule), not a
consequence of where an org sits in the tree.

**Decision.**

1. **Data visibility is flat.** A `tenantOwned` row is visible, by default, to
   its own org only — today's `local` floor, `tenant_id = <operating org>`.
   There is no `deep` and no `global` level; the policy ladder keeps `local`
   and gains the rungs and row rules decided with the sharing model
   (D-SHARING). Nothing about the registry tree takes part in a data read
   except a `subtree` share grantee.

2. **Rows carry only `tenantId`.** No `dataKey` field, column, stamp, index or
   event attribute. `tenantOwned` provides exactly `tenantId`, its stamp and
   its filter.

3. **The registry tree is for managing sub-tenants.** `implements
   tenantRegistry` provides `parent: Self id?` as an **ordinary mutable field**
   — no generated move operation. Re-parenting an org is an operation the author
   writes when tenant management needs it (`operation move(to: Organization id)
   { parent := to }`), gated by the author's `requires` and policy like any
   other registry operation:
   - a move is one `parent` update — no row elsewhere changes, because nothing
     positional is stamped on rows;
   - guarding against cycles and cross-customer moves is the author's
     operation's job; the generated code stays correct regardless: the
     ancestors walk (item 4) terminates on a cycle;
   - a generated, fully checked `move(to)` was considered and dropped: its
     cycle and same-top-level-org checks are a registry walk no operation body
     can express, so it needed a dedicated macro plus a generated precondition
     on every backend, for a rare tenant-management action.

4. **`organizationContext` is the operating org.**
   - `organizationContext.org` — the org the request acts in: the caller's home
     org (the tenancy claim) unless the request sends `x-org-context: <org id>`
     naming an org the caller can **read on the registry** (its read rules
     decide; a refused switch is a 403 before any handler runs).
   - `organizationContext.ancestors` — the operating org **and** every org above
     it, resolved **once per request** and memoized, by a recursive walk over
     `parent` that **terminates on a cycle** (set semantics, so an author-written
     move that creates a loop cannot hang a request). It is typed
     `<Registry> id[]` and read with `.contains(x)` in policy functions and row
     predicates; the `subtree` share grantee is built on it.
   - Reads, writes and the write stamp anchor on `organizationContext.org`.
     `currentUser` is never rewritten by a switch: it is always the real
     principal with its home-org claim.

5. **Removed surface.** Each is a `loom.*` error naming its replacement once
   the slice that removes it lands:

   | Removed | Replacement |
   |---|---|
   | `allow deep on X`, `allow global on X` (read and write) | a share, or a row rule (D-SHARING) |
   | `dataKey` (field, column, stamp) | none — rows carry `tenantId` only |
   | `currentUser.orgPath`, `currentUser.rootOrg` | `organizationContext.org`, `organizationContext.ancestors` |
   | `organizationContext.orgPath` | `organizationContext.org` (an id, not a path) |
   | the `x-org-context` path value | an org id |
   | `loomorgpath` envelope attribute, `orgPath` in the event origin | the event origin is `{tenant, causedBy}`; `tenant` is the operating org of the raising request |

6. **A deployable that does not host the registry** has no registry table,
   so it is **refused** what needs one, and nothing is copied to it: a context
   it hosts that reads `organizationContext.ancestors` is a compile-time
   `loom.tenancy-registry-remote-unsupported` (host the registry's context
   there too), and its switch gate admits the home org only.  A registry copy
   (a per-request call to the hosting deployable, or a folded `(org, parent)`
   projection) is deferred until a model needs it.

7. **Data locality.** A tenant (the owning org) is the unit of data locality:
   tenant-owned data references another tenant's data only through
   `crossTenant` reads or reference data. This keeps a distributed-Postgres
   layout keyed by `tenant_id` available without changing the model.

**Generated shape (postgres, node).**

```ddd
tenancy by user.tenantId of Organization

aggregate Organization with crudish {
  name: string
  implements tenantRegistry        // parent: Organization id?  (mutable)
  operation move(to: Organization id) requires currentUser.role == "admin" {
    parent := to                   // authored; the capability generates no move
  }
}
aggregate Invoice with tenantOwned { number: string  amountDue: decimal }
```

```sql
-- Invoice read: the flat floor, anchored on the operating org
SELECT * FROM invoices WHERE tenant_id = $operatingOrg;

-- organizationContext.ancestors, once per request (memoized)
WITH RECURSIVE up(id, parent) AS (
  SELECT id, parent FROM organizations WHERE id = $operatingOrg
  UNION SELECT o.id, o.parent FROM organizations o JOIN up ON o.id = up.parent)   -- UNION: stops on a cycle
SELECT id FROM up;
```

**Alternatives rejected.**

- **Keep `dataKey`, allow moves by rewriting paths** — a move rewrites every
  tenant-owned table and cannot rewrite event streams.
- **A closure table** (`ancestor, descendant, depth`) — it earns its keep only
  on a hot hierarchical read path, which this decision removes. The per-request
  recursive walk over a small registry serves the remaining consumers.
- **Hierarchical data levels with a closure table** (`deep` / `inherited` /
  `global` as semi-joins) — technically sound, but the owner ruled reach beyond
  one's own org should be explicit (shares, row rules), not positional.
- **A tenant-boundary flag on a platform root org** — "root-org magic"; the
  tree stays plain parent/child, and operator access is an ordinary role
  (D-SHARING / the platform & identity design).

**Consequences.**

- The `subtree-like` prefix machinery, the `data_key` indexes and the
  NULL-`dataKey` OR-fallback have no remaining purpose.
- Event-sourced streams stop carrying `dataKey`; a fold over a tenant-owned
  producer stamps `tenant_id` only.
- `loom.policy-level-requires-hierarchy` loses its reason to exist;
  `loom.tenancy-registry-remote-unsupported` narrows to the uses that need the
  registry's table (item 6).
- A reactor runs as the system principal, which carries no ancestor set: a
  reactor reading `organizationContext.ancestors` is
  `loom.org-context-ancestors-in-reactor`.
- D-REACTOR-SYSTEM-PRINCIPAL's event origin drops `orgPath`.
- D-CROSSTENANT-ACK is unaffected: `allow global` is gone altogether.

**Affects.** `docs/tenancy.md` (the ladder, hierarchy, `organizationContext`,
folded-projection and registry sections) and `docs/auth.md` (computed principal
members) — each section is rewritten by the slice that lands its behaviour;
D-TENANCY-HIERARCHY (superseded); D-TENANCY-REGISTRY (amended);
D-REACTOR-SYSTEM-PRINCIPAL (event origin); `src/macros/prelude.ts`
(`tenantOwned`, `tenantRegistry`); `src/ir/util/tenant-stance.ts`;
`src/generator/_expr/subtree-like.ts`; the five backends' read-scope, stamp and
principal seams.
