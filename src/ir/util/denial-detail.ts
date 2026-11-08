// What a 403 tells the caller (ruling D4, amended by #4473).
//
// Every `requires` gate denies with `Forbidden: <the gate's source text>` — the
// message the thrown ForbiddenError / ForbiddenException / `{:forbidden, msg}`
// term carries, and the one each backend's `forbidden` log line records.  The
// gate is `.ddd` source, so it never reaches the wire: under every verifier the
// RFC 7807 `detail` is the constant `Forbidden`, beside the `problem.forbidden`
// code a client localizes by, and the predicate lives only in the server log.

/** The constant `detail` every 403 answers with. */
export const CONSTANT_FORBIDDEN_DETAIL = "Forbidden";

// What a 409 tells the caller — an `operation … when <pred>` invoked in a state
// the predicate rejects (conformance rule RS-17, pinned byte-for-byte across
// the five backends, so the sentence is built here once).
//
// The detail names the operation and the aggregate, never the predicate: a
// `when` expression is the model's internals, not a sentence a caller can act
// on, and echoing it leaks the `.ddd` source into every response.  The body
// carries the stable code `problem.state-gate` (`wireCode`), which is what a
// client localizes by.

/** `operation '<op>' is not allowed in the current state of <Agg>.` */
export function disallowedDetail(opName: string, aggName: string): string {
  return `operation '${opName}' is not allowed in the current state of ${aggName}.`;
}
