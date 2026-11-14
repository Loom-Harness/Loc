# D-SHARING — visibility composes from the tenancy default; row rules and shares add to it; relations are predicates

**Status:** PINNED (owner ruling, 2026-11-09). Builds on D-TENANCY-FLAT.
Implementation is tracked on GitHub (the tenancy & identity epic).

**Problem.** With hierarchical data levels gone (D-TENANCY-FLAT), a row is
visible to its own org and nothing else. Real models need more, and need it
explicitly: a manager shares one record with another org; a category shared
with a subsidiary brings its products along; a private note is visible to its
author only; an operator role reads every tenant. Each of these is a widening
or narrowing of the tenancy default, and each must stay compilable to one SQL
predicate per aggregate — the same `readScope` / `writeScope` fact every backend
already renders.

**Decision.**

1. **How visibility composes.** Per aggregate and per access (read / write):

   | Source | Effect |
   |---|---|
   | `with tenantOwned` | **the default**: rows of the operating org (`local`) |
   | `allow own on X [when …]` | **replaces** the default with "rows I created in the operating org" (needs a creator field — `auditable`'s `createdBy`, or an `owned` field) |
   | `allow crossTenant on X when …` | **replaces** the default with "every tenant's rows" for callers the `when` admits; `when` is mandatory |
   | `allow [write] on X as x where <row predicate>` | **adds** rows (OR) |
   | `deny [write] on X`, `mask unless` | **removes** rows / fields; always wins |

   The resulting scope is `(default OR rule₁ OR rule₂ …) AND NOT deny`, field
   masks applied on top. A rule never restates the default.

2. **`when` and `where` are different things.**
   - `when <expr>` — a condition on the **caller** only (`currentUser`,
     `organizationContext`, `permissions.*`), evaluated before any query. Several
     level rules for one aggregate may coexist, each with its own `when`
     (manager vs clerk); the rules OR together.
   - `where <expr>` — a predicate on the **row**, bound by `as x`, compiled into
     the query. It must be queryable (the `criterion` sublanguage plus `exists`).

3. **Relations are predicates.** There is no relation graph and no
   "follow"/`visible()` primitive.
   - A relation on the row → a clause (`x.owner == currentUser.id`).
   - A relation held by another aggregate → `exists <Agg> as s where …`. The
     quantified aggregate's own read scope applies inside the `EXISTS`, so an
     `exists` never observes rows the caller could not read.
   - Following a reference → call a **named policy function** on it. A policy
     function used inside a `where` must be queryable; it may take an aggregate
     or an `X id` (dereferenced through a join); it is inlined at lowering;
     recursion and call cycles are refused.

4. **Relations never follow by default.** A reference (`X id`, `X id[]`, a
   projection or event field) grants nothing. Visibility follows a relation only
   through an authored rule. No per-relation declaration is required and no hint
   is raised: a silent relation is *closed*, which is safe — unlike a silent
   tenancy stance (D-TENANCY-DEFAULT), whose default could leak. A visible row may
   reference a row the caller cannot read: its id is returned, and a dereferenced
   read of the target yields nothing, like any read of an invisible row.

5. **`shareable` is a capability marker whose declarations the macro layer
   unfolds to plain Loom.** The prelude declares it member-less; `with shareable`
   on aggregate `X` expands (`src/macros/stdlib/shareable/`) to an ordinary share aggregate (`XShare`), two policy
   functions (`GranteeIsMe`, `SharedWithMe`) and two rules (grantees read the
   shares addressed to them; `X` is readable where `SharedWithMe`) — `unfold` ejects editable source; nothing is hidden machinery.
   - Grantee is a **kind**, not an include-below flag, so every kind carries
     exactly the data it needs and new kinds slot in uniformly:
     `org` (that org), `subtree` (that org and every org below it), `user`.
   - `subtree` matches through `organizationContext.ancestors` (the operating org
     and every org above it), so a move re-targets subtree shares on the next
     request with nothing rewritten.
   - Shares may cross tenants: a parent org shares with its children, and a
     sharer may grant another customer's org or user. The protection is
     `allow share on X`, write access to the row in the sharer's own org, and
     a share counting only when it sits in the row's own org.
   - Write shares count only for the write scope.
   - Rules on *dependent* aggregates ("products follow their category") are
     written by the author — whether a relation follows is a domain decision.

6. **Who may share, and what a share opens.**
   - Creating or revoking a share needs `allow share on X [when …]` **and**
     write access to that row in the sharer's operating org — the unfold's
     `requires exists X for write as x where x.id == <x> && x.tenantId ==
     organizationContext.org` (403). A grantee cannot re-share.
   - A grant opens the row only: `mask unless` still applies by the grantee's
     own principal.
   - Shares are state-stored (never inside an event stream), co-hosted with
     their aggregate (a cross-deployable read that bypasses the host is
     refused), and a TPH base keeps its shares on the root.
   - Sharing and revoking emit `<X>Shared` / `<X>Unshared`.

7. **Generated surface of a shareable aggregate.**
   The share aggregate's own derived surface — `POST /api/<x>_shares`,
   `GET /api/<x>_shares` (the caller org's shares and the ones addressed to
   it), `POST /api/<x>_shares/{id}/revoke` (OpenAPI and api clients included):
   a share is an ordinary aggregate, so it needs no routing of its own, and a
   revoked share stays on record. Beside it, a scaffolded **Share…** action on the detail page of every frontend and
   HEEx: a grantee-kind radio (Org / Org and below / User), an org picker over the
   registry, a user picker over the caller org's memberships (an id input when
   the system has none), read/write, and the current grants with Revoke.

