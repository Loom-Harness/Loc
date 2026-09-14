// Auto-generated.  Do not edit by hand.
import { requestContext } from "../obs/als.ts";
import type { User } from "../auth/user-types.ts";

// Stamp a freshly-inserted row's audit columns from the ambient request
// principal.  A non-request save (seed / system) has no context, so the row
// is returned unstamped.
export function stampInsert<T extends Record<string, unknown>>(row: T): T {
  const ctx = requestContext();
  if (!ctx) return row;
  const currentUser = ctx.currentUser as User | null;
  if (!currentUser) return row;
  return { ...row, tenantId: currentUser.orgId, dataKey: currentUser.orgPath, createdAt: new Date(), createdBy: ctx.actorId, updatedAt: new Date(), updatedBy: ctx.actorId };
}

// Stamp an updated row's mutable audit columns; the create-only columns are
// dropped from the result so the upsert's `set` leaves them immutable.
export function stampUpdate<T extends Record<string, unknown>>(row: T): Partial<T> {
  const ctx = requestContext();
  if (!ctx) return row;
  const { tenantId: _tenantId, dataKey: _dataKey, createdAt: _createdAt, createdBy: _createdBy, ...rest } = row;
  return { ...rest, updatedAt: new Date(), updatedBy: ctx.actorId } as unknown as Partial<T>;
}
