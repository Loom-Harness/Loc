// What a 403 tells the caller (ruling D4, eval-closure item #20).
//
// Every `requires` gate denies with `Forbidden: <the gate's source text>` — the
// message the thrown ForbiddenError / ForbiddenException / `{:forbidden, msg}`
// term carries, and the one each backend's `forbidden` log line records.  Until
// D4 that message was ALSO the RFC 7807 `detail` on the wire, on every backend
// and under every verifier, so a production API told any caller the exact
// predicate it failed (`Forbidden: currentUser.role == "agent"`).
//
// The ruling: the predicate stays in the body under DEV-STUB auth (the
// permissive verifier a deployable gets from `auth: required` + a `user { … }`
// block WITHOUT an `auth { oidc … }` block — a playground/curl setting where the
// echo is the useful debugging answer); otherwise the body is the constant
// `Forbidden` and the predicate lives only in the server log line.
//
// "Otherwise" includes a deployable with no verifier at all (no `auth:
// required`) — that is not dev-stub auth, so it gets the constant too.
//
// Derived on demand from the two facts that already pick the verifier each
// backend emits (`authRequired && !sys.auth` → the dev stub), so the 403 body
// can never disagree with the verifier actually shipped.

/** The constant `detail` a 403 answers with when the gate is not echoed. */
export const CONSTANT_FORBIDDEN_DETAIL = "Forbidden";

/** True when this deployable runs the DEV-STUB verifier — `auth: required`, a
 *  `user { … }` block, and no `auth { oidc … }` block.  Exactly the condition
 *  under which the five backends emit their permissive stub instead of the
 *  generated OIDC verifier, and so exactly when a 403 may echo its gate. */
export function echoesDenialDetail(
  deployable: { auth?: { required: boolean } } | undefined,
  sys: { user?: unknown; auth?: unknown } | undefined,
): boolean {
  return !!(deployable?.auth?.required && sys?.user && !sys.auth);
}
