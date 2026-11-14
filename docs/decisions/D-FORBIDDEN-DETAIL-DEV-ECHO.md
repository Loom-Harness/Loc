# D-FORBIDDEN-DETAIL-DEV-ECHO — a 403 never names its gate; a malformed dev-claims header is a 400

**Status:** PINNED (owner rulings D4 and D6, 2026-09-29; eval-closure items #20
and #23). **D4 amended 2026-11-03 (#4473): DSL source never appears in a
response, under any verifier.** Node, .NET and Python have dropped the dev-stub
echo; Java and Phoenix follow in their #4473 fan-out slices, and until they land
they still echo under the dev stub.

**D4 — the 403 body.** Every `requires` gate throws `Forbidden: <gate source>`.
That text goes to the backend's `forbidden` log line and nowhere else. The RFC
7807 `detail` is the constant `Forbidden` on every deployable — dev-stub,
real verifier, or none — and the body carries the catalog `code`
`problem.forbidden` for a client to localize by. (The original ruling echoed the
gate under the dev-stub verifier, where naming the predicate is a useful
debugging answer; the owner withdrew that because a `.ddd` predicate is the
model's internals and the log line already serves a developer.) Every forbidden
response funnels through one place per backend (node `ForbiddenError.detail`,
.NET `DomainExceptionFilter`, Java `ApiExceptionAdvice`, Python
`install_error_handlers`, Phoenix `ProblemDetails.problem_response/4`); the ~21
throw sites are unchanged. `echoesDenialDetail` (`src/ir/util/denial-detail.ts`)
remains only for the backends still echoing; it is deleted with the last one.

**D6 — the dev-claims header.** A present, non-empty `x-loom-dev-claims` header
that does not decode to a base64 JSON **object** answers `400 Bad Request` with
the detail `malformed x-loom-dev-claims header: expected a base64-encoded JSON
object` on all five dev stubs, including a stub whose user shape has no
carryable claim. It used to fall back silently to the built-in identity.

**Scope choices recorded with them.** The Phoenix LiveView create form's denial
flash follows the same rule as the HTTP body.

**Affects.** `docs/auth.md` (§ requires gates, § Dev-stub verifier); the five
backends' error handlers and dev stubs; `test/generator/forbidden-detail-echo.test.ts`,
`test/generator/dev-claims-parity.test.ts`.
