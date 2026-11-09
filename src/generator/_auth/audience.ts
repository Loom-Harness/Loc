// The token-audience rule every OIDC verifier enforces.
//
// The runtime audience is `OIDC_AUDIENCE`, falling back to the declared
// `audience:` value.  What an EMPTY runtime value means depends on the model:
//
//   * no `audience:` declared — the `aud` check is skipped (the documented
//     single-client shape; `loom.auth-oidc-no-audience` warns about it);
//   * `audience:` declared — the verifier rejects EVERY token.  The model
//     promised audience isolation, so a deploy env that forgot the variable
//     (or set it to "") must fail closed, not silently accept tokens minted
//     for any other client of the same issuer.
//
// Five backends, one rule, one rejection reason — kept here so the verifiers
// cannot drift apart on either.

import type { AuthIR } from "../../ir/types/loom-ir.js";

/** True when the model declares `oidc { audience: … }` — an empty runtime
 *  audience then rejects every token instead of skipping the `aud` check. */
export function audienceDeclared(auth: AuthIR): boolean {
  return auth.oidc.audience !== undefined;
}

/** The reason a verifier logs (`auth_token_rejected`) when a declared audience
 *  resolves empty at runtime.  Names every variable that would supply it.
 *  Plain ASCII without quotes or backslashes, so each backend can embed it as a
 *  string literal with `JSON.stringify`. */
export function audienceUnsetReason(auth: AuthIR): string {
  const a = auth.oidc.audience;
  const vars =
    a?.kind === "env" && a.env !== "OIDC_AUDIENCE" ? `OIDC_AUDIENCE or ${a.env}` : "OIDC_AUDIENCE";
  return `oidc audience is declared but resolved empty: set ${vars}`;
}
