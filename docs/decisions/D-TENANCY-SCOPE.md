# D-TENANCY-SCOPE — the per-aggregate tenancy axis is two values

**Status:** PINNED.

**Problem.** Earlier drafts of `multi-tenancy-design-note.md` had a three-value
scope axis — `tenantOwned` / `crossTenant` / `platform` — where `platform` meant
"admin-only cross-tenant data" (audit trails, projections), distinct from open
reference data.

**Decision.** The per-aggregate tenancy axis has **two** values: tenant-owned
(the `tenantOwned` capability) and `crossTenant` (unscoped). There is **no
`platform` scope.** *Who may read* is an authorization concern, not a tenancy
scope, so admin-only cross-tenant data is `crossTenant` + an authorization
default-deny policy. Once depth moved to per-role authz access levels
(D-TENANCY-HIERARCHY) and the registry to a capability (D-TENANCY-REGISTRY),
`platform` had no scope meaning left. Safety note: `crossTenant` is fail-open at
the tenancy layer; sensitive cross-tenant data relies on the authz default-deny
gate.

**Affects.** `multi-tenancy-design-note.md` R2 (canonical); `authorization.md`
§0/§2 (no longer lists `platform`).
