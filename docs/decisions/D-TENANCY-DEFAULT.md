# D-TENANCY-DEFAULT — no silent default; an explicit-stance lint

**Status:** PINNED (the lint is an `error`: `loom.tenancy-stance-unmarked`).

**Problem.** A fail-closed *silent* default ("unmarked ⇒ `tenantOwned`") would
have Loom implicitly attach the `tenantOwned` capability, injecting
`tenantId`/`dataKey` — the distant-injection magic the capability model forbids.

**Decision.** **No silent default.** An unmarked aggregate under a `tenancy by`
system is **unscoped**; a **lint** flags it and suggests the explicit marker
(`with tenantOwned` or `crossTenant`). Fields only ever come from an explicit,
unfoldable capability. The lint's **severity is the fail-open/fail-closed knob**:
**error** (recommended — the common case is tenant data, so the unmarked fallback
is the dangerous one) gives fail-closed without magic; **warning** is fail-open.
Shipped as **error** (`loom.tenancy-stance-unmarked`, `tenancy-checks.ts`).

**Affects.** `multi-tenancy-design-note.md` R3 (supersedes original decision #2's
silent-default *mechanism*; the fail-closed *goal* survives via the lint).
