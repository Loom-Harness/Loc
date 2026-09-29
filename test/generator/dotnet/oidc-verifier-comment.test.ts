// G8-04: the generated .NET OIDC verifier's doc comment claimed
// "checks iss / aud / exp" unconditionally, while the emitted code sets
// `ValidateAudience = Audience is not null` — with no `audience:` in the
// model, `aud` is checked only when OIDC_AUDIENCE is set at runtime.  The
// comment is what a reviewer auditing the auth control reads, so it must
// describe the checks the file actually performs.  Sibling of
// test/generator/auth-verifier-doc-honesty.test.ts (the Hono leg).

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = (audience: string) => `system S {
  user { id: string  role: string }
  auth {
    enforcement: opt
    oidc { issuer: env("OIDC_ISSUER") clientId: env("OIDC_CLIENT_ID")${audience} }
  }
  subdomain M { context C {
    aggregate Doc with crudish { title: string }
  } }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api {
    platform: dotnet
    contexts: [C]
    dataSources: [st]
    port: 3000
    auth: required
  }
}`;

async function verifierCs(audience: string): Promise<string> {
  const files = await generateSystemFiles(SRC(audience));
  return [...files.entries()].find(([k]) => k.endsWith("Auth/OidcUserVerifier.cs"))?.[1] ?? "";
}

describe("generated .NET OIDC verifier — the doc comment matches the emitted checks", () => {
  it("does not claim an unconditional aud check when the model declares no audience", async () => {
    const cs = await verifierCs("");
    expect(cs).toContain('Environment.GetEnvironmentVariable("OIDC_AUDIENCE")');
    expect(cs).toContain("ValidateAudience = Audience is not null");
    expect(cs).not.toContain("checks iss / aud / exp");
    expect(cs).toContain("checks iss / exp, and aud only when");
  });

  it("claims the aud check when the model declares an audience", async () => {
    const cs = await verifierCs('\n    audience: "my-api"');
    expect(cs).toContain("checks iss / aud / exp");
    expect(cs).not.toContain("aud only when");
  });
});
