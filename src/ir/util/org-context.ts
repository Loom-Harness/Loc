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

import { PRINCIPAL_OPERATING_ANCESTORS, PRINCIPAL_OPERATING_ORG } from "../../util/principal.js";
import type {
  AggregateIR,
  BoundedContextIR,
  ExprIR,
  SystemIR,
  WorkflowStmtIR,
} from "../types/loom-ir.js";
import { forEachContextExpr } from "./model-exprs.js";
import { reactorBodies } from "./system-principal.js";
import { walkStmtExprsDeep, walkWorkflowStmtExprsDeep, walkWorkflowStmtsDeep } from "./walk.js";

/** Is `e` a lowered operating-scope read — `organizationContext.org` or
 *  `.ancestors`, i.e. the `operatingOrg` / `operatingAncestors` member of the
 *  `current-user` principal ref?  Both are anchored on the switched org, so
 *  either one needs the switch gate. */
export function isOrgContextRead(e: ExprIR): boolean {
  return (
    e.kind === "member" &&
    (e.member === PRINCIPAL_OPERATING_ORG || e.member === PRINCIPAL_OPERATING_ANCESTORS) &&
    e.receiver.kind === "ref" &&
    e.receiver.refKind === "current-user"
  );
}

/** Is `e` the lowered `organizationContext.ancestors` read? */
export function isOrgAncestorsRead(e: ExprIR): boolean {
  return (
    e.kind === "member" &&
    e.member === PRINCIPAL_OPERATING_ANCESTORS &&
    e.receiver.kind === "ref" &&
    e.receiver.refKind === "current-user"
  );
}

/** `organizationContext.ancestors.contains(<arg>)` — the operating org's
 *  lineage tested against one value.  In a query predicate (a row rule, a
 *  policy function inlined into one, a capability filter) the argument is a
 *  COLUMN and every backend renders `<column> = ANY(<ancestors>)` / `IN`, with
 *  the ancestor set bound from the request principal.  Returns the argument, or
 *  null for any other shape. */
export function orgAncestorsMembershipArg(e: ExprIR): ExprIR | null {
  const inner = e.kind === "paren" ? e.inner : e;
  if (
    inner.kind === "method-call" &&
    inner.member === "contains" &&
    inner.args.length === 1 &&
    isOrgAncestorsRead(inner.receiver)
  )
    return inner.args[0]!;
  return null;
}

/** `<column> == organizationContext.org` (either side, `==` / `!=`) where the
 *  column is an `X id` — a share's grantee org.  The operating org is the
 *  tenancy CLAIM's text, which need not parse as an id (a claim of "acme" is
 *  legal), so every query renderer compares the pair as TEXT
 *  (`<column>::text = <org>`): a claim that is no id matches no row instead of
 *  failing the statement's parameter cast. */
export function idColumnVsOperatingOrg(
  e: ExprIR,
): { column: ExprIR; org: ExprIR; negated: boolean } | null {
  const inner = e.kind === "paren" ? e.inner : e;
  if (inner.kind !== "binary" || (inner.op !== "==" && inner.op !== "!=")) return null;
  const isOrg = (x: ExprIR): boolean =>
    x.kind === "member" &&
    x.member === PRINCIPAL_OPERATING_ORG &&
    x.receiver.kind === "ref" &&
    x.receiver.refKind === "current-user";
  const isIdColumn = (x: ExprIR): boolean => {
    if (x.kind !== "member") return false;
    const t = x.memberType.kind === "optional" ? x.memberType.inner : x.memberType;
    return (
      t.kind === "id" &&
      (x.receiver.kind === "this" || (x.receiver.kind === "ref" && x.receiver.refKind === "row"))
    );
  };
  const negated = inner.op === "!=";
  if (isOrg(inner.right) && isIdColumn(inner.left))
    return { column: inner.left, org: inner.right, negated };
  if (isOrg(inner.left) && isIdColumn(inner.right))
    return { column: inner.right, org: inner.left, negated };
  return null;
}

