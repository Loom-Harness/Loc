// ---------------------------------------------------------------------------
// The DOMAIN-FLOOR half of the message ladder (M-T1.11 item (c)).
//
// A NAMED aggregate `invariant` / field `check` / operation `precondition`
// reaches the client twice: at the WIRE rung (a request validator, its identity
// key on `errors[].code`) and at the DOMAIN FLOOR — a rule the wire validator
// cannot see (a precondition over the aggregate's own state, an invariant an
// operation BODY breaks) throws the backend's domain error.
//
// The rule, on all five backends: a tripped NAMED rule at the domain floor
// answers the domain-floor 422 (title "Unprocessable Entity", the message as
// `detail`) PLUS one RFC 7807 `errors[]` entry `{pointer, message, code}` — the
// SAME entry shape moment 5c gave a value object refused inside a body, answered
// through the SAME serializer seam (node `domainFloorProblem`, .NET/java/python
// the value-object answer widened to the base domain error, elixir the
// ProblemDetails domain-floor arm).  `code` is the rule's identity key
// `<Ctx>.<Owner>.rule.<name>` — byte identical to the wire rung's, so one
// catalog entry serves both rungs.  An UNNAMED rule keeps the plain
// domain-floor body: no code, and the generic text of `ruleText` — never the
// rule's source expression.
//
// The pointer is derived, not stamped: `/<field>` when the rule is
// SINGLE-FIELD-SHAPED (`singleFieldShape` — the same attribution the wire
// rung's native chain uses, so a rule points at the same member on both
// rungs), otherwise `""`, the whole request (RFC 6901) — a cross-field rule, or
// a precondition relating the aggregate's state to a parameter, names no single
// member.  5c's ruling for the value-object entry is the `""` half of this.
// ---------------------------------------------------------------------------

import type {
  BoundedContextIR,
  ExprIR,
  InvariantIR,
  MessageIR,
  StmtIR,
  WorkflowStmtIR,
} from "../../ir/types/loom-ir.js";
import { hasValueObjectInvariants } from "../../ir/util/value-object-invariants.js";
import { walkStmtsDeep, walkWorkflowStmtsDeep } from "../../ir/util/walk.js";
import { singleFieldShape } from "../../ir/validate/invariant-classify.js";
import { ruleText } from "./rule-text.js";

/** True when some aggregate the context emits carries a NAMED rule that can
 *  trip at the domain floor — an `invariant` / field `check` (both checked after
 *  every operation body) or an operation `precondition`.  Gates every backend's
 *  domain-floor code carriage, so a project without one emits byte-identically. */
export function hasDomainFloorMessages(ctx: DomainFloorHost): boolean {
  const named = (invs: readonly InvariantIR[]): boolean =>
    invs.some((i) => i.message !== undefined);
  return (
    ctx.aggregates.some(
      (a) =>
        named(a.invariants) ||
        a.parts.some((p) => named(p.invariants)) ||
        a.operations.some((o) => o.statements.some(hasNamedPrecondition)),
    ) || workflowPreconditionMessages(ctx).length > 0
  );
}

/** The context slice the domain-floor gate reads.  The workflow / handler
 *  members are optional so a narrowed aggregate-only view still type-checks. */
export type DomainFloorHost = Pick<BoundedContextIR, "aggregates"> &
  Partial<Pick<BoundedContextIR, "workflows" | "commandHandlers" | "queryHandlers">>;

/** Every named `precondition`'s text identity in an orchestration body — a
 *  workflow `create` / `on` reactor, a `commandHandler`, a
 *  `queryHandler` — at any depth (banking eval B-02).  A tripped one throws the
 *  same domain-floor error an operation precondition does, so it carries the
 *  same identity-key code and needs the same catalog entry. */
export function workflowPreconditionMessages(
  ctx: DomainFloorHost,
): { expr: ExprIR; message: MessageIR }[] {
  const bodies: (readonly WorkflowStmtIR[])[] = [];
  for (const w of ctx.workflows ?? []) {
    for (const c of w.creates) bodies.push(c.statements);
    for (const o of w.subscriptions ?? []) bodies.push(o.statements);
  }
  for (const h of ctx.commandHandlers ?? []) bodies.push(h.statements);
  for (const h of ctx.queryHandlers ?? []) bodies.push(h.statements);
  const out: { expr: ExprIR; message: MessageIR }[] = [];
  for (const body of bodies) {
    for (const top of body) {
      walkWorkflowStmtsDeep(top, (n) => {
        if (n.kind === "precondition" && n.message !== undefined)
          out.push({ expr: n.expr, message: n.message });
      });
    }
  }
  return out;
}

/** The `throw`/`raise` arguments a WORKFLOW-body precondition hands its
 *  backend's domain error: the rule's text (`ruleText`), the refusing rung
 *  `kind` (spelled as the backend's own expression, already in generated-source
 *  form), and — for a named one — the identity-key code + pointer an operation
 *  precondition carries.
 *  A named workflow precondition switches the backend-wide code carriage
 *  on (`hasDomainFloorMessages`), so the coded constructor always exists when
 *  `code` is set.  Rendered as JSON string literals, valid in TS / C# / Java /
 *  Python alike. */
export function workflowPreconditionThrowArgs(
  st: Pick<InvariantIR, "expr" | "guard" | "source" | "message">,
  kind: string,
): string {
  const detail = JSON.stringify(ruleText(st));
  const code = domainFloorCode(st.message);
  if (code === undefined) return `${detail}, ${kind}`;
  return `${detail}, ${kind}, ${JSON.stringify(code)}, ${JSON.stringify(domainFloorPointer(st))}`;
}

/** A named `precondition` anywhere under `s` (an `if` branch included). */
function hasNamedPrecondition(s: StmtIR): boolean {
  let found = false;
  walkStmtsDeep(s, (n) => {
    if (n.kind === "precondition" && n.message !== undefined) found = true;
  });
  return found;
}

/** True when the context needs the domain-floor `errors[]` answer at all — a
 *  value object whose invariant can refuse a body-built value (moment 5c) OR a
 *  named domain-floor rule (this module).  The one gate every router's
 *  domain-floor arm takes. */
export function hasDomainFloorAnswer(
  ctx: DomainFloorHost & Pick<BoundedContextIR, "valueObjects">,
): boolean {
  return hasValueObjectInvariants(ctx) || hasDomainFloorMessages(ctx);
}

/** The `errors[].code` a tripped rule carries at the domain floor — the same
 *  identity key the wire rung attaches — or undefined for an unnamed rule. */
export function domainFloorCode(message: MessageIR | undefined): string | undefined {
  return message?.key;
}

/** The RFC 6901 pointer a tripped rule's domain-floor entry names: `/<field>`
 *  for a single-field-shaped rule, else `""` (the whole request). */
export function domainFloorPointer(rule: Pick<InvariantIR, "expr" | "guard" | "source">): string {
  const single = singleFieldShape({ expr: rule.expr, guard: rule.guard, source: rule.source });
  return single ? `/${single.field.replace(/~/g, "~0").replace(/\//g, "~1")}` : "";
}
