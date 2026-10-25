// Ruling D4 (eval-closure item #20): a 403's `detail` echoes the failed gate's
// source ONLY under the dev-stub verifier.  With a real (OIDC) verifier the body
// is the constant `Forbidden`, and the gate text stays in the server's
// `forbidden` log line — before this, every backend told any caller the exact
// predicate it failed (`Forbidden: currentUser.role == "agent"`), in production.
//
// Each backend is pinned on BOTH halves, because either alone passes
// vacuously: the OIDC system's response arm carries the constant, AND the
// dev-stub system's arm still carries the gate text.  The log half is pinned
// too — a redacted body with a redacted log would lose the predicate entirely.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const system = (platform: string, oidc: boolean) => `
system Helpdesk {
  user { id: string  role: string }
  ${
    oidc
      ? `auth {
    provider: keycloak
    oidc { issuer: env("OIDC_ISSUER")  clientId: env("OIDC_CLIENT_ID")  audience: env("OIDC_AUDIENCE") }
  }`
      : ""
  }
  subdomain Support {
    context Tickets {
      aggregate Ticket {
        subject: string
        open: bool
        create(subject: string, open: bool) {
          requires currentUser.role == "agent"
        }
        operation close() {
          requires currentUser.role == "agent"
          open := false
        }
      }
      repository Tickets for Ticket {
        find all(): Ticket paged requires true
        find byId(id: Ticket id): Ticket? requires true
      }
    }
  }
  storage primary { type: postgres }
  resource st { for: Tickets, kind: state, use: primary }
  api SupportApi from Support
  deployable d {
    platform: ${platform}
    contexts: [Tickets]
    serves: SupportApi
    dataSources: [st]
    port: 4000
    auth: required
  }
}`;

async function all(platform: string, oidc: boolean): Promise<string> {
  const files = await generateSystemFiles(system(platform, oidc));
  return [...files.values()].join("\n\n");
}

/** Per backend: the 403 response arm under a real verifier (constant detail),
 *  the same arm under the dev stub (echoed gate text), and the log call that
 *  keeps the gate text in both. */
const ARMS: Record<string, { real: string[]; dev: string[]; log: string }> = {
  node: {
    real: ['this.detail = "Forbidden";', 'return problem(403, "Forbidden", err.detail);'],
    dev: ["this.detail = message;", 'return problem(403, "Forbidden", err.detail);'],
    log: 'event: "forbidden", aggregate: "Ticket", message: err.message, status: 403',
  },
  dotnet: {
    real: ['Problem(context, 403, "Forbidden", "Forbidden", trace_id);'],
    dev: ['Problem(context, 403, "Forbidden", fe.Message, trace_id);'],
    log: '"forbidden", fe.Message, 403',
  },
  java: {
    real: ['problem(403, "Forbidden", "Forbidden", request), 403'],
    dev: ['problem(403, "Forbidden", e.getMessage(), request), 403'],
    log: '"message", e.getMessage(), "status", 403',
  },
  python: {
    real: ['return problem(request, 403, "Forbidden", "Forbidden")'],
    dev: ['return problem(request, 403, "Forbidden", str(err))'],
    log: 'log("warn", "forbidden", message=str(err), status=403)',
  },
  elixir: {
    real: ['detail = if status == 403, do: "Forbidden", else: detail'],
    dev: [],
    log: 'Logger.warning("forbidden", event: "forbidden", message: detail, status: status)',
  },
};

describe("403 detail echoes the gate only under the dev-stub verifier (ruling D4, #20)", () => {
  for (const [platform, arm] of Object.entries(ARMS)) {
    it(`${platform}: a real verifier answers the constant, the dev stub echoes the gate`, async () => {
      const real = await all(platform, true);
      const dev = await all(platform, false);
      for (const s of arm.real) expect(real, `${platform} (oidc) lacks: ${s}`).toContain(s);
      for (const s of arm.dev) expect(dev, `${platform} (dev stub) lacks: ${s}`).toContain(s);
      // The gate text still reaches the server log under both verifiers.
      expect(real).toContain(arm.log);
      expect(dev).toContain(arm.log);
      // The thrown message itself is unchanged — it is what the log records.
      expect(real).toContain('Forbidden: currentUser.role == \\"agent\\"');
    });
  }

  it("elixir: the redaction is emitted only under a real verifier", async () => {
    expect(await all("elixir", false)).not.toContain('do: "Forbidden", else: detail');
  });

  it("node: no forbidden arm anywhere still answers err.message", async () => {
    const real = await all("node", true);
    expect(real).not.toMatch(
      /instanceof ForbiddenError\)[^\n]*problem\(403, "Forbidden", err\.message\)/,
    );
    expect(real).not.toMatch(
      /problem\(\w*[Ff]orbiddenStatus|problem\(403, "Forbidden", err\.message\)/,
    );
  });
});
