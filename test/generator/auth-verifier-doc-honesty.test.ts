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
//
// UPDATED by Wave CR1 (P0-4), which answered the same finding from the other
// end.  This file's original premise was that an undeclared `audience:` cannot
// be checked AT ALL, so the honest thing was to say so and point at the `.ddd`.
// CR1-b made `AUDIENCE` emit unconditionally (`process.env.OIDC_AUDIENCE ?? ""`)
// and moved the decision to runtime — `VERIFY_OPTIONS = AUDIENCE ? … : …` — so
// the `aud` check is now reachable from the deploy env on node and elixir, the
// way it already was on dotnet/java/python.  Two consequences here:
//
//   * The emission assertions no longer pin an INLINE option literal, because
//     there isn't one.  They pin the ternary and the const it reads.
//   * The undeclared arm's comment is now "NOT verified BY DEFAULT", and names
//     BOTH remedies (set `OIDC_AUDIENCE`, or declare `audience:`).  The
//     substring this file greps for is deliberately still a prefix of it, so
//     the reviewer-facing wording the original gate chose survives.
//
// The SUBJECT is unchanged and is why the gate still earns its place: the doc
// comment must describe the options the file actually emits.  A third case is
// added below for the fact that now carries the security weight — `AUDIENCE` is
// emitted on BOTH arms — which nothing else pinned.

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
    // The emission this describes: options chosen at RUNTIME off an AUDIENCE
    // that is empty unless the deploy env fills it.  Empty ⇒ issuer only, which
    // is the case the comment has to be honest about.
    expect(ts).toContain(
      "const VERIFY_OPTIONS = AUDIENCE ? { issuer: ISSUER, audience: AUDIENCE } : { issuer: ISSUER };",
    );
    expect(ts).toContain("jwtVerify(token, await getJwks(), VERIFY_OPTIONS)");
    // …and the comment says so, in terms a reviewer can grep for.
    expect(ts).toContain("The `aud` claim is NOT verified");
    expect(ts).toContain('audience: env("OIDC_AUDIENCE")');
    // The false claim must be gone.
    expect(ts).not.toContain("validates signature (JWKS), issuer, and\n *  audience");
    // The undeclared arm must not claim the check is unreachable either — that
    // was true before CR1-b and is the failure mode this arm now guards: an
    // operator sent to edit the `.ddd` when setting the env var is enough.
    expect(ts).toContain("OIDC_AUDIENCE");
  });

  it("claims audience validation only when the model actually asks for it", async () => {
    const ts = await oidcTs('\n    audience: env("OIDC_AUDIENCE")');
    expect(ts).toContain(
      "const VERIFY_OPTIONS = AUDIENCE ? { issuer: ISSUER, audience: AUDIENCE } : { issuer: ISSUER };",
    );
    expect(ts).toContain("jwtVerify(token, await getJwks(), VERIFY_OPTIONS)");
    expect(ts).toContain("validates signature (JWKS), issuer and");
    // No scare text on the arm that really does check.
    expect(ts).not.toContain("The `aud` claim is NOT verified");
  });

  // The fact that now carries the security weight, and which nothing else pins:
  // `AUDIENCE` is emitted on BOTH arms, so `OIDC_AUDIENCE` in the deploy env
  // turns the check on WITHOUT regenerating.  Before CR1-b the undeclared arm
  // emitted no AUDIENCE const at all, and node was the one backend where an
  // operator could set OIDC_AUDIENCE in compose and get no `aud` check, no
  // error and no log line — the same model shipping enforceable isolation on
  // four backends and an unenforceable one on the fifth.  Asserting it on the
  // UNDECLARED arm is the whole point; the declared arm never lacked it.
  it("makes the audience env-reachable whether or not the model declares one", async () => {
    for (const audience of ["", '\n    audience: env("OIDC_AUDIENCE")']) {
      const ts = await oidcTs(audience);
      expect(ts).toMatch(/const AUDIENCE = process\.env\.OIDC_AUDIENCE \?\?/);
    }
  });
});
