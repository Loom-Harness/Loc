// The `tenancy` family of the diagnostic-message catalog: multi-tenant isolation and the organization context.
//
// A code lives in the family that owns its first segment (`loom.<segment>-…`),
// listed in `segments` below; `../messages.ts` merges every family into
// `DIAGNOSTIC_MESSAGES`, and `test/system/diagnostic-catalog.test.ts` fails on a
// key filed under the wrong family.  A code with a brand-new first segment adds
// that segment to the family it belongs with.

import type { MessageEntry } from "./_shared.js";

/** The code first-segments this family owns. */
export const segments = ["tenancy", "tenant", "org", "cross"] as const;

export const messages = {
  // ----------------------------------------------------------------------
  // src/language/validators/inheritance.ts
  // ----------------------------------------------------------------------
  // The tenant registry's id IS the tenant identity, so the signup loop starts
  // by creating a registry row.  No create path means the first tenant can
  // never exist — a bootstrap that cannot start, which is not obvious from the
  // model and was not reported.
  "loom.tenant-registry-not-constructible": (p: { name: unknown }) =>
    `'${p.name}' is the tenant registry ('tenancy by user.<claim> of ${p.name}') but nothing can ` +
    `create one: it declares no 'create', no workflow saves one, and no seed names it, so the ` +
    `generated API is read-only. A tenant's claim value IS a ${p.name} row's id, so with no way ` +
    `to create one the first tenant can never exist. Add 'with crudish' (or declare a 'create') ` +
    `to open the signup loop, or seed the registry if tenants are provisioned out of band.`,

  // ----------------------------------------------------------------------
  // src/language/validators/structural.ts
  // ----------------------------------------------------------------------
  // --- the M-T9.56 drain of `structural.ts` -------------------------------
  "loom.cross-aggregate-entity-part": (p: { name: unknown; ownerName: unknown }) =>
    `Entity part '${p.name}' belongs to aggregate '${p.ownerName}'; cross-aggregate references must go through the root: use '${p.ownerName} id'.`,
  "loom.cross-aggregate-entity-part#construct": (p: {
    where: unknown;
    name: unknown;
    ownerName: unknown;
  }) =>
    `${p.where} constructs '${p.name} { … }', an entity part of aggregate '${p.ownerName}'. ` +
    `An entity part is built only inside the aggregate that owns it — outside it there is nothing to hold it: ` +
    `call an operation on '${p.ownerName}' that adds the part, passing its fields as plain parameters.`,

  // ----------------------------------------------------------------------
  // src/language/validators/tenancy.ts
  // ----------------------------------------------------------------------
  "loom.tenancy-duplicate": (p: { name: unknown }) =>
    `system '${p.name}' declares more than one 'tenancy by' line; keep just the first.`,
  // The materialized org path is gone (D-TENANCY-FLAT): rows carry `tenantId`
  // only, and the caller carries no path.
  "loom.tenancy-principal-member-removed": (p: { shape: unknown; replacement: unknown }) =>
    `'${p.shape}' no longer exists — data visibility is flat and no org carries a ` +
    `materialized path any more.  Use ${p.replacement}.`,
  "loom.tenancy-data-key-removed": (p: { where: unknown }) =>
    `${p.where} uses 'dataKey', which no longer exists — rows carry 'tenantId' only, and ` +
    `the registry tree is its 'parent' field.  Drop the 'dataKey' reference.`,
  "loom.org-context-surface#member": (p: { shape: unknown }) =>
    `'${p.shape}' is not an operating-scope read — 'organizationContext' exposes exactly one ` +
    `member, 'organizationContext.org' (the id of the org this request operates in).  The ` +
    `principal's own claims stay on 'currentUser'.`,
  "loom.org-context-surface#frontend":
    `'organizationContext' is read inside a 'ui' — the operating scope exists only in backend ` +
    `code, where each backend's auth middleware resolves it through the fail-closed ` +
    `'x-org-context' switch gate.  A frontend has no switch gate; read 'currentUser' there, or ` +
    `move the read into the operation / stamp that needs it.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/ui-framework-checks.ts — the two LiveView
  // component-HOISTING collisions (§18 emitter sentinels).  Both used to be a
  // bare `throw new Error` in `liveview-emit.ts`, raised mid-generate on a
  // `.ddd` that had just validated `0 error(s), 0 warning(s)`.
  // ----------------------------------------------------------------------
  // The tenancy half of the `ignoring` surface, and the one that is
  // categorically different from its siblings: bypassing `softDeletable`
  // widens a read to rows the caller's own tenant already owns, bypassing the
  // tenant filter drops the isolation boundary itself.  A WARNING, not an
  // error — the deliberate platform-admin cross-tenant report is a real,
  // supported shape — but an unconditional one: it does not consult
  // `auth { enforcement: }` (an explicit `opt` mode gates nothing, and
  // `requires true` satisfies `denyByDefault` while leaking exactly as hard).
  "loom.tenancy-filter-bypass": (p: {
    site: unknown;
    ctxName: unknown;
    aggName: unknown;
    dropped: unknown;
    clause: unknown;
    claim: unknown;
  }) =>
    `${p.site} on aggregate '${p.ctxName}.${p.aggName}' bypasses ${p.dropped}, so the ` +
    `generated query carries NO tenant predicate and returns rows from every tenant to ` +
    `any caller, whatever their 'currentUser.${p.claim}'. If that cross-tenant read is ` +
    `deliberate (a platform-admin report), gate it behind an explicit platform-admin ` +
    `'requires' and keep it off tenant-facing APIs; otherwise drop '${p.clause}' from the ` +
    `'ignoring' clause. No 'auth { enforcement: }' mode restores the filter — ` +
    `'enforcement: opt' checks nothing and 'requires true' satisfies ` +
    `'enforcement: denyByDefault' while still leaking.`,
  // A tenant-scoped fold row is keyed and read by the event's tenant; a
  // `crossTenant` producer's event carries none, so one fold cannot mix them.
  // A query-time projection reads its `from <Projection>` source through the
  // raw-table query path, which carries no fold read scope.
  "loom.tenancy-projection-over-scoped-fold": (p: {
    name: unknown;
    ctxName: unknown;
    source: unknown;
  }) =>
    `Projection '${p.ctxName}.${p.name}' reads the tenant-scoped folded projection '${p.source}' ` +
    `with 'from ${p.source}', but a query-time projection reads its source's rows without the ` +
    `fold's tenant scope, so every tenant would read every other tenant's rows. Read the folded ` +
    `projection itself ('GET /projections/<name>' or a page QueryView over it), which applies ` +
    `the tenant scope, or fold the aggregate values into it directly.`,
  "loom.tenancy-folded-projection-mixed": (p: {
    name: unknown;
    ctxName: unknown;
    crossTenant: unknown;
    scoped: unknown;
  }) =>
    `Projection '${p.ctxName}.${p.name}' folds events of crossTenant aggregate(s) ${p.crossTenant} ` +
    `and of tenant-scoped producer(s) ${p.scoped}. A folded projection under 'tenancy by' ` +
    `keys and reads its rows by the event's tenant, and a crossTenant event carries no tenant, ` +
    `so the two cannot share one read model. Split it into two projections: one over the ` +
    `crossTenant events (exempt from tenant scoping) and one over the tenant-scoped events.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/tenancy-checks.ts
  // ----------------------------------------------------------------------
  "loom.org-context-gate-unmet#no-auth": (p: { ctx: unknown; dep: unknown }) =>
    `context '${p.ctx}' reads 'organizationContext.org', but deployable '${p.dep}' hosts it ` +
    `without 'auth: required' (and a 'user { … }' block) — the operating scope is resolved by ` +
    `the auth middleware's fail-closed 'x-org-context' switch gate, and a deployable with no ` +
    `auth has no gate: the read would be an unvalidated caller-submitted value.  Add ` +
    `'auth: required' to '${p.dep}'.`,
  "loom.tenant-registry-without-tenancy": (p: { agg: unknown; name: unknown }) =>
    `aggregate '${p.agg}' implements 'tenantRegistry' but system '${p.name}' declares no ` +
    `'tenancy by user.<claim> of <Registry>' line.  The registry tree ('parent') is ` +
    `only meaningful under a tenancy declaration — add it, or drop 'implements tenantRegistry'.`,
  "loom.tenancy-registry-duplicate": (p: {
    name: unknown;
    length: unknown;
    registries: unknown;
    registryName: unknown;
  }) =>
    `system '${p.name}' has ${p.length} aggregates implementing 'tenantRegistry' ` +
    `(${p.registries}); the tenant registry is singular — ` +
    `keep it on exactly one aggregate (the '${p.registryName}' named in 'tenancy by … of').`,
  "loom.tenancy-registry-not-target": (p: { agg: unknown; registryName: unknown }) =>
    `aggregate '${p.agg}' implements 'tenantRegistry' but the tenancy registry is ` +
    `'${p.registryName}' ('tenancy by … of ${p.registryName}').  The tree ` +
    `capability belongs on the registry itself — move 'implements tenantRegistry' onto ` +
    `'${p.registryName}'.`,
  "loom.tenancy-claim-type-mismatch": (p: {
    name: unknown;
    claimField: unknown;
    claimType: unknown;
    registryName: unknown;
  }) =>
    `system '${p.name}': tenancy claim 'user.${p.claimField}' is typed ` +
    `'${p.claimType}' but registry '${p.registryName}' has a guid id. ` +
    `The derived registry self-scope filter compares ${p.registryName}.id to the claim, so ` +
    `declare the claim as '${p.claimField}: guid'` +
    ` (or '${p.claimField}: string', bound as a guid at the accessor site).`,
  "loom.tenant-owned-claim-type": (p: { name: unknown; claimField: unknown; claimType: unknown }) =>
    `system '${p.name}': tenancy claim 'user.${p.claimField}' is typed ` +
    `'${p.claimType}' but 'tenantOwned' provides 'tenantId: string' — the ` +
    `stamp/filter comparison mis-compiles typed backends.  Declare the claim as ` +
    `'${p.claimField}: string' (guid values round-trip as text).`,
  "loom.tenancy-conflicting-stance": (p: { name: unknown }) =>
    `aggregate '${p.name}' is marked both 'crossTenant' and 'with tenantOwned'; ` +
    `the stances are mutually exclusive — keep exactly one.`,
  "loom.tenant-owned-without-tenancy": (p: { name: unknown; sysName: unknown }) =>
    `aggregate '${p.name}' implements 'tenantOwned' but system '${p.sysName}' ` +
    `declares no 'tenancy by user.<claim> of <Registry>' line.  Add the tenancy ` +
    `declaration, or drop 'with tenantOwned'.`,
  "loom.cross-tenant-without-tenancy": (p: { name: unknown; sysName: unknown }) =>
    `aggregate '${p.name}' is marked 'crossTenant' but system '${p.sysName}' ` +
    `declares no 'tenancy by' line — there is no tenant scoping to opt out of, ` +
    `so the flag has no effect.`,
  "loom.tenancy-registry-marked": (p: { name: unknown; owned: unknown }) =>
    `aggregate '${p.name}' is the tenancy registry (named in ` +
    `'tenancy by ... of ${p.name}') and must not be marked ` +
    `${p.owned} — the registry is ` +
    `self-keyed; drop the marker.`,
  "loom.tenancy-stance-unmarked": (p: { name: unknown }) =>
    `aggregate '${p.name}' declares no tenancy stance; add ` +
    `\`with tenantOwned\` (tenant data) or \`crossTenant\` (shared data).`,
  "loom.tenancy-inherited-stance-conflict": (p: {
    name: unknown;
    base: unknown;
    own: unknown;
    baseMarker: unknown;
  }) =>
    `aggregate '${p.name}' declares \`${p.own}\` but its abstract base '${p.base}' ` +
    `declares \`${p.baseMarker}\` — a subtype cannot take the opposite tenancy stance ` +
    `from its base. A base's stance and capabilities apply to every subtype, so ` +
    `'${p.name}' would be both tenant data and shared data. Drop \`${p.own}\` from ` +
    `'${p.name}', or move \`${p.baseMarker}\` off the base and onto the subtypes that want it.`,
} satisfies Record<string, MessageEntry>;
