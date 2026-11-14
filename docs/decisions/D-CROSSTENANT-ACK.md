# D-CROSSTENANT-ACK — `policy { deny on X }` is the `crossTenant` acknowledgment; `allow global` stays refused

**Status:** applied — the proposed default took effect 2026-09-13 (merged to `main` 2026-09-11 in #2863; no override recorded by 2026-09-28; flipped by Wave C5 packet 5.0).

**Question.** What does an author write to acknowledge that a `crossTenant`
aggregate is deliberately unscoped, so that a `loom.crosstenant-needs-policy`
gate has something to require?

**Options.** (a) relax `loom.policy-target-not-tenant-owned` so
`policy { allow global on ExchangeRate }` is accepted as acknowledgment-only;
(b) accept an explicit `policy { deny on X }` (and any ordinary authorization
rule naming the target); (c) mint a new clause
(`crossTenant acknowledged` / `unscoped:`).

**Decision.** (b).

**Rationale.**

- **(a) carries a live trap.** The ladder's `allow global` lowers to a `scope`
  sentinel over the `dataKey` and `tenantId` COLUMNS — columns the `tenantOwned`
  capability provides and a `crossTenant` aggregate does not have. Admitting the
  rule therefore ALSO requires teaching enrichment to treat it as
  acknowledgment-only and derive no filter; miss that and the emitters reference
  columns that are not in the table (a codegen crash, or worse, DDL-valid but
  wrong SQL). `deny`'s always-false sentinel touches no column, so (b) has no
  such half.
- **(c) adds surface for a statement the policy block can already make**, plus a
  grammar rule, a printer arm and a per-backend no-op.
- **(b) keeps `loom.policy-target-not-tenant-owned` meaning what it says** — the
  read/write ladder is for tenant-owned targets — instead of acquiring an
  exception whose semantics differ from identical syntax on the next aggregate.

**Consequences.** A new `loom.crosstenant-needs-policy` requires every
`crossTenant` aggregate under a `tenancy by` system to carry an explicit
authorization rule naming it; a `deny` rule satisfies it, and so does any
`allow`/`policy` rule that names the target. Two fixtures gain the line
(`tenancy-owned.ddd`, `policy-deny.ddd`). D-TENANCY-SCOPE's safety note —
*"`crossTenant` is fail-open at the tenancy layer"* — finally gets its
enforcement: the fail-open stance becomes unwritable by accident, which is the
whole point of the acknowledgment.

**Unblocks.** M-T3.6 item (6) → wave **C6**.

**Sources.** [`T3-security-governance.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/T3-security-governance.md)
M-T3.6 (6); [`tenancy-authorization-final-surface.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/tenancy-authorization-final-surface.md);
`src/diagnostics/messages.ts` `loom.policy-target-not-tenant-owned#read|#write`;
D-TENANCY-SCOPE, D-TENANCY-DEFAULT.
