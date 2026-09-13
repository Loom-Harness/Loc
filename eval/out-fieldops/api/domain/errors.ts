// Auto-generated.
export class DomainError extends Error {
  constructor(message: string) { super(message); this.name = "DomainError"; }
}
export class AggregateNotFoundError extends Error {
  constructor(message: string) { super(message); this.name = "AggregateNotFoundError"; }
}
/** Authorization failure — raised by `requires` expressions in
 *  operation / workflow bodies when the resolved currentUser
 *  doesn't satisfy the gate.  The per-route catch maps this to
 *  HTTP 403 (Forbidden). */
export class ForbiddenError extends Error {
  constructor(message: string) { super(message); this.name = "ForbiddenError"; }
}
/** State-gate failure — raised when an operation's 'when' predicate
 *  (the canCommand gate, criterion.md use site 2) evaluates false
 *  against the loaded aggregate.  The per-route catch maps this to
 *  HTTP 409 (Conflict — the request is well-formed and authorized,
 *  but the aggregate's current state disallows it). */
export class DisallowedError extends Error {
  constructor(message: string) { super(message); this.name = "DisallowedError"; }
}
/** An `extern` seam whose hand-written body was never filled in — the
 *  scaffold-once stub in `domain/<agg>.ts` still throws.  That is not a server
 *  FAULT: the request was fine and the route exists, the implementation is
 *  simply absent, which is exactly what RFC 9110 §15.6.2 reserves 501 for.  The
 *  per-router catch maps it to 501 carrying this message (the file to fill in),
 *  instead of the generic 500 `"internal"` that told the operator nothing. */
export class NotImplementedError extends Error {
  constructor(message: string) { super(message); this.name = "NotImplementedError"; }
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
