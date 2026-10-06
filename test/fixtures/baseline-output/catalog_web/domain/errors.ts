// Auto-generated.
export class DomainError extends Error {
  constructor(message: string) { super(message); this.name = "DomainError"; }
}
/** A value object's invariant refused a value (M-T5.1).  A DomainError, so
 *  every catch still classifies it; the routers answer it with the domain-floor
 *  status PLUS one RFC 7807 errors[] entry carrying the rule's message and, for
 *  a messaged rule, its content-hash code. */
export class ValueObjectInvariantError extends DomainError {
  readonly valueObject: string;
  readonly code: string | undefined;
  constructor(valueObject: string, message: string, code?: string) {
    super(message);
    this.name = "ValueObjectInvariantError";
    this.valueObject = valueObject;
    this.code = code;
  }
}
export class AggregateNotFoundError extends Error {
  constructor(message: string) { super(message); this.name = "AggregateNotFoundError"; }
}
/** Authorization failure — raised by `requires` expressions in
 *  operation / workflow bodies when the resolved currentUser
 *  doesn't satisfy the gate.  The per-route catch maps this to
 *  HTTP 403 (Forbidden).
 *
 *  `message` names the failed gate and goes to the `forbidden` log line;
 *  `detail` is the 403 body's `detail` — the constant `Forbidden`: this deployable does not run the dev-stub verifier, so the predicate stays in the server log. */
export class ForbiddenError extends Error {
  readonly detail: string;
  constructor(message: string) { super(message); this.name = "ForbiddenError"; this.detail = "Forbidden"; }
}
/** State-gate failure — raised when an operation's 'when' predicate
 *  (the canCommand gate, criterion.md use site 2) evaluates false
 *  against the loaded aggregate.  The per-route catch maps this to
 *  HTTP 409 (Conflict — the request is well-formed and authorized,
 *  but the aggregate's current state disallows it). */
export class DisallowedError extends Error {
  constructor(message: string) { super(message); this.name = "DisallowedError"; }
}
/** Wraps an exception thrown by a user-supplied extern handler.  The
 *  per-router `app.onError` maps this to a 500 envelope that names
 *  the offending op + aggregate, instead of the bare
 *  `{ "error": "internal" }` operators see when the same throw
 *  bubbles unwrapped.  Domain-layer errors raised by the user
 *  handler (DomainError, ForbiddenError, AggregateNotFoundError)
 *  are NOT wrapped — they bubble through and the router maps them
 *  to their usual status codes. */
export class ExternHandlerError extends Error {
  readonly opName: string;
  readonly aggName: string;
  readonly cause: unknown;
  constructor(opName: string, aggName: string, cause: unknown) {
    const inner = cause instanceof Error ? cause.message : String(cause);
    super(`Extern handler '${opName}' on '${aggName}' threw: ${inner}`);
    this.name = "ExternHandlerError";
    this.opName = opName;
    this.aggName = aggName;
    this.cause = cause;
  }
}
/** Optimistic-concurrency conflict — raised by the repository's guarded
 *  write when a `versioned` aggregate's expected version no longer
 *  matches the stored row (another request won the race).  The per-router
 *  catch maps this to HTTP 409 (Conflict), distinct from the `disallowed`
 *  state-gate 409 — a dashboard can tell "stale write" from "state gate"
 *  apart via the `conflict` vs `disallowed` log event. */
export class ConcurrencyError extends Error {
  constructor(aggregate: string, id: string) {
    super(`${aggregate} ${id} was modified by another request`);
    this.name = "ConcurrencyError";
  }
}
