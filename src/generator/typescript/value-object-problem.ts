// ---------------------------------------------------------------------------
// A value object's invariant, refused INSIDE a domain body → 422 with an
// RFC 7807 `errors[]` entry (M-T5.1, failure-taxonomy "validation" kind).
//
// A value object runs its invariants at construction.  At the WIRE the rules are
// already folded into the request schema, so a malformed VO in a request body
// answers the §3.2 422 with a pointer to the offending field (RS-33).  A value
// object BUILT by a body — `qty := Qty { value: n }` in an operation, a
// workflow, a handler — trips the constructor instead, and that throw used to
// land on the plain domain-floor 422: `detail` only, no `errors[]`, no `code`.
// So the one failure kind the taxonomy says belongs on the form (a malformed
// value) reached a client as prose it could neither bind nor localise.
//
// The constructor now raises `ValueObjectInvariantError` (a `DomainError`, so
// every existing catch still classifies it), carrying the value object's name
// and — for a messaged rule — the same content-hash `code` the wire rung
// carries.  The routers answer it through `domainFloorProblem`, which keeps the
// domain-floor body and adds ONE `errors[]` entry.  Its pointer is `""` (the
// whole request, RFC 6901): the value was computed by the body, so there is no
// request member it names — pointing at the value object's own field would bind
// the denial to a form control the request never carried.
//
// Gated on a hosted value object declaring an invariant OR a messaged aggregate
// rule (`hasDomainFloorAnswer`, src/generator/_i18n/domain-floor.ts): the same
// answer serves a MESSAGED invariant / check / precondition tripped at the
// domain floor (M-T1.11 (c)), whose `DomainError` now carries the rule's code and
// pointer.  Without either, nothing can reach the answer and the router / errors
// / problem-details files stay byte-identical.
// ---------------------------------------------------------------------------

/** The expression a router's `DomainError` arm answers with: the value-object
 *  problem when the error is one, else the plain domain-floor `problem(...)`
 *  call it already had.  Returns `fallback` unchanged when the gate is off. */
export function domainFloorAnswer(
  gate: boolean,
  status: number,
  title: string,
  fallback: string,
): string {
  if (!gate) return fallback;
  return `domainFloorProblem(c, err, ${status}, ${JSON.stringify(title)}) ?? ${fallback}`;
}
