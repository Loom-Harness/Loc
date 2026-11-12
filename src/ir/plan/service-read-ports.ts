// The repositories a `reading`-tier domain-service call needs.  A service
// operation that reads a repository takes that repository as a leading
// argument (or, on the DI backends, the service is an injected bean holding
// it), so the workflow or handler that calls it must construct the repository
// even when its own body never reads it.  Every backend asks the same three
// questions — which ports one call needs, which ports a body's calls need, and
// which services a body calls in each tier — and a backend that answered one
// differently rendered a call against a handle it never built.

import type {
  BoundedContextIR,
  DomainServiceIR,
  ExprIR,
  WorkflowStmtIR,
} from "../types/loom-ir.js";
import { type ReadPort, readPortsForOperation } from "../util/domain-service-read-ports.js";
import { walkExprDeep, walkWorkflowStmtExprsDeep } from "../util/walk.js";

export type { ReadPort };

/** The read ports the call `service.op` consumes, in order; `[]` for a pure
 *  operation or an unknown one. */
export function serviceOpReadPorts(
  ctx: Pick<BoundedContextIR, "domainServices">,
  service: string,
  op: string,
): ReadPort[] {
  const operation = (ctx.domainServices ?? [])
    .find((s) => s.name === service)
    ?.operations.find((o) => o.name === op);
  return operation ? readPortsForOperation(operation) : [];
}

/** Every domain-service call in `statements` (and `extra` expressions), at any
 *  depth, in source order. */
function serviceCallsIn(
  statements: readonly WorkflowStmtIR[],
  extra: readonly (ExprIR | undefined)[],
): { service: string; op: string }[] {
  const out: { service: string; op: string }[] = [];
  const visit = (e: ExprIR): void => {
    if (e.kind === "call" && e.callKind === "domain-service" && e.serviceRef) {
      out.push({ service: e.serviceRef.service, op: e.serviceRef.op });
    }
  };
  for (const st of statements) walkWorkflowStmtExprsDeep(st, visit);
  for (const e of extra) walkExprDeep(e, visit);
  return out;
}

/** The read ports every domain-service call in a body needs, de-duplicated by
 *  repository, in first-read order. */
export function serviceReadPorts(
  statements: readonly WorkflowStmtIR[],
  extra: readonly (ExprIR | undefined)[],
  ctx: Pick<BoundedContextIR, "domainServices">,
): ReadPort[] {
  const byRepo = new Map<string, ReadPort>();
  for (const call of serviceCallsIn(statements, extra)) {
    for (const p of serviceOpReadPorts(ctx, call.service, call.op)) {
      if (!byRepo.has(p.repo)) byRepo.set(p.repo, p);
    }
  }
  return [...byRepo.values()];
}

/** The services a body calls in one tier, de-duplicated, in first-call order:
 *  `"reading"` — a called operation consumes a read port (an injected bean on
 *  the DI backends); `"static"` — it consumes none (a static call). */
export function servicesCalled(
  statements: readonly WorkflowStmtIR[],
  ctx: Pick<BoundedContextIR, "domainServices">,
  tier: "reading" | "static",
): string[] {
  const out = new Set<string>();
  for (const call of serviceCallsIn(statements, [])) {
    const known = (ctx.domainServices ?? [])
      .find((s) => s.name === call.service)
      ?.operations.some((o) => o.name === call.op);
    if (!known) continue;
    const reads = serviceOpReadPorts(ctx, call.service, call.op).length > 0;
    if (reads === (tier === "reading")) out.add(call.service);
  }
  return [...out];
}

/** The distinct read ports a service consumes across all its operations,
 *  de-duplicated by repository, in first-read order.  Non-empty exactly when
 *  the service is `reading`. */
export function domainServiceReadPorts(svc: DomainServiceIR): ReadPort[] {
  const byRepo = new Map<string, ReadPort>();
  for (const op of svc.operations) {
    for (const p of readPortsForOperation(op)) {
      if (!byRepo.has(p.repo)) byRepo.set(p.repo, p);
    }
  }
  return [...byRepo.values()];
}

/** `own` repositories followed by each read port's repository not already in
 *  `own` — service ports append after a body's own repositories. */
export function withReadPortRepos(
  own: readonly { repoName: string; aggName: string }[],
  ports: readonly ReadPort[],
): { repoName: string; aggName: string }[] {
  const seen = new Set(own.map((r) => r.repoName));
  const out = [...own];
  for (const port of ports) {
    if (seen.has(port.repo)) continue;
    seen.add(port.repo);
    out.push({ repoName: port.repo, aggName: port.aggregate });
  }
  return out;
}
