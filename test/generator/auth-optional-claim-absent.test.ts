// H-10: an OPTIONAL user claim the token does not carry must reach the
// principal as the target's null — never `undefined`, never a stub default.
// Every backend lowers `requires currentUser.agentId != null` to a plain null
// test, so whatever the claim mapper produces for an ABSENT claim decides the
// gate.  Node projected `undefined` (`undefined !== null` → the gate passed for
// a customer token: 204 where 403 was due); java/.NET read the optional field's
// `optional`-wrapped type as "not a string" and never read the claim at all.
//
// The runtime half is the behavioural `auth-oidc` ladder ("absent optional
// claim" arm, all five legs); node's projection is also executed directly in
// `typescript/auth-oidc-codegen.test.ts`.  This file pins each backend's mapper
// shape so the arm's failure has an obvious address.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const src = (platform: string): string => `
system Helpdesk {
  user {
    id: string
    role: string
    permissions: string[]
    agentId: string?
    customerId: Ticket id?
  }
  auth {
    enforcement: opt
    provider: keycloak
    oidc {
      issuer: env("OIDC_ISSUER")
      clientId: env("OIDC_CLIENT_ID")
    }
    claims: { role: "realm_access.roles" }
  }
  subdomain Support {
    context Tickets {
      aggregate Ticket with crudish {
        subject: string
        operation take() {
          requires currentUser.agentId != null
        }
      }
      repository Tickets for Ticket { }
    }
  }
  storage primary { type: postgres }
  resource ticketState { for: Tickets, kind: state, use: primary }
  api SupportApi from Support
  deployable d {
    platform: ${platform}
    contexts: [Tickets]
    serves: SupportApi
    dataSources: [ticketState]
    port: 4000
    auth: required
  }
}
`;

function file(files: Map<string, string>, pattern: RegExp): string {
  for (const [k, v] of files) if (pattern.test(k)) return v;
  throw new Error(`no generated file matched ${pattern}`);
}

describe("an absent optional OIDC claim is null on every backend (H-10)", () => {
  it("node: optional claims fold absent onto null; a missing required scalar rejects", async () => {
    const oidc = file(await generateSystemFiles(src("node")), /auth\/oidc\.ts$/);
    expect(oidc).toContain('agentId: (claim(payload, "agentId") ?? null) as string | null,');
    expect(oidc).toContain(
      'customerId: (claim(payload, "customerId") ?? null) as Ids.TicketId | null,',
    );
    expect(oidc).toContain(
      'const REQUIRED_CLAIMS: readonly string[] = ["sub", "realm_access.roles"];',
    );
  });

  it("java: an optional string claim is READ (null when absent); an unmapped optional is null, not the zero id", async () => {
    const v = file(await generateSystemFiles(src("java")), /auth\/OidcUserVerifier\.java$/);
    expect(v).toContain('claimString(payload, "agentId")');
    expect(v).not.toContain("UUID(0L, 0L)");
    expect(v).toMatch(/claimString\(payload, "agentId"\),\n\s+null\n/);
  });

  it('dotnet: an optional string claim is READ; a JSON-null claim is null, not ""', async () => {
    const v = file(await generateSystemFiles(src("dotnet")), /Auth\/OidcUserVerifier\.cs$/);
    expect(v).toContain('AgentId: ClaimString(payload, "agentId"),');
    expect(v).toContain("CustomerId: default!");
    expect(v).toContain("if (current.ValueKind == JsonValueKind.Null) return null;");
  });

  it("python / elixir: the claim reader answers None / nil for a missing path", async () => {
    const py = file(await generateSystemFiles(src("python")), /auth\/oidc\.py$/);
    expect(py).toContain('agent_id=cast(str | None, _claim(payload, "agentId")),');
    const ex = file(await generateSystemFiles(src("elixir")), /_web\/auth\.ex$/);
    expect(ex).toContain('agent_id: get_claim(claims, "agentId"),');
  });
});
