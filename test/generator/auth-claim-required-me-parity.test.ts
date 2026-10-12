// Two auth-layer parity defects in the generated `user { … }` claim handling
// (claims eval, wave 2 — follow-ups of D16):
//
//   1. `/auth/me` and an id-typed claim.  node / python / elixir answer the
//      bare id string the token carried; .NET and java serialised the
//      strong-id record (no JSON converter / `@JsonValue` — the wire DTOs
//      carry the raw Guid/UUID), so the probe answered
//      `{"agentId": {"value": "…"}}`.
//   2. A REQUIRED `string` claim absent from the token.  node rejects the
//      token (`REQUIRED_CLAIMS`); .NET (`?? string.Empty`) and java
//      (`claimStringOrEmpty`) substituted "", and python / elixir checked no
//      user claim at all — a principal whose required `team` is ""/None.
//      Every backend now rejects (→ 401) over the same required set: the
//      non-optional, non-list fields.
//
// The realm half: the bundled Keycloak realm must keep seeding every required
// claim with a value, or the stricter verifiers 401 the demo users.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const src = (platform: string): string => `
system Desk {
  user {
    id: string
    role: string
    team: string
    nick: string?
    agentId: Agent id?
    homeAgent: Agent id
    agents: Agent id[]
  }
  auth {
    enforcement: opt
    provider: keycloak
    oidc {
      issuer: env("OIDC_ISSUER")
      clientId: env("OIDC_CLIENT_ID")
    }
  }
  subdomain Support {
    context Agents {
      aggregate Agent with crudish {
        name: string
      }
      repository Agents for Agent { }
    }
  }
  storage primary { type: postgres }
  resource agentState { for: Agents, kind: state, use: primary }
  deployable d {
    platform: ${platform}
    contexts: [Agents]
    dataSources: [agentState]
    port: 4000
    auth: required
  }
}
`;

function file(files: Map<string, string>, pattern: RegExp): string {
  for (const [k, v] of files) if (pattern.test(k)) return v;
  throw new Error(`no generated file matched ${pattern}`);
}

const REQUIRED = ["sub", "role", "team", "homeAgent"];

describe("auth parity: /auth/me id claims are bare; a required string claim is required", () => {
  it("node: the reference shape — REQUIRED_CLAIMS names every required scalar claim", async () => {
    const v = file(await generateSystemFiles(src("node")), /auth\/oidc\.ts$/);
    expect(v).toContain(
      `const REQUIRED_CLAIMS: readonly string[] = [${REQUIRED.map((p) => JSON.stringify(p)).join(", ")}];`,
    );
  });

  it("dotnet: a missing required string claim rejects; /auth/me unwraps id claims", async () => {
    const files = await generateSystemFiles(src("dotnet"));
    const v = file(files, /Auth\/OidcUserVerifier\.cs$/);
    expect(v).toContain('if (ClaimString(payload, "team") is not { } claimTeam)');
    expect(v).toContain(`return Rejected("required claim 'team' is absent or malformed");`);
    expect(v).toContain('if (ClaimString(payload, "sub") is not { } claimId)');
    expect(v).toContain("Team: claimTeam,");
    expect(v).toContain('Nick: ClaimString(payload, "nick"),');
    expect(v).not.toContain("?? string.Empty");
    const program = file(files, /(^|\/)Program\.cs$/);
    expect(program).toContain('["agentId"] = accessor.User.AgentId?.Value,');
    expect(program).toContain('["homeAgent"] = accessor.User.HomeAgent.Value,');
    expect(program).toContain('["agents"] = accessor.User.Agents.Select(v => v.Value).ToList(),');
    expect(program).toContain('["team"] = accessor.User.Team,');
  });

  it("java: a missing required string claim rejects; /auth/me unwraps id claims", async () => {
    const files = await generateSystemFiles(src("java"));
    const v = file(files, /auth\/OidcUserVerifier\.java$/);
    expect(v).toMatch(
      /String claimTeam = claimString\(payload, "team"\);\n\s+if \(claimTeam == null\) \{\n\s+CatalogLog\.event\([^)]*"required claim 'team' is absent or malformed"\);\n\s+return null;/,
    );
    expect(v).toContain('String claimId = claimString(payload, "sub");');
    expect(v).not.toContain("claimStringOrEmpty");
    const ctl = file(files, /auth\/AuthController\.java$/);
    expect(ctl).toContain(
      'body.put("agentId", user.agentId() == null ? null : user.agentId().value());',
    );
    expect(ctl).toContain(
      'body.put("agents", user.agents().stream().map(v -> v.value()).toList());',
    );
    expect(ctl).toContain('body.put("team", user.team());');
  });

  it("python: the verifier rejects a token missing a required claim", async () => {
    const v = file(await generateSystemFiles(src("python")), /app\/auth\/oidc\.py$/);
    expect(v).toContain(
      `_REQUIRED_CLAIMS: list[str] = [${REQUIRED.map((p) => JSON.stringify(p)).join(", ")}]`,
    );
    expect(v).toMatch(
      /for path in _REQUIRED_CLAIMS:\n\s+if _claim\(payload, path\) is None:\n[^\n]*\n\s+return None\n\s+return User\(/,
    );
  });

  it("elixir: require_claims rejects a token missing a required user claim", async () => {
    const v = file(await generateSystemFiles(src("elixir")), /_web\/auth\.ex$/);
    expect(v).toContain(
      `@required_user_claims [${REQUIRED.map((p) => JSON.stringify(p)).join(", ")}]`,
    );
    expect(v).toMatch(
      /defp require_claims\(claims\) do\n\s+if [^\n]*and required_user_claims\?\(claims\),/,
    );
    expect(v).toContain("Enum.all?(@required_user_claims, &(get_claim(claims, &1) != nil))");
  });

  it("the bundled realm seeds every required non-sub claim on the demo user", async () => {
    const realm = JSON.parse(
      file(await generateSystemFiles(src("node")), /keycloak\/realm\.json$/),
    ) as {
      clients: { protocolMappers?: { config: Record<string, string> }[] }[];
      users: { username: string; attributes?: Record<string, string[]> }[];
    };
    const mapped = new Set(
      realm.clients.flatMap((c) => (c.protocolMappers ?? []).map((m) => m.config["claim.name"])),
    );
    const demo = realm.users.find((u) => u.username === "demo");
    for (const claim of REQUIRED.filter((p) => p !== "sub")) {
      expect(mapped, claim).toContain(claim);
      expect(demo?.attributes?.[claim]?.[0], claim).toBeTruthy();
    }
  });
});
