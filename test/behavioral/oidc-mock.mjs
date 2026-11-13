// The behavioural tier's OIDC issuer: the emulated provider behind the Node
// kit's loopback host (test/support/fakes/oidc.mjs), configured with the
// tier's two principals.  The generated verifier validates its tokens through
// the real discovery + JWKS path (no dev-stub short-circuit), and the generated
// login handshake completes against its authorization and token endpoints.

import { start } from "../support/fakes/oidc.mjs";

/** The tier's principals.  `agent` satisfies every `auth-oidc` gate; `visitor`
 *  is authenticated but not authorized — same issuer, same key, same `sub`
 *  shape, so a 403 from it cannot be a verifier failure (which is a 401). */
export const BEHAVIOURAL_PERSONAS = [
  {
    username: "agent",
    claims: {
      sub: "00000000-0000-0000-0000-000000000000",
      realm_access: { roles: "agent" },
      email: "agent@example.com",
      permissions: ["close"],
      // The optional claim `take()` is gated on (`auth-oidc.ddd`); `visitor`
      // OMITS it — an absent optional claim must read as null.
      agentId: "agent-1",
      // The optional `Ticket id?` claim `assign()` is gated on; `visitor`
      // carries a malformed one, which must read as null.
      assignee: "00000000-0000-0000-0000-0000000000a1",
    },
  },
  {
    username: "visitor",
    claims: {
      sub: "00000000-0000-0000-0000-0000000000ff",
      realm_access: { roles: "visitor" },
      email: "visitor@example.com",
      permissions: [],
      assignee: "not-a-uuid",
    },
  },
];

/** Start the issuer.  `issuer` / `env` → the backend's OIDC env; `token` →
 *  E2E_BEARER_TOKEN (the authorized principal); `unauthorizedToken` → the
 *  authenticated-but-not-authorized one.  The authorization endpoint signs
 *  `agent` in without a login page. */
export async function startMockIssuer() {
  const fake = await start({ personas: BEHAVIOURAL_PERSONAS, autoLogin: "agent" });
  return {
    ...fake,
    token: await fake.mint("agent"),
    unauthorizedToken: await fake.mint("visitor"),
  };
}
