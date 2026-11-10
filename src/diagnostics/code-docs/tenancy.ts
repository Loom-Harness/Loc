// The `tenancy` family of the code → docs-anchor map: the `loom.*` codes whose
// first segment the `tenancy` message family owns (`../messages/tenancy.ts`).
// `../code-docs.ts` merges every family into `CODE_DOCS_ANCHORS`, and
// `test/system/diagnostic-catalog.test.ts` fails on a code filed under the
// wrong family.

export const anchors: Readonly<Record<string, string>> = {
  "loom.shareable-no-tenancy": "17-auth.md#sharing--shareable",
  "loom.shareable-not-tenant-owned": "17-auth.md#sharing--shareable",
  "loom.share-host-bypass": "17-auth.md#sharing--shareable",
  "loom.tenant-registry-not-constructible":
    "02-systems-and-topology.md#tenancy-by-userclaim-of-registry",
  "loom.tenancy-registry-remote-unsupported":
    "02-systems-and-topology.md#organizationcontext--the-operating-scope",
  "loom.org-context-ancestors-in-reactor":
    "02-systems-and-topology.md#organizationcontext--the-operating-scope",
  "loom.org-context-surface": "02-systems-and-topology.md#organizationcontext--the-operating-scope",
  "loom.tenancy-principal-member-removed": "17-auth.md#user--the-principal-claim-shape",
  "loom.tenancy-data-key-removed": "02-systems-and-topology.md#tenancy-by-userclaim-of-registry",
  "loom.org-context-gate-unmet":
    "02-systems-and-topology.md#organizationcontext--the-operating-scope",

  // --- src/language/validators/statements.ts (M-T9.56 drain) ---------------
  "loom.tenancy-folded-projection-mixed":
    "10-repositories-and-queries.md#folded--keyed-by--one-event",
  "loom.tenancy-projection-over-scoped-fold":
    "10-repositories-and-queries.md#folded--keyed-by--one-event",
  "loom.tenancy-filter-bypass":
    "11-capabilities-filters-stamps.md#ignoring--bypassing-a-filter-at-a-read-site",
};