/** Does any expression in `ctx` read `organizationContext.ancestors`?  The
 *  ancestors walk reads the registry's table, so only a deployable hosting the
 *  registry can serve such a context (`loom.tenancy-registry-remote-unsupported`),
 *  and a hosting backend resolves the set only when a hosted context reads it. */
export function contextReadsOrgAncestors(ctx: BoundedContextIR): boolean {
  let found = false;
  forEachContextExpr(ctx, (v) => {
    if (!found && isOrgAncestorsRead(v.expr)) found = true;
  });
  return found;
}

/** The tenancy registry's context — the context declaring the `tenancy by …
 *  of <Registry>` target — when the system has one. */
export function registryContextName(
  sys: Pick<SystemIR, "subdomains" | "tenancy">,
): string | undefined {
  const name = sys.tenancy?.registryName;
  if (!name) return undefined;
  for (const sub of sys.subdomains) {
    for (const ctx of sub.contexts)
      if (ctx.aggregates.some((a) => a.name === name)) return ctx.name;
  }
  return undefined;
}

/** The operating-scope facts one backend deployable emits from, derived from
 *  the contexts it hosts.
 *
 *   - `gate` — the switch gate: something in the system reads the operating
 *     scope, so the `x-org-context` header is consulted.
 *   - `registry` — the registry aggregate when this deployable hosts it.  A
 *     requested org is admitted only when the caller can read that registry row
 *     through the registry's read scope, which needs the registry's table; a
 *     deployable without it admits the home org only.
 *   - `ancestors` — a hosted context reads `organizationContext.ancestors`, so
 *     the middleware resolves the set once per request (always with `registry`:
 *     a non-host reader is refused at phase ⑦). */
export interface OrgContextPlan {
  gate: boolean;
  registry?: AggregateIR;
  ancestors: boolean;
}

export function orgContextPlan(
  sys: Pick<SystemIR, "subdomains" | "tenancy" | "user">,
  hostedContextNames: readonly string[],
): OrgContextPlan {
  const gate = !!sys.tenancy?.claimField && systemReadsOrgContext(sys);
  if (!gate) return { gate: false, ancestors: false };
  const regCtx = registryContextName(sys);
  const registry =
    regCtx && hostedContextNames.includes(regCtx)
      ? sys.subdomains
          .flatMap((s) => s.contexts)
          .find((c) => c.name === regCtx)
          ?.aggregates.find((a) => a.name === sys.tenancy!.registryName)
      : undefined;
  const ancestors =
    !!registry &&
    sys.subdomains.some((s) =>
      s.contexts.some((c) => hostedContextNames.includes(c.name) && contextReadsOrgAncestors(c)),
    );
  return { gate, ...(registry ? { registry } : {}), ancestors };
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

/** The event-reactor bodies of `ctx` that read `organizationContext.ancestors`
 *  — directly, or through an operation they call.  A reactor runs as the
 *  system principal, which is scoped to the event's tenant and carries no
 *  ancestor set, so such a read is refused at phase ⑦
 *  (`loom.org-context-ancestors-in-reactor`) rather than answering empty. */
export function reactorsReadingOrgAncestors(ctx: BoundedContextIR): string[] {
  const out: string[] = [];
  for (const wf of ctx.workflows ?? []) {
    for (const body of reactorBodies(wf)) {
      if (stmtsReadOrgAncestors(body.statements, ctx)) out.push(body.label);
    }
  }
  return out;
}

function stmtsReadOrgAncestors(
  statements: readonly WorkflowStmtIR[],
  ctx: BoundedContextIR,
): boolean {
  let found = false;
  const visitExpr = (e: ExprIR): void => {
    if (isOrgAncestorsRead(e)) found = true;
  };
  for (const top of statements) {
    walkWorkflowStmtsDeep(top, (s) => {
      if (found) return;
      if (s.kind === "op-call") {
        const op = ctx.aggregates
          .find((a) => a.name === s.aggName)
          ?.operations.find((o) => o.name === s.op);
        for (const st of op?.statements ?? []) walkStmtExprsDeep(st, visitExpr);
      }
      walkWorkflowStmtExprsDeep(s, visitExpr);
    });
    if (found) return true;
  }
  return false;
}
