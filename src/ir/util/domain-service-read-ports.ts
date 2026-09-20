// Read-port derivation for a `reading`-tier domain-service operation
// (domain-services.md rev. 4).
//
// A `reading` domain-service operation runs read-only repository queries
// (lowered to `repo-read` Calls).  Its generated declaration gains one
// READ-PORT parameter per DISTINCT repository it reads, and the orchestrating
// caller (a `workflow`) supplies the matching handle at the call site.  Both
// the per-backend declaration emitter AND the call-site wiring need the SAME
// ordered set of ports — so the derivation lives here, in `ir/util/` (the layer
// its consumers share, per pipeline-checklist.md), DERIVED from the lowered body
// (CLAUDE.md "derive, don't stamp"): there is no stamped read-port field.
//
// A port is identified by its `repo` (the repository name, e.g. `Accounts`) and
// the `aggregate` it serves (e.g. `Account`).  Ports are returned in
// first-read order, de-duplicated by repository name, so a body that reads the
// same repository twice declares one parameter and the caller passes one handle.
import type {
  DomainServiceIR,
  DomainServiceOperationIR,
  ExprIR,
  WorkflowStmtIR,
} from "../types/loom-ir.js";
import { walkExprDeep, walkStmtExprsDeep, walkWorkflowStmtExprsDeep } from "./walk.js";

/** One read-port a `reading` operation consumes — the repository it reads and
 *  the aggregate that repository serves. */
export interface ReadPort {
  /** The repository name (`Accounts`). */
  repo: string;
  /** The aggregate the repository serves (`Account`) — the generated repo
   *  class is `<aggregate>Repository`. */
  aggregate: string;
}

/** The ordered, de-duplicated set of read-ports a domain-service operation
 *  consumes — one per distinct repository read in its body, in first-read
 *  order.  Empty for a `pure` operation (no `repo-read` Call), which is why a
 *  pure service's declaration / call site stays byte-identical. */
export function readPortsForOperation(op: DomainServiceOperationIR): ReadPort[] {
  const byRepo = new Map<string, ReadPort>();
  for (const stmt of op.body) {
    walkStmtExprsDeep(stmt, (e: ExprIR) => {
      if (e.kind === "call" && e.callKind === "repo-read" && e.repoRead) {
        const { repo, aggregate } = e.repoRead;
        if (!byRepo.has(repo)) byRepo.set(repo, { repo, aggregate });
      }
    });
  }
  return [...byRepo.values()];
}

// ---------------------------------------------------------------------------
// Which domain services does a workflow-shaped body call, and at which tier?
//
// Three backends need the same answer at the same moment, for the same reason:
// a `reading` op is an INJECTED object on .NET (`_registration`) and Java
// (`registration`) and a CONTEXT FUNCTION on Elixir, while a `pure` op stays a
// static/module call — but either way the emitting file has to name the service
// in its import/using header and, for the reading tier, in its constructor.
// Getting that wrong produces output that does not compile, and it went wrong
// the same way three times: the WORKFLOW emitters each grew their own copy of
// this walk, and the explicit `commandHandler`/`queryHandler` emitters grew
// none, so a handler calling a service emitted a bare `Registration.isHolderFree(x)`
// against a bean, with no import (ledger `M-T5.14-reading-service-readport-not-threaded`).
//
// So the walk lives here, once, beside `readPortsForOperation` (which is what
// decides the tier — a reading op is exactly one with ≥1 read port).  Each
// backend reads it and renders its own shape.
// ---------------------------------------------------------------------------

/** Domain services called from one body, split by tier and de-duplicated in
 *  first-call order. */
export interface CalledDomainServices {
  /** Services with ≥1 read port — an injected bean / context fn at the call site. */
  reading: string[];
  /** Services with no read port — a static (or plain module) call. */
  pure: string[];
}

/** The domain services called anywhere in `stmts` (plus `extraExprs` — a
 *  handler's `return <expr>` is not a statement but can carry a call), split by
 *  tier.
 *
 *  Rides `walkWorkflowStmtExprsDeep` / `walkExprDeep` rather than a hand-rolled
 *  child enumeration (CLAUDE.md §No hand-rolled IR walks): a service call inside
 *  an `if-let` branch or a `list` literal is exactly the node a shallow copy of
 *  this walk drops, and dropping it means an unimported symbol in the emitted
 *  file. */
export function domainServicesCalled(
  stmts: readonly WorkflowStmtIR[],
  services: readonly DomainServiceIR[],
  extraExprs: readonly (ExprIR | undefined)[] = [],
): CalledDomainServices {
  const reading: string[] = [];
  const pure: string[] = [];
  const seen = new Set<string>();
  const visit = (e: ExprIR): void => {
    if (e.kind !== "call" || e.callKind !== "domain-service" || !e.serviceRef) return;
    const { service, op: opName } = e.serviceRef;
    if (seen.has(service)) return;
    const svc = services.find((s) => s.name === service);
    const op = svc?.operations.find((o) => o.name === opName);
    if (!svc || !op) return;
    seen.add(service);
    (readPortsForOperation(op).length > 0 ? reading : pure).push(service);
  };
  for (const s of stmts) walkWorkflowStmtExprsDeep(s, visit);
  for (const e of extraExprs) walkExprDeep(e, visit);
  return { reading, pure };
}

/** True when `<service>.<op>` is a `reading`-tier operation — the predicate the
 *  per-backend `domain-service` render arms consult to pick the call shape. */
export function isReadingServiceOp(
  services: readonly DomainServiceIR[],
  service: string,
  opName: string,
): boolean {
  const op = services.find((s) => s.name === service)?.operations.find((o) => o.name === opName);
  return !!op && readPortsForOperation(op).length > 0;
}
