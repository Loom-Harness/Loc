// The OPERATING-scope accessor (`organizationContext`) — derived facts over the
// lowered IR.
//
// Lowering rewrites `organizationContext.org` to the derived principal
// member `currentUser.operatingOrg` (`PRINCIPAL_OPERATING_ORG`), so the
// accessor rides every backend's existing principal threading.  Whether a
// context — and therefore a deployable hosting it — reads the operating scope
// is a pure function of the expressions it holds, so it is DERIVED here on
// demand (never stamped on the IR): the phase-⑦ gate check
// (`tenancy-checks.ts` → `loom.org-context-gate-unmet`) and every backend's
// auth emitter (which emits the fail-closed switch gate only where something
// can read the switched value) ask the same question through the same walk.

import { PRINCIPAL_OPERATING_ORG } from "../../util/principal.js";
import type { BoundedContextIR, ExprIR, SystemIR } from "../types/loom-ir.js";
import { forEachContextExpr } from "./model-exprs.js";

/** Is `e` the lowered operating-scope read — `organizationContext.org`,
 *  i.e. the `operatingOrg` member of the `current-user` principal ref? */
export function isOrgContextRead(e: ExprIR): boolean {
  return (
    e.kind === "member" &&
    e.member === PRINCIPAL_OPERATING_ORG &&
    e.receiver.kind === "ref" &&
    e.receiver.refKind === "current-user"
  );
}

/** Does any expression in `ctx` read the operating scope?  Recomputed per
 *  call (no module-global memo — the walk is one pass over one context, and a
 *  cache would be module state the census would have to pin). */
export function contextReadsOrgContext(ctx: BoundedContextIR): boolean {
  let found = false;
  forEachContextExpr(ctx, (v) => {
    if (!found && isOrgContextRead(v.expr)) found = true;
  });
  return found;
}

/** Does any context of `sys` read the operating scope?  The backends key the
 *  switch gate on this: a system that never reads `organizationContext` emits
 *  byte-identically to before (the header is simply never consulted), while
 *  one that does gets the gate on EVERY backend deployable — a deployable that
 *  hosts no reading context still refuses an out-of-scope switch, which is the
 *  fail-closed direction. */
export function systemReadsOrgContext(sys: Pick<SystemIR, "subdomains">): boolean {
  for (const sub of sys.subdomains) {
    for (const ctx of sub.contexts) if (contextReadsOrgContext(ctx)) return true;
  }
  return false;
}
