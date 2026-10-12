// An EMPTY OIDC audience skips the `aud` check on every backend, and every
// verifier says why it rejected a token (D7 of `eval-claims/FIX-PLAN.md`).
//
// docs/auth.md § "Token audience": when the audience resolves to nothing
// (`OIDC_AUDIENCE` unset or `""`) the `aud` check is skipped.  Node and elixir
// honoured that; three backends did not, each one differently:
//
//   * python read `os.environ.get("OIDC_AUDIENCE", "")` and gated
//     `verify_aud` on `_AUDIENCE is not None` — "" is not None, so PyJWT
//     verified every token against `aud == ""` and rejected ALL of them;
//   * .NET read `GetEnvironmentVariable(…) ?? ""` and gated `ValidateAudience`
//     on `Audience is not null` — the same shape, the same total 401;
//   * java handed an explicit `OIDC_AUDIENCE=""` straight to Nimbus, which then
//     demands `aud == ""`.
//
// And every verifier swallowed the exception to keep the 401 a 401, so the
// service logged nothing at all — the claims eval spent its time on a 401 with
// no trace.  Each verifier now logs the catalog's `auth_token_rejected` at
// debug with the reason.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const SRC = (platform: string) => `system S {
  user { id: string  role: string }
  auth {
    enforcement: opt
    oidc { issuer: env("OIDC_ISSUER") clientId: env("OIDC_CLIENT_ID") audience: env("OIDC_AUDIENCE") }
  }
  subdomain M { context C {
    aggregate Doc with crudish { title: string }
    repository Docs for Doc { }
  } }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api {
    platform: ${platform}
    contexts: [C]
    dataSources: [st]
    port: 4000
    auth: required
  }
}
`;

async function file(platform: string, suffix: string): Promise<string> {
  const files = await generateSystemFiles(SRC(platform));
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix));
  if (!hit) throw new Error(`no emitted file ends with '${suffix}'`);
  return hit[1];
}

describe("OIDC audience — an empty value skips the aud check (the documented opt-out)", () => {
  it("python: '' folds to None, so verify_aud is off", async () => {
    const src = await file("python", "app/auth/oidc.py");
    expect(src).toContain('_AUDIENCE: str | None = (os.environ.get("OIDC_AUDIENCE", "")) or None');
    expect(src).toContain('options={"verify_aud": _AUDIENCE is not None}');
  });

  it("dotnet: ValidateAudience tests for empty, not just null", async () => {
    const src = await file("dotnet", "Auth/OidcUserVerifier.cs");
    expect(src).toContain("ValidateAudience = !string.IsNullOrEmpty(Audience),");
    expect(src).not.toContain("ValidateAudience = Audience is not null");
  });

  it("java: '' folds to null before Nimbus sees it", async () => {
    const src = await file("java", "auth/OidcUserVerifier.java");
    expect(src).toContain(
      "String audience = AUDIENCE == null || AUDIENCE.isEmpty() ? null : AUDIENCE;",
    );
    expect(src).toContain("new DefaultJWTClaimsVerifier<>(audience, exactMatch,");
  });

  it("node: an empty AUDIENCE drops the audience option", async () => {
    const src = await file("node", "auth/oidc.ts");
    expect(src).toContain(
      "const VERIFY_OPTIONS = AUDIENCE ? { issuer: ISSUER, audience: AUDIENCE } : { issuer: ISSUER };",
    );
  });

  it('elixir: aud presence is required only for a non-"" audience', async () => {
    const src = await file("elixir", "_web/auth.ex");
    expect(src).toMatch(/case audience\(\) do\s+"" -> true/);
  });
});

describe("OIDC verifier — a rejected token is logged at debug, not swallowed silently", () => {
  it("node", async () => {
    const src = await file("node", "auth/oidc.ts");
    expect(src).toContain('requestLog().debug({ event: "auth_token_rejected", reason:');
    expect(src).toContain('import { requestLog } from "../obs/als";');
  });

  it("python", async () => {
    const src = await file("python", "app/auth/oidc.py");
    expect(src).toContain('log("debug", "auth_token_rejected", reason=str(err))');
    expect(src).toContain("from app.obs.log import log");
  });

  it("dotnet", async () => {
    const src = await file("dotnet", "Auth/OidcUserVerifier.cs");
    expect(src).toContain(
      '_log.LogDebug("{Event} reason={Reason}", "auth_token_rejected", reason);',
    );
    expect(src).toContain("return Rejected(result.Exception?.Message");
  });

  it("java", async () => {
    const src = await file("java", "auth/OidcUserVerifier.java");
    expect(src).toContain('CatalogLog.event("auth_token_rejected", "debug", "reason",');
  });

  it("elixir", async () => {
    const src = await file("elixir", "_web/auth.ex");
    expect(src.match(/Logger\.debug\("auth_token_rejected"/g)?.length).toBe(2);
  });
});
