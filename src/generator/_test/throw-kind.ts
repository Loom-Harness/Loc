// The single source of truth for how a generated UNIT test discriminates WHICH
// rung of the domain floor rejected a call — `expect(<call>).toThrow(<kind>)`.
//
// Why it exists: `toThrow()` alone asserts only "it threw".  Deleting a
// `precondition` from an aggregate left its test GREEN, because the
// aggregate's `invariant` threw in its place — a test named "a fresh work
// order cannot be completed" went on claiming something it no longer proved.
//
// The rung is STRUCTURAL on every backend: the domain error carries it as a
// field, independent of the message text, because an authored
// `message "..."` REPLACES the derived "Precondition failed: <src>" sentence
// and so cannot be what a test reads.
//
//   node    `DomainError.kind`            "precondition" | "invariant"
//   python  `DomainError.kind`            "precondition" | "invariant"
//   java    `DomainException.getKind()`   DomainException.Kind.PRECONDITION | INVARIANT
//   .NET    `DomainException.Kind`        DomainErrorKind.Precondition | Invariant
//           (a value object's invariant throws the sibling
//           `ValueObjectInvariantException`, so there its TYPE is the rung)
//   elixir  `GuardError.kind`             :precondition (`elixir/vanilla/denial.ts`)
//
// Every throw site passes the rung SECOND, right after the message
// (`render-stmt.ts` preconditions, `entity.ts` / `aggregate.ts` invariants, the
// value-object invariant errors, and `_i18n/domain-floor.ts` workflow
// preconditions), so the HTTP mapping — which reads only the message, code and
// pointer — is untouched.

import type { ThrowKindName } from "../../util/intrinsic-matchers.js";

/** The error classes a BARE `toThrow()` accepts on node and python: every way
 *  the in-process domain floor refuses a call.
 *
 *    DomainError     — a `precondition`, an aggregate / part invariant, and a
 *                      value object's invariant (`ValueObjectInvariantError`
 *                      subclasses it);
 *    DisallowedError — an operation's `when` state gate, raised at the
 *                      domain-method entry (a sibling of `DomainError`, so the
 *                      router can answer it 409 rather than 422);
 *    ForbiddenError  — a non-leading `requires` left in the operation body.
 *
 *  Nothing else.  A bare `toThrow()` that lowered to "anything threw"
 *  (vitest `.toThrow()`, `pytest.raises(Exception)`) would let a
 *  `ReferenceError` / `NameError` out of BROKEN generated code satisfy a
 *  negative test.  Both backends emit all three classes unconditionally in
 *  `domain/errors`, and spell them identically, hence one list. */
export const DOMAIN_REJECTION_ERRORS = [
  "DisallowedError",
  "DomainError",
  "ForbiddenError",
] as const;

/** The Java spelling of a rung — a `DomainException.Kind` constant. */
export function javaThrowKind(kind: ThrowKindName): string {
  return `DomainException.Kind.${kind.toUpperCase()}`;
}

/** The C# spelling of a rung — a `DomainErrorKind` member. */
export function csThrowKind(kind: ThrowKindName): string {
  return `DomainErrorKind.${kind === "precondition" ? "Precondition" : "Invariant"}`;
}
