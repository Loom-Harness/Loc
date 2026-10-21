// D16 (claims eval): the generated .NET and java OIDC verifiers decoded only
// `string` / `string[]` claims.  Every other declared `user { … }` field —
// `Agent id?`, `guid`, `int`, `long`, `bool`, `datetime`, `decimal`,
// `Agent id[]` — was hard-wired to `default!` (.NET) or the stub value / null
// (java), so it was null-or-zero for EVERY token however valid its claim.
// `requires assignedTo == currentUser.agentId` was therefore always false on
// those two backends (403 forever), and a `!=` gate always true, while
// node / python / elixir read the claim.
//
// This pins each backend's emitted claim decoding:
//   - an optional typed claim decodes to the value, null when absent /
//     undecodable (never the zero id — `!= null` would pass for every token);
//   - a REQUIRED typed claim that is absent / undecodable rejects the token
//     (→ 401), node's `REQUIRED_CLAIMS` semantics;
//   - an `X id` claim is constructed through the emitted strong-id type, so the
//     verifier imports the domain ids namespace.
// The compile half (dotnet build /warnaserror, gradle testClasses) and the
// Keycloak runtime half are recorded on the PR.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const src = (platform: string): string => `
system Desk {
  user {
    id: string
    role: string
    agentId: Agent id?
    homeAgent: Agent id
    org: guid?
    level: int
    big: long?
    admin: bool
    since: datetime?
    limit: decimal?
    agents: Agent id[]
  }
  auth {
    enforcement: opt
    oidc {
      issuer: env("OIDC_ISSUER")
      clientId: env("OIDC_CLIENT_ID")
    }
    claims: { agentId: "ext.agent" }
  }
  subdomain Support {
    context Agents {
      aggregate Agent with crudish {
        name: string
        operation take() {
          requires currentUser.agentId == id
        }
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

describe("D16: .NET / java OIDC verifiers decode every typed user claim", () => {
  it("dotnet: id / guid / int / long / bool / datetime / decimal / id[] claims are decoded", async () => {
    const v = file(await generateSystemFiles(src("dotnet")), /Auth\/OidcUserVerifier\.cs$/);
    // Optional: decoded, null when absent.  A mapped claim path is honoured.
    expect(v).toContain(
      'AgentId: ClaimAs<AgentId>(payload, "ext.agent", e => AsGuid(e) is { } v ? new AgentId(v) : null),',
    );
    expect(v).toContain('Org: ClaimAs<Guid>(payload, "org", AsGuid),');
    expect(v).toContain('Big: ClaimAs<long>(payload, "big", AsLong),');
    expect(v).toContain('Since: ClaimAs<DateTime>(payload, "since", AsDateTime),');
    expect(v).toContain('Limit: ClaimAs<decimal>(payload, "limit", AsDecimal),');
    // Required: absent / malformed rejects the token, else the decoded value.
    expect(v).toContain(
      'if (ClaimAs<AgentId>(payload, "homeAgent", e => AsGuid(e) is { } v ? new AgentId(v) : null) is not { } claimHomeAgent)',
    );
    expect(v).toContain(`return Rejected("required claim 'homeAgent' is absent or malformed");`);
    expect(v).toContain('if (ClaimAs<int>(payload, "level", AsInt) is not { } claimLevel)');
    expect(v).toContain('if (ClaimAs<bool>(payload, "admin", AsBool) is not { } claimAdmin)');
    expect(v).toContain("HomeAgent: claimHomeAgent,");
    expect(v).toContain("Level: claimLevel,");
    // A required list: decoded element-wise, the empty list when absent.
    expect(v).toContain(
      'Agents: ClaimList<AgentId>(payload, "agents", e => AsGuid(e) is { } v ? new AgentId(v) : null) ?? new System.Collections.Generic.List<AgentId>()',
    );
    // No declared claim falls back to the type default any more.
    expect(v).not.toContain("default!");
    // The strong id lives in Domain.Ids; the helpers are emitted.
    expect(v).toMatch(/^using \w+\.Domain\.Ids;$/m);
    expect(v).toContain("private static Guid? AsGuid(JsonElement e)");
    expect(v).toContain("private static DateTime? AsDateTime(JsonElement e)");
  });

  it("java: id / guid / int / long / bool / datetime / decimal / id[] claims are decoded", async () => {
    const v = file(await generateSystemFiles(src("java")), /auth\/OidcUserVerifier\.java$/);
    expect(v).toContain('claimAs(payload, "ext.agent", v -> mapOrNull(asUuid(v), AgentId::new))');
    expect(v).toContain('claimAs(payload, "org", OidcUserVerifier::asUuid)');
    expect(v).toContain('claimAs(payload, "big", OidcUserVerifier::asLong)');
    expect(v).toContain('claimAs(payload, "since", OidcUserVerifier::asInstant)');
    expect(v).toContain('claimAs(payload, "limit", OidcUserVerifier::asDecimal)');
    expect(v).toContain(
      'AgentId claimHomeAgent = claimAs(payload, "homeAgent", v -> mapOrNull(asUuid(v), AgentId::new));',
    );
    expect(v).toContain('Integer claimLevel = claimAs(payload, "level", OidcUserVerifier::asInt);');
    expect(v).toContain(
      'Boolean claimAdmin = claimAs(payload, "admin", OidcUserVerifier::asBool);',
    );
    expect(v).toMatch(
      /if \(claimLevel == null\) \{\n\s+CatalogLog\.event\([^)]*"required claim 'level' is absent or malformed"\);\n\s+return null;/,
    );
    expect(v).toContain(
      'orEmpty(claimList(payload, "agents", v -> mapOrNull(asUuid(v), AgentId::new)))',
    );
    // No hard-wired zero id / zero / false stands in for a declared claim.
    expect(v).not.toContain("UUID(0L, 0L)");
    expect(v).not.toMatch(/^\s+(0|false|null),?$/m);
    expect(v).toMatch(/^import [\w.]+\.domain\.ids\.\*;$/m);
    expect(v).toContain("import java.util.function.Function;");
  });

  it("a string-only claim shape keeps its output: no typed helpers, no ids import", async () => {
    const plain = src("dotnet")
      .replace(/user \{[\s\S]*?\n {2}\}/, "user {\n    id: string\n    role: string\n  }")
      .replace('claims: { agentId: "ext.agent" }', "")
      .replace("requires currentUser.agentId == id", 'requires currentUser.role == "a"');
    const cs = file(await generateSystemFiles(plain), /Auth\/OidcUserVerifier\.cs$/);
    expect(cs).not.toContain("ClaimAs<");
    expect(cs).not.toContain("Domain.Ids");
    const java = file(
      await generateSystemFiles(plain.replace("platform: dotnet", "platform: java")),
      /auth\/OidcUserVerifier\.java$/,
    );
    expect(java).not.toContain("claimAs(");
    expect(java).not.toContain("domain.ids");
  });
});
