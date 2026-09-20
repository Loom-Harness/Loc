// The kebab element selector Loom stamps on a WALKED user component
// (`components-emit.ts`'s `@Component({ selector })`) and addresses it by at
// every call site (`angular-target.renderUserComponent`).
//
// It lives in its own leaf because both halves need it and they cannot import
// each other: `components-emit.ts` already imports `angular-target.ts` to walk
// a component body, so the call-site renderer reaching back for the selector
// would close a cycle.
//
// An EXTERN component has no Loom-known selector — its class is hand-written
// and its `@Component` decorator is the author's — so it is addressed through
// `NgComponentOutlet` instead, and this function is never asked about it.

/** `TierBadge` → `app-tier-badge`. */
export function angularComponentSelector(name: string): string {
  return `app-${name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase()}`;
}
