// ---------------------------------------------------------------------------
// `app/domain/errors.py` — the domain error taxonomy every layer maps
// onto HTTP statuses (DomainError → 422 per RS-15, AggregateNotFoundError → 404,
// ForbiddenError → 403, DisallowedError → 409).  Mirrors the TS
// `domain/errors.ts`.
// ---------------------------------------------------------------------------

/** The domain error taxonomy module.  A `ConcurrencyError` (mapped to
 *  HTTP 409) is added only when some in-scope aggregate carries the
 *  `versioned` capability, so a concurrency-free app stays byte-identical. */
export function errorsPy(
  hasVersioned: boolean,
  hasValueObjectInvariant = false,
  hasDomainFloorCodes = false,
  hasExtern = false,
): string {
  // M-T5.1 — a value object's invariant refused a value.  A DomainError, so
  // every existing handler still classifies it; `app/http/problem.py`
  // answers it with the domain-floor status plus one RFC 7807 errors[] entry.
  const valueObjectInvariantError = hasValueObjectInvariant
    ? `


class ValueObjectInvariantError(DomainError):
    """A value object's invariant refused a value (surfaces as HTTP 422 with
    one errors[] entry: the whole-request pointer "", the rule's message and,
    the rule's catalog code and the values it read as params)."""

    def __init__(
        self,
        value_object: str,
        message: str,
        code: str | None = None,
        params: dict[str, object] | None = None,
    ) -> None:
        ${hasDomainFloorCodes ? 'super().__init__(message, "invariant", code, "", params)' : 'super().__init__(message, "invariant")'}
        self.value_object = value_object${hasDomainFloorCodes ? "" : "\n        self.code = code\n        self.params = params"}`
    : "";
  // Every DomainError carries the refusing rung as \`kind\`, apart from the
  // message an authored \`message "..."\` replaces.  With M-T1.11 (c) a MESSAGED
  // invariant / field check / precondition also raises its wire \`<Ctx>.<Owner>.rule.<name>\`
  // code and RFC 6901 pointer, so the DomainError handler answers the same
  // errors[] entry the wire rung carries.
  const domainErrorBody = hasDomainFloorCodes
    ? `
    """Precondition or invariant violation (surfaces as HTTP 422).  \`kind\` names
    the refusing rung (None outside the precondition / invariant floor).  A
    messaged rule carries its wire code and the pointer its errors[] entry names
    (M-T1.11 (c)); both are None for an unnamed rule.  \`params\` are the values
    the rule read — the wire \`params\` a client fills its message from."""

    def __init__(
        self,
        message: str,
        kind: DomainErrorKind | None = None,
        code: str | None = None,
        pointer: str | None = None,
        params: dict[str, object] | None = None,
    ) -> None:
        super().__init__(message)
        self.kind = kind
        self.code = code
        self.pointer = pointer
        self.params = params`
    : `
    """Precondition or invariant violation (surfaces as HTTP 422).  \`kind\` names
    the refusing rung (None outside the precondition / invariant floor)."""

    def __init__(self, message: str, kind: DomainErrorKind | None = None) -> None:
        super().__init__(message)
        self.kind = kind`;
  const concurrencyError = hasVersioned
    ? `

class ConcurrencyError(Exception):
    """An optimistic-concurrency guard (the \`versioned\` capability) found the
    row's version no longer matched the caller's expected version — a competing
    write won the race (surfaces as HTTP 409; reload and retry)."""`
    : "";
  // An unfilled \`extern\` operation hook: answered 501 with the file to fill in
  // (an exception a user hook raises for any OTHER reason stays a 500).
  const externError = hasExtern
    ? `


class ExternNotImplementedError(NotImplementedError):
    """An \`extern\` operation's hook was never filled in (surfaces as HTTP 501,
    its message naming the file to write)."""`
    : "";
  return `"""Domain error types.  Auto-generated."""

from typing import Literal

# Which rung of the domain floor refused a call — carried apart from the
# message, which an authored \`message "..."\` replaces.
DomainErrorKind = Literal["precondition", "invariant"]


class DomainError(Exception):${domainErrorBody}${valueObjectInvariantError}


class AggregateNotFoundError(Exception):
    """An aggregate id resolved to no row (surfaces as HTTP 404)."""


class ForbiddenError(Exception):
    """An authorization guard rejected the caller (surfaces as HTTP 403)."""


class DisallowedError(Exception):
    """A \`when\` state gate rejected the operation in the aggregate's
    current state (surfaces as HTTP 409; the side-effect-free
    \`GET /{id}/can_<op>\` query reports the same predicate as
    \`{ allowed }\`)."""${concurrencyError}${externError}
`;
}
