// The generated OIDC verifier's doc comment must describe the options it
// ACTUALLY emits.
//
// `audience:` is optional in the grammar (`ddd.langium`), appears in no
// `oidc { … }` example in the docs, and omitting it silently drops the `aud`
// check — `jwtVerify(token, jwks, { issuer: ISSUER })`.  The comment above that
// line nonetheless claimed "validates signature (JWKS), issuer, and audience"
// unconditionally.
//
// That combination is what makes it worth a gate rather than a one-line edit:
// reading the generated source is how an engineer audits an auth control, and a
// comment asserting a check the file does not perform defeats exactly that
// audit.  Confirmed live against a running generated API with a local JWKS
// issuer: a token minted by the SAME issuer for a DIFFERENT client
// (`aud: some-other-app`) returned 200.
//
// The fix is documentation, not behaviour — defaulting the audience to
// `clientId` would BREAK the generator's own Keycloak realm, whose access
// tokens carry `aud: account` unless an audience mapper is configured.  So the
// emitted comment now names the gap and the one-line model change that closes
// it, and this test pins both arms.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const SRC = (audience: string) => `system S {
  user { id: string  role: string }
  auth {
    oidc { issuer: env("OIDC_ISSUER") clientId: env("OIDC_CLIENT_ID")${audience} }
  }
  subdomain M { context C {
    aggregate Doc with crudish { title: string }
  } }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api {
    platform: node
    contexts: [C]
    dataSources: [st]
    port: 3000
    auth: required
  }
}`;

async function oidcTs(audience: string): Promise<string> {
  const files = await generateSystemFiles(SRC(audience));
  return [...files.entries()].find(([k]) => k.endsWith("auth/oidc.ts"))?.[1] ?? "";
}

describe("generated OIDC verifier — the doc comment matches the emitted options", () => {
  it("says `aud` is NOT verified when the model declares no audience", async () => {
    const ts = await oidcTs("");
    // The emission this describes: no audience option.
    expect(ts).toContain("jwtVerify(token, await getJwks(), { issuer: ISSUER })");
    // …and the comment says so, in terms a reviewer can grep for.
    expect(ts).toContain("The `aud` claim is NOT verified");
    expect(ts).toContain('audience: env("OIDC_AUDIENCE")');
    // The false claim must be gone.
    expect(ts).not.toContain("validates signature (JWKS), issuer, and\n *  audience");
  });

  it("claims audience validation only when the model actually asks for it", async () => {
    const ts = await oidcTs('\n    audience: env("OIDC_AUDIENCE")');
    expect(ts).toContain(
      "jwtVerify(token, await getJwks(), { issuer: ISSUER, audience: AUDIENCE })",
    );
    expect(ts).toContain("validates signature (JWKS), issuer and");
    // No scare text on the arm that really does check.
    expect(ts).not.toContain("The `aud` claim is NOT verified");
  });
});
