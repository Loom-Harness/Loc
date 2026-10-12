// An identifier claim (`guid`, `X id`) reaches the principal only in its wire
// format.  A signed token can still carry `owner: "demo-owner"` for a
// `Ticket id`: passed through raw it is non-null, so `requires currentUser.x
// != null` admits it and the first query that uses it fails.  The .NET and Java
// verifiers get this from their typed decode; node, python and elixir check the
// format (`src/generator/_auth/claim-decode.ts`) and apply the same rule:
//
//   optional, absent or malformed → null / None / nil
//   required, absent or malformed → token rejected (401)
//   list                          → malformed elements dropped
//
// node's projection is executed in `typescript/auth-oidc-codegen.test.ts`.
// python's is executed here under `python3` — the emitted helpers and the
// emitted required-claim loop, not a re-implementation.  elixir has no
// toolchain in this tier, so its emitted shape is pinned.

import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const UUID = "00000000-0000-0000-0000-0000000000c1";

const src = (platform: string): string => `
system Helpdesk {
  user {
    id: string
    role: string
    permissions: string[]
    owner: Ticket id
    watched: Ticket id[]
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
          requires currentUser.customerId != null
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

function between(text: string, start: string, end: string): string {
  const a = text.indexOf(start);
  const b = text.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error(`no ${start} … ${end} in the emitted module`);
  return text.slice(a, b);
}

const python3 = spawnSync("python3", ["--version"]).status === 0;

describe("an identifier claim reaches the principal only in its wire format", () => {
  it.skipIf(!python3)(
    "python: the emitted helpers + required-claim loop decide accept / reject",
    async () => {
      const oidc = file(await generateSystemFiles(src("python")), /auth\/oidc\.py$/);
      // The emitted `_claim` … helpers block, the emitted required-claim loop and
      // the emitted `User(...)` kwargs, run as one function over a payload.
      const helpers = between(oidc, "def _claim(", "\ndef _token_from(");
      const body = between(
        oidc,
        "    for path, fmt in _REQUIRED_CLAIMS:",
        "\n\ndef register_oidc_verifier",
      ).replace("return User(", "return dict(");
      const program = `import json, re, sys
from typing import Any, cast
TicketId = str
def log(*_a: Any, **_k: Any) -> None: pass
${helpers}
def verify(payload: dict[str, Any]) -> Any:
${body}
cases = json.load(sys.stdin)
print(json.dumps([verify(p) for p in cases]))
`;
      const base = { sub: "u1", realm_access: { roles: "agent" }, owner: UUID };
      const cases = [
        { ...base, customerId: "c-1", watched: [UUID, "nope", 7] },
        { ...base, customerId: UUID },
        { ...base, customerId: `${UUID}\n` },
        { ...base, owner: "demo-owner" },
        { sub: "u1", realm_access: { roles: "agent" } },
        { ...base, sub: undefined },
      ];
      const run = spawnSync("python3", ["-I", "-c", program], {
        input: JSON.stringify(cases),
        encoding: "utf8",
      });
      expect(run.stderr).toBe("");
      const [malformed, wellFormed, trailingNewline, badRequired, absentRequired, noSub] =
        JSON.parse(run.stdout);
      expect(malformed).toMatchObject({ customer_id: null, watched: [UUID], owner: UUID });
      expect(wellFormed).toMatchObject({ customer_id: UUID });
      expect(trailingNewline).toMatchObject({ customer_id: null });
      expect(badRequired, "required id malformed").toBeNull();
      expect(absentRequired, "required id absent").toBeNull();
      expect(noSub, "required string claim absent").toBeNull();
    },
  );

  it("elixir: build_user decodes, and a required claim gates verify_token", async () => {
    const auth = file(await generateSystemFiles(src("elixir")), /_web\/auth\.ex$/);
    expect(auth).toContain('customer_id: claim_as(get_claim(claims, "customerId"), :uuid)');
    expect(auth).toContain('owner: claim_as(get_claim(claims, "owner"), :uuid)');
    expect(auth).toContain('watched: claim_list(get_claim(claims, "watched"), :uuid)');
    expect(auth).toContain(
      '@required_user_claims [{"sub", nil}, {"realm_access.roles", nil}, {"owner", :uuid}]',
    );
    expect(auth).toMatch(/and\s+user_claims_present\?\(claims\)/);
    // `$` would also accept a trailing newline; the anchor is \z.
    expect(auth).toContain("{12}\\z/, value), do: value, else: nil");
  });

  it("a shape with no identifier claim emits no decoder (string-only output unchanged)", async () => {
    const plain = (p: string) =>
      src(p).replace(
        / {4}owner: Ticket id\n {4}watched: Ticket id\[\]\n {4}customerId: Ticket id\?\n/,
        "    customerId: string?\n",
      );
    const node = file(await generateSystemFiles(plain("node")), /auth\/oidc\.ts$/);
    const py = file(await generateSystemFiles(plain("python")), /auth\/oidc\.py$/);
    const ex = file(await generateSystemFiles(plain("elixir")), /_web\/auth\.ex$/);
    expect(node).not.toContain("claimAs");
    expect(py).not.toContain("_claim_as");
    expect(py).not.toMatch(/^import re$/m);
    expect(ex).not.toContain("claim_as");
  });
});
