// What an EMPTY OIDC audience means is the same on every backend, and every
// verifier says why it rejected a token.
//
// docs/auth.md § "Token audience": when the model declares NO `audience:` and
// `OIDC_AUDIENCE` is unset or `""`, the `aud` check is skipped.  When the model
// DECLARES one, an empty runtime value rejects every token (fail closed): a
// deploy env that forgot the variable must not silently accept tokens minted
// for another client of the same issuer.
//
// The skip half has to fold "" correctly, and three backends once did not:
//
//   * python read `os.environ.get("OIDC_AUDIENCE", "")` and gated
//     `verify_aud` on `_AUDIENCE is not None` — "" is not None, so PyJWT
//     verified every token against `aud == ""` and rejected ALL of them;
//   * .NET read `GetEnvironmentVariable(…) ?? ""` and gated `ValidateAudience`
//     on `Audience is not null` — the same shape, the same total 401;
//   * java handed an explicit `OIDC_AUDIENCE=""` straight to Nimbus, which then
//     demands `aud == ""`.
//
// The fail-closed half needs an explicit guard, because jose and PyJWT both
// treat an empty / None audience as "do not check".
//
// Every verifier swallows the exception to keep the 401 a 401, so each logs the
// catalog's `auth_token_rejected` at debug with the reason.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const DECLARED = ' audience: env("OIDC_AUDIENCE")';

/** The rejection reason every backend logs (src/generator/_auth/audience.ts). */
const UNSET = "oidc audience is declared but resolved empty: set OIDC_AUDIENCE";

const SRC = (platform: string, audience: string) => `system S {
  user { id: string  role: string }
  auth {
    enforcement: opt
    oidc { issuer: env("OIDC_ISSUER") clientId: env("OIDC_CLIENT_ID")${audience} }
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

async function file(platform: string, suffix: string, audience = DECLARED): Promise<string> {
  const files = await generateSystemFiles(SRC(platform, audience));
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix));
  if (!hit) throw new Error(`no emitted file ends with '${suffix}'`);
  return hit[1];
}

/** `src` contains `guard`, and it comes before `later` (the verification call). */
function expectGuardBefore(src: string, guard: string, later: string): void {
  expect(src).toContain(guard);
  expect(src).toContain(later);
  expect(src.indexOf(guard)).toBeLessThan(src.indexOf(later));
}

describe("OIDC audience — undeclared: an empty value skips the aud check (the opt-out)", () => {
  it("python: '' folds to None, so verify_aud is off", async () => {
    const src = await file("python", "app/auth/oidc.py", "");
    expect(src).toContain('_AUDIENCE: str | None = (os.environ.get("OIDC_AUDIENCE")) or None');
    expect(src).toContain('options={"verify_aud": _AUDIENCE is not None}');
    expect(src).not.toContain(UNSET);
  });

  it("dotnet: ValidateAudience tests for empty, not just null", async () => {
    const src = await file("dotnet", "Auth/OidcUserVerifier.cs", "");
    expect(src).toContain("ValidateAudience = !string.IsNullOrEmpty(Audience),");
    expect(src).not.toContain("ValidateAudience = Audience is not null");
    expect(src).not.toContain(UNSET);
  });

  it("java: '' folds to null before Nimbus sees it", async () => {
    const src = await file("java", "auth/OidcUserVerifier.java", "");
    expect(src).toContain(
      "String audience = AUDIENCE == null || AUDIENCE.isEmpty() ? null : AUDIENCE;",
    );
    expect(src).toContain("new DefaultJWTClaimsVerifier<>(audience, exactMatch,");
    expect(src).not.toContain(UNSET);
  });

  it("node: an empty AUDIENCE drops the audience option", async () => {
    const src = await file("node", "auth/oidc.ts", "");
    expect(src).toContain(
      "const VERIFY_OPTIONS = AUDIENCE ? { issuer: ISSUER, audience: AUDIENCE } : { issuer: ISSUER };",
    );
    expect(src).not.toContain(UNSET);
  });

  it('elixir: aud presence is required only for a non-"" audience', async () => {
    const src = await file("elixir", "_web/auth.ex", "");
    expect(src).toMatch(/case audience\(\) do\s+"" -> true/);
    expect(src).not.toContain("audience_configured");
  });
});

describe("OIDC audience — declared: an empty value rejects every token (fail closed)", () => {
  it("node: refuses before jwtVerify (jose skips aud for an empty option)", async () => {
    const src = await file("node", "auth/oidc.ts");
    expect(src).toContain("const VERIFY_OPTIONS = { issuer: ISSUER, audience: AUDIENCE };");
    expectGuardBefore(
      src,
      `if (!AUDIENCE) {\n    requestLog().debug({ event: "auth_token_rejected", reason: "${UNSET}" });\n    return null;\n  }`,
      "await jwtVerify(",
    );
  });

  it("dotnet: rejects before token validation", async () => {
    const src = await file("dotnet", "Auth/OidcUserVerifier.cs");
    expectGuardBefore(
      src,
      `if (string.IsNullOrEmpty(Audience))\n        {\n            return Rejected("${UNSET}");\n        }`,
      "Handler.ValidateTokenAsync(",
    );
  });

  it("java: rejects before the Nimbus processor runs", async () => {
    const src = await file("java", "auth/OidcUserVerifier.java");
    expectGuardBefore(
      src,
      `if (AUDIENCE == null || AUDIENCE.isEmpty()) {\n            CatalogLog.event("auth_token_rejected", "debug", "reason", "${UNSET}");\n            return null;\n        }`,
      "processor().process(",
    );
  });

  it("python: rejects when the audience folded to None", async () => {
    const src = await file("python", "app/auth/oidc.py");
    expectGuardBefore(src, "    if _AUDIENCE is None:\n", "jwt.decode(");
    expectGuardBefore(src, `reason="${UNSET}",\n        )\n        return None`, "jwt.decode(");
  });

  it("elixir: the first `with` step rejects an empty audience()", async () => {
    const src = await file("elixir", "_web/auth.ex");
    expect(src).toMatch(/with :ok <- audience_configured\(\),\s+\{:ok, claims\} <- /);
    expect(src).toContain(
      `defp audience_configured do\n    case audience() do\n      "" -> {:error, "${UNSET}"}\n      _ -> :ok\n    end\n  end`,
    );
  });

  it("names the declared variable when it is not OIDC_AUDIENCE", async () => {
    const src = await file("node", "auth/oidc.ts", ' audience: env("API_AUD")');
    expect(src).toContain("set OIDC_AUDIENCE or API_AUD");
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
