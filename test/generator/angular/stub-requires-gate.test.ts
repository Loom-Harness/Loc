// Angular page `requires` guard on a parameterised-read page (D-AUTH-OIDC).  A
// gated page must render a `<Forbidden>` fallback when the currentUser-only gate
// fails — otherwise the page chrome leaks to an unauthorized user.  This page
// reads a parameterised criterion through its `scaffoldPaged` find
// (`Ticket.findAllByOpen("open")`), which the Angular generator renders as a
// REAL body (the `use<Find><Agg>` factory), so the gate wraps the walked
// QueryView rather than the legacy stub.  Other walkable gated bodies are
// covered by page-requires-gate.test.ts.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SYS = (opts: { authUi: boolean }) => `
system Helpdesk {
  user { id: string role: string }
  auth { enforcement: opt, provider: keycloak oidc { issuer: env("OIDC_ISSUER") clientId: env("OIDC_CLIENT_ID") } }
  subdomain Support {
    context Tickets with scaffoldPaged(of: Open) {
      aggregate Ticket with crudish { subject: string  status: string }
      repository Tickets for Ticket
      criterion Open(status: string) of Ticket = this.status == status
    }
  }
  storage primary { type: postgres }
  resource st { for: Tickets, kind: state, use: primary }
  api SupportApi with scaffoldPagedApi(of: Open) from Support
  deployable api { platform: node contexts: [Tickets] serves: SupportApi dataSources: [st] port: 8080 auth: required }
  ui WebApp {
    api Support: SupportApi
    page AdminQ {
      route: "/admin/q"
      requires currentUser.role == "manager"
      body: QueryView { of: Ticket.findAllByOpen("open"), data: rows => Heading { "rows" } }
    }
  }
  deployable web { platform: angular targets: api ui: WebApp { Support: api } port: 3001${opts.authUi ? " auth: ui" : ""} }
}
`;

async function gatedPage(authUi: boolean): Promise<string> {
  const files = await generateSystemFiles(SYS({ authUi }));
  return files.get("web/src/app/pages/admin-q.component.ts")!;
}

describe("angular parameterised-read requires gate", () => {
  it("gates the walked body with @if/@else Forbidden + injects the session", async () => {
    const page = await gatedPage(true);
    // It is a REAL body (the parameterised read is wired), not the stub.
    expect(page).not.toContain("stub — body needs api/forms support");
    expect(page).toContain('import { useFindAllByOpenTicket } from "../../api/ticket";');
    expect(page).toContain(
      'readonly ticketFindAllByOpen = useFindAllByOpenTicket(() => ({ status: "open", page: 1, pageSize: 20, sort: "id", dir: "asc" }));',
    );
    // …gated by the currentUser-only `requires` predicate.
    expect(page).toContain('import { SessionService } from "../auth/session.service";');
    expect(page).toContain("readonly session = inject(SessionService);");
    expect(page).toContain('@if (currentUser.role === "manager") {');
    expect(page).toContain("<h2>Forbidden</h2>");
  });

  it("rejects the currentUser gate without auth: ui (the silent drop is closed)", async () => {
    // This used to assert the page emitted UNGUARDED — an access check declared
    // in the model and silently absent from the output.  Phase ⑦ now refuses
    // the model instead (`requires` joined the currentUser-read placements),
    // so the unguarded page is output no user can obtain.
    await expect(generateSystemFiles(SYS({ authUi: false }))).rejects.toThrow(
      "loom.current-user-needs-auth-ui",
    );
  });
});
