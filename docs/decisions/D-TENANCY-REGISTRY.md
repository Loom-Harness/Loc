# D-TENANCY-REGISTRY — registry named in `tenancy by … of X` + a `tenantRegistry` capability

**Status:** PINNED — **amended by D-TENANCY-FLAT** (owner ruling, 2026-11-09): the capability provides no `dataKey` and no path stamp, and `parent` is an ordinary mutable field: a move is an author-written operation.

**Problem.** The tenant registry (the `Organization`/`Tenant` aggregate) can't be
plain tenant-scoped (it is created before its own tenant context exists, and is
self-keyed with no `TenantId` column) nor `crossTenant` (that would leak every
org). An early draft made it a `platform` aggregate mode.

**Decision.** The registry is a **system-level fact** named in `tenancy by
user.tenantId of Organization`. It carries an explicit, unfoldable **`implements
"tenantRegistry"` capability** that **provides** an immutable self-referential
`parent: Self id?` + a managed `dataKey` path + the path-stamp — fields come from
the local capability, never injected by the distant `tenancy by` line
(verify-don't-inject). Loom **verifies** cardinality (exactly one
`tenantRegistry`) + the `of …` cross-link + that the claim field exists — **not**
field-conformance (the capability provides the fields by construction).
**Reparent is out of scope** (immutable `parent` ⇒ permanent paths; rare org
moves are an offline migration).

**Affects.** `multi-tenancy-design-note.md` R1/R5; `typed-capabilities.md` (the
`tenantRegistry` worked case).
