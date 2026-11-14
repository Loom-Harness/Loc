# D-TENANCY-HIERARCHY — always hierarchy-ready; depth is a per-role authz access level

**Status:** SUPERSEDED by D-TENANCY-FLAT (owner ruling, 2026-11-09). Kept for the rationale it records; nothing below is the current rule.

**Problem.** Hierarchical (parent/child org) visibility could be a
flat-vs-hierarchical *mode*, a per-aggregate `subtenantScoped` flavor, or a
per-role access level. An entity-flavor can't express "Manager sees `Project`
deep but `Invoice` local."

**Decision.** **Always hierarchy-ready — no mode switch.** "Flat" is the
degenerate case (every org a root, every read `local`). `tenantId` + a
denormalised `dataKey` (the owning org's materialized path) are stamped on every
`tenantOwned` aggregate **from the token** at create (immutable `parent` ⇒
permanent paths ⇒ `orgPath` can ride the token), so enabling `deep` later is
**migration-free**. **Depth is a per-role authorization access level**, not an
aggregate marker — `authorization.md`'s directional `Self`/`Descendants`/`All`
(Dynamics' `local`/`deep`/`global` is the same ladder, a mnemonic). `deep` is a
**direct indexed prefix scan** on the row's `dataKey` (no join). Grounded in
Dynamics (Business Unit + Basic/Local/Deep/Global) and Salesforce (Role
Hierarchy). **Assumption to verify:** token-carried `orgPath` is a *derived
session value*, not an IdP claim (D-AUTH-OIDC), so the pure-claim-copy stamp is
contingent on session enrichment, else a per-request cached registry lookup.

**Affects.** `multi-tenancy-design-note.md` R5; `authorization.md` §2 (`DataKey`
= the hierarchical extension; directional predicates = the access levels).
