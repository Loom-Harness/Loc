// Phase-⑦ diagnostics that had no `origin` printed with no `path:line`, and the
// by-id read-gate warning carried the CONTEXT's origin — so every aggregate's
// warning pointed at one `context` line.  Each now carries the span of the
// node it is about: the retrieval, the repository (list read), the aggregate
// (by-id read), the page reading `currentUser`.  Pinned on the `validate()`
// wire range, which resolves the same `origin` the CLI prefix does.

import { describe, expect, it } from "vitest";
import { validate } from "../../src/api/index.js";

// 0-based lines (the wire shape) — see the comments on each declaration.
const SOURCE = `system Help {
  user { sub: string, role: string }
  auth {
    oidc { issuer: env("OIDC_ISSUER"), clientId: env("OIDC_CLIENT_ID") }
    enforcement: denyByDefault
  }
  subdomain D {
    context Desk {
      aggregate Ticket {
        title: string
        create(title: string) { requires currentUser.sub != "" }
      }
      aggregate Agent {
        name: string
        create(name: string) { requires currentUser.sub != "" }
      }
      repository Tickets for Ticket { }
      retrieval Recent() of Ticket {
        where: title != ""
        sort: [nope desc]
      }
    }
  }
  api A from D
  storage pg { type: postgres }
  resource deskState { for: Desk, kind: state, use: pg }
  deployable d {
    platform: node
    contexts: [Desk]
    dataSources: [deskState]
    serves: A
    port: 4000
    auth: required
  }
  ui Web {
    page Secret { route: "/secret" requires currentUser.role == "agent" body: Heading { "secret" } }
  }
  deployable web { platform: react targets: d ui: Web port: 3001 }
}
`;
const line = (needle: string) => SOURCE.split("\n").findIndex((l) => l.includes(needle));

describe("IR diagnostics point at the node they are about", () => {
  it("each code resolves to its declaring line", async () => {
    const report = await validate(SOURCE);
    const at = (code: string, source?: string) =>
      report.diagnostics.find((d) => d.code === code && (!source || d.message.includes(source)))
        ?.range?.start.line;

    expect(at("loom.retrieval-sort-unknown-field"), "retrieval").toBe(line("retrieval Recent"));
    expect(at("loom.current-user-needs-auth-ui"), "page").toBe(line("page Secret"));
    // By-id: each aggregate's own line, not the shared `context Desk` line.
    expect(at("loom.default-deny-by-id-ungated", "'Ticket'"), "by-id Ticket").toBe(
      line("aggregate Ticket"),
    );
    expect(at("loom.default-deny-by-id-ungated", "'Agent'"), "by-id Agent").toBe(
      line("aggregate Agent"),
    );
    // List read: the repository, where the silencing `find all … requires`
    // goes; an aggregate with no repository points at itself.
    expect(at("loom.default-deny-list-ungated", "'Ticket'"), "list Ticket").toBe(
      line("repository Tickets"),
    );
    expect(at("loom.default-deny-list-ungated", "'Agent'"), "list Agent").toBe(
      line("aggregate Agent"),
    );
  });
});