**Example.**

```ddd
context Catalog {
  aggregate Category with tenantOwned, shareable { name: string }
  aggregate Product with tenantOwned { name: string  category: Category id }
  aggregate Note with tenantOwned, auditable { body: string }

  // what `with shareable` on Category unfolds to:
  enum ShareGranteeKind { Org, Subtree, User }
  aggregate CategoryShare with tenantOwned {
    category: Category id
    granteeKind: ShareGranteeKind
    org: Organization id?
    user: guid?               // the system's `user { id: … }` type: the principal has no aggregate to name
    write: bool
    revoked: bool = false
    invariant orgGrantee: granteeKind == ShareGranteeKind.User || org != null
    invariant userGrantee: granteeKind != ShareGranteeKind.User || user != null
    create(category: Category id, granteeKind: ShareGranteeKind, org: Organization id?, user: guid?, write: bool) {
      requires exists Category for write as x where x.id == category && x.tenantId == organizationContext.org
      emit CategoryShared { share: id, category: category }
    }
    operation revoke() {
      requires exists Category for write as x where x.id == category && x.tenantId == organizationContext.org
      revoked := true
      emit CategoryUnshared { share: id, category: category }
    }
  }
  event CategoryShared { share: CategoryShare id  category: Category id }
  event CategoryUnshared { share: CategoryShare id  category: Category id }
  policy GranteeIsMe(s: CategoryShare): bool = !s.revoked && (
       (s.granteeKind == ShareGranteeKind.Org     && s.org == organizationContext.org)
    || (s.granteeKind == ShareGranteeKind.Subtree && organizationContext.ancestors.contains(s.org))
    || (s.granteeKind == ShareGranteeKind.User    && s.user == currentUser.id))
  policy SharedWithMe(x: Category): bool =
    exists CategoryShare as s where s.category == x.id && s.tenantId == x.tenantId && GranteeIsMe(s)
  policy CategorySharing {
    allow read on CategoryShare as s where GranteeIsMe(s)   // a grantee sees the shares addressed to it
    allow read on Category as x where SharedWithMe(x)
    allow write on Category as x where
      exists CategoryShare as s where s.category == x.id && s.tenantId == x.tenantId && s.write && GranteeIsMe(s)
  }

  // authored:
  policy {
    allow share on Category when currentUser.role == "manager"
    allow read on Product as p where exists Category as c
      where c.id == p.category && SharedWithMe(c)             // products follow their category
    allow own on Note when currentUser.role == "clerk"
  }
}
```

