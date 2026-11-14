# D-REF-ADMISSION — a request-supplied reference to tenant-owned data resolves under the target's read scope

**Status:** owner rulings, 2026-11-13; applied on all five backends.

**Decision.** A persisted `X id` whose target is `tenantOwned` is probed at
the repository save, inside the write transaction, under the target's read
scope (`src/ir/plan/ref-scope.ts`). A miss is refused exactly like a reference
to a row that does not exist. A `crossTenant` target and the tenancy registry
are checked by the foreign key alone: a row may name another org (a share's
grantee). A `tenantOwned` target in another context has no table beside the
row, so it cannot be checked: `loom.tenancy-ref-unresolvable` is an error under
`enforcement: denyByDefault` and a warning under `opt`.

**Why.** Admission under the read scope reuses the restriction every read of
the target already applies (the tenant floor on the operating org, row rules,
shares, `deny`), so the probe and the reads cannot disagree, and the refusal is
no existence oracle. A strict model must not compile with a write it cannot
check.

**Consequence.** Pinned by the isolation e2e's `assertReferenceAdmission` rung
(every backend), `test/system/ref-admission-census.test.ts`, and
`test/ir/ref-scope-checks.test.ts`.
