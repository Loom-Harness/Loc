// The single source of truth for how a generated UNIT test discriminates WHICH
// rung of the domain floor rejected a call — `expect(<call>).toThrow(<kind>)`.
//
// Why it exists: `toThrow()` alone asserts only "it threw".  Deleting a
// `precondition` from an aggregate left its test GREEN, because the
// aggregate's `invariant` threw in its place — a test named "a fresh work
// order cannot be completed" went on claiming something it no longer proved.
//
// The rung is STRUCTURAL on every backend: the domain error carries it as a
// field, independent of the message text, because the message is the rule's
// text (a named rule's own, else the generic sentence) and so cannot be what a
// test reads.
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

import { FLOOR_RUNGS, type FloorRung } from "../../ir/plan/test-rejection.js";
import type { ThrowKindName } from "../../util/intrinsic-matchers.js";

/** The exception class each rung of the domain floor raises, per language.
 *  A rung raising a subclass of another rung's class needs no row of its own:
 *  a value object's `ValueObjectInvariantError` / `ValueObjectInvariantException`
 *  subclasses the domain error on node, python and Java. */
export type RejectionClasses = Readonly<Record<FloorRung, string>>;

/** node and python spell their domain errors identically.  `DisallowedError`
 *  is a sibling of `DomainError`, so the router can answer it 409 rather than
 *  422; `ForbiddenError` is a non-leading `requires` left in the body. */
export const JS_PY_REJECTION_CLASSES: RejectionClasses = {
  precondition: "DomainError",
  invariant: "DomainError",
  "state-gate": "DisallowedError",
  requires: "ForbiddenError",
};

/** Java: `DisallowedException` is a sibling of `DomainException`. */
export const JAVA_REJECTION_CLASSES: RejectionClasses = {
  precondition: "DomainException",
  invariant: "DomainException",
  "state-gate": "DisallowedException",
  requires: "ForbiddenException",
};

/** .NET: siblings, not one hierarchy (xUnit's `Assert.Throws<T>` matches the
 *  exact type); a value object's invariant throws the sibling
 *  `ValueObjectInvariantException`, which the .NET leaf adds when the context
 *  declares one. */
export const CS_REJECTION_CLASSES: RejectionClasses = {
  precondition: "DomainException",
  invariant: "DomainException",
  "state-gate": "DisallowedException",
  requires: "ForbiddenException",
};

/** The classes a test accepts for `rungs`, deduplicated and sorted. */
export function rejectionClasses(table: RejectionClasses, rungs: readonly FloorRung[]): string[] {
  return [...new Set(rungs.map((r) => table[r]))].sort();
}

/** The classes a BARE `toThrow()` accepts on node and python: every rung of
 *  the domain floor.  Both backends emit all three classes unconditionally in
 *  `domain/errors`. */
export const DOMAIN_REJECTION_ERRORS = rejectionClasses(JS_PY_REJECTION_CLASSES, FLOOR_RUNGS);

/** The Java spelling of a rung — a `DomainException.Kind` constant. */
export function javaThrowKind(kind: ThrowKindName): string {
  return `DomainException.Kind.${kind.toUpperCase()}`;
}

/** The C# spelling of a rung — a `DomainErrorKind` member. */
export function csThrowKind(kind: ThrowKindName): string {
  return `DomainErrorKind.${kind === "precondition" ? "Precondition" : "Invariant"}`;
}