```sql
-- Product read for a caller in operating org $org, user $u, ancestors $anc.
-- GranteeIsMe(s) inlines to:
--   NOT s.revoked AND ((s.grantee_kind = 'Org' AND s.org::text = $org)
--     OR (s.grantee_kind = 'Subtree' AND s.org = ANY($anc)) OR (s.grantee_kind = 'User' AND s.user = $u))
SELECT p.* FROM products p
WHERE p.tenant_id = $org                                       -- Product's tenancy default
   OR EXISTS (SELECT 1 FROM categories c                       -- Category's own read scope applies
              WHERE c.id = p.category
                AND EXISTS (SELECT 1 FROM category_shares s
                            WHERE s.category = c.id
                              AND s.tenant_id = c.tenant_id    -- the share sits in the row's org
                              AND GranteeIsMe(s)));
```

A share row belongs to the **sharer's** tenant. The unfold's
`allow read on CategoryShare … where GranteeIsMe(s)` is what lets a grantee in
another org see the share rows addressed to it — and therefore what lets the
`exists` inside `SharedWithMe` find them under the scoping rule of item 3. No
special case: the share aggregate is read through its own rules like any other.
A share counts only when it sits in the shared row's own org
(`s.tenantId == x.tenantId`): a share another org writes for a row it does not
own — or a grantee's re-share — opens nothing.

**Validation (new `loom.*` codes; catalog text in the owning family).**

| Condition | Severity |
|---|---|
| `allow crossTenant` without `when` | error |
| `allow own` on an aggregate with no creator field | error |
| `allow share on X` where `X` is not `shareable` | error |
| a `where` that is not queryable (a non-queryable expression or policy function) | error |
| a policy-function call cycle | error |
| a cross-deployable read of a `shareable` aggregate that bypasses its host | error |

Capability-table rows: `shareable` × state (supported), × `softDeletable`
(supported — a deleted row's shares are hidden with it), × `persistedAs:
eventLog` and × `shape: document` (refused by `loom.exists-unsupported`: the
share rules quantify over the row, which neither read path renders), × an
inheritance hierarchy (refused by `loom.policy-scope-inheritance-unsupported`,
like every row rule there), × cross-deployable read (refused,
`loom.share-host-bypass`).  A query-time projection over a shareable aggregate
on its OWN deployable applies only the source's tenancy floor, not its share
rules: it under-shows a grantee's rows and never leaks one.

**Alternatives rejected.**

- **A relation graph / "follow" primitive** (Zanzibar `category->view`, Oso
  `"read" if "read" on "category"`, a `visible(ref)` function) — Loom's model is
  predicates over typed aggregates compiled to SQL (the Cedar / RLS family);
  calling a policy function on a reference gives the arrow's reach without a
  second relation store, and keeps every rule visible in source.
- **General policy logic** (OPA / Rego) — turning it into a query needs partial
  evaluation; the `criterion` sublanguage plus `exists` already compiles.
- **Default visibility declared on the aggregate** — visibility stays per role in
  `policy` (the established D-POLICY-STYLE / ladder shape); the aggregate only
  opts into *capabilities* (`shareable`).
- **An include-below flag on an org grantee** — a meaningless `user` + flag
  combination becomes representable; a kind does not.
- **An info hint for references to shareable aggregates without a rule** — most
  references must not follow (Invoice → Customer), so it would fire everywhere
  and need a per-reference silencing annotation.
- **Hierarchical levels** (`deep` / `inherited` / `global`) — removed by
  D-TENANCY-FLAT; reach beyond one's org is explicit.

**Consequences.**

- The policy ladder accepts several level rules per aggregate when each carries
  a distinct `when`; `loom.policy-duplicate-target` still refuses exact
  duplicates.
- Every backend renders the composed scope from the one `readScope` /
  `writeScope` fact; `exists` and inlined policy functions are its only new
  shapes.
- Folded projections may be policy targets for `crossTenant` reads (platform
  reporting).

**Affects.** `docs/auth.md` (policy block, named policy functions, read gates),
`docs/tenancy.md` (the ladder) — each rewritten by the slice that lands the
behaviour; `src/language/ddd.langium` (policy rules, `exists`);
`src/macros/prelude.ts` (the `shareable` marker) and
`src/macros/stdlib/shareable/` (what it unfolds to); the read-scope enrichment and the five
backends' scope renderers; the walker (Share primitive) and every design pack.
