// ---------------------------------------------------------------------------
// The DOMAIN-FLOOR half of the message ladder (M-T1.11 item (c)).
//
// An authored `message "…"` on an aggregate `invariant` / field `check` / an
// operation `precondition` reaches the client twice.  The WIRE rung (a request
// validator) already carried its stable `msg.<hash>` code on `errors[].code`
// (item (1)) and resolved the text through the backend catalog (item (9)).  The
// DOMAIN FLOOR did not: a rule the wire validator cannot see — a precondition
// over the aggregate's own state, an invariant an operation BODY breaks — threw
// the backend's `DomainError` carrying the authored text only, so the 422 had a
// `detail` and nothing a client could localise or bind by.
//
// The rule, on all five backends: a tripped MESSAGED rule at the domain floor
// answers the domain-floor 422 (title "Unprocessable Entity", the message as
// `detail`) PLUS one RFC 7807 `errors[]` entry `{pointer, message, code}` — the
// SAME entry shape moment 5c gave a value object refused inside a body, answered
// through the SAME serializer seam (node `domainFloorProblem`, .NET/java/python
// the value-object answer widened to the base domain error, elixir the
// ProblemDetails domain-floor arm).  `code` is the rule's `msg.<hash>` — byte
// identical to the wire rung's, so one catalog entry serves both rungs.  A
// MESSAGE-LESS rule keeps the plain domain-floor body it always had: it has no
// code, and its text is each backend's derived default.
//
// The pointer is derived, not stamped: `/<field>` when the rule is
// SINGLE-FIELD-SHAPED (`singleFieldShape` — the same attribution the wire
// rung's native chain uses, so a rule points at the same member on both
// rungs), otherwise `""`, the whole request (RFC 6901) — a cross-field rule, or
// a precondition relating the aggregate's state to a parameter, names no single
// member.  5c's ruling for the value-object entry is the `""` half of this.
// ---------------------------------------------------------------------------

import type { BoundedContextIR, InvariantIR, MessageIR, StmtIR } from "../../ir/types/loom-ir.js";
import { hasValueObjectInvariants } from "../../ir/util/value-object-invariants.js";
import { walkStmtsDeep } from "../../ir/util/walk.js";
import { singleFieldShape } from "../../ir/validate/invariant-classify.js";
import { messageCode } from "../../util/message-code.js";

/** True when some aggregate the context emits carries a MESSAGED rule that can
 *  trip at the domain floor — an `invariant` / field `check` (both checked after
 *  every operation body) or an operation `precondition`.  Gates every backend's
 *  domain-floor code carriage, so a project without one emits byte-identically. */
export function hasDomainFloorMessages(ctx: Pick<BoundedContextIR, "aggregates">): boolean {
  const messaged = (invs: readonly InvariantIR[]): boolean =>
    invs.some((i) => i.message !== undefined);
  return ctx.aggregates.some(
    (a) =>
      messaged(a.invariants) ||
      a.parts.some((p) => messaged(p.invariants)) ||
      a.operations.some((o) => o.statements.some(hasMessagedPrecondition)),
  );
}

/** A messaged `precondition` anywhere under `s` (an `if` branch included). */
function hasMessagedPrecondition(s: StmtIR): boolean {
  let found = false;
  walkStmtsDeep(s, (n) => {
    if (n.kind === "precondition" && n.message !== undefined) found = true;
  });
  return found;
}

/** True when the context needs the domain-floor `errors[]` answer at all — a
 *  value object whose invariant can refuse a body-built value (moment 5c) OR a
 *  messaged domain-floor rule (this module).  The one gate every router's
 *  domain-floor arm takes. */
export function hasDomainFloorAnswer(
  ctx: Pick<BoundedContextIR, "aggregates" | "valueObjects">,
): boolean {
  return hasValueObjectInvariants(ctx) || hasDomainFloorMessages(ctx);
}

/** The `errors[].code` a tripped rule carries at the domain floor — the same
 *  `msg.<hash>` the wire rung attaches — or undefined for a message-less rule. */
export function domainFloorCode(message: MessageIR | undefined): string | undefined {
  return message ? messageCode(message.text) : undefined;
}

/** The RFC 6901 pointer a tripped rule's domain-floor entry names: `/<field>`
 *  for a single-field-shaped rule, else `""` (the whole request). */
export function domainFloorPointer(rule: Pick<InvariantIR, "expr" | "guard" | "source">): string {
  const single = singleFieldShape({ expr: rule.expr, guard: rule.guard, source: rule.source });
  return single ? `/${single.field.replace(/~/g, "~0").replace(/\//g, "~1")}` : "";
}
