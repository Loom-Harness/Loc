// The policy read gate on a single-row read route, Python/FastAPI
// (D-AUTH-OIDC / default-deny).  `scaffoldGet(of: <Criterion>)` +
// `scaffoldGetApi` put a criterion's first match on `GET /<plural>/<read>`; a
// `policy { read T requires <expr> }` splices a 403 gate into that handler,
// evaluated against the request's currentUser BEFORE the query.  ForbiddenError
// maps to 403 via the app exception handler.  Ungated → no gate.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

function src(readGate: string): string {
  return `system Acme {
    user { id: string  role: string }
    subdomain Sales { context Tickets with scaffoldGet(of: BySubject) {
      aggregate Ticket { subject: string  open: bool }
      repository Tickets for Ticket
      criterion BySubject(s: string) of Ticket = this.subject == s${readGate ? `\n      policy { read Ticket ${readGate} }` : ""}
    } }
    storage primary { type: postgres }
    resource st { for: Tickets, kind: state, use: primary }
    api Api with scaffoldGetApi(of: BySubject) from Sales
    deployable api { platform: python contexts: [Tickets] serves: Api dataSources: [st] port: 8080 auth: required }
  }`;
}

async function emitted(readGate: string): Promise<{ handler: string; routes: string }> {
  const files = await generateSystemFiles(src(readGate));
  const handler = files.get("api/app/application/get_ticket_by_subject.py");
  const routes = files.get("api/app/http/api_routes.py");
  expect(handler, "get_ticket_by_subject.py not emitted").toBeDefined();
  expect(routes, "api_routes.py not emitted").toBeDefined();
  expect(routes).toContain(
    '@router.get("/tickets/by_subject", operation_id="getTicketBySubject", responses=',
  );
  return { handler: handler!, routes: routes! };
}

describe("python single-row read gate (policy read)", () => {
  it("emits a 403 ForbiddenError gate before the query", async () => {
    const { handler } = await emitted('requires currentUser.role == "agent"');
    expect(handler).toContain(
      "from app.domain.errors import AggregateNotFoundError, ForbiddenError",
    );
    expect(handler).toContain('    if not (current_user.role == "agent"):');
    expect(handler).toContain(
      '        raise ForbiddenError("Forbidden: read Ticket requires currentUser.role == \\"agent\\"")',
    );
    const gateIdx = handler.indexOf("raise ForbiddenError");
    const queryIdx = handler.indexOf("await tickets.run_find_all_by_by_subject(s, limit=1)");
    expect(gateIdx).toBeGreaterThan(0);
    expect(queryIdx).toBeGreaterThan(gateIdx);
  });

  // The gate reads `current_user`, so the handler must bind the principal;
  // without it the first request raises NameError (ruff F821).
  it("binds the principal the gate reads", async () => {
    const { handler } = await emitted('requires currentUser.role == "agent"');
    const gateIdx = handler.indexOf('    if not (current_user.role == "agent"):');
    expect(gateIdx).toBeGreaterThan(0);
    const before = handler.slice(0, gateIdx);
    expect(before).toMatch(/current_user(: User)? = |current_user: User[,)]/);
  });

  it("emits no gate for an ungated read", async () => {
    const { handler } = await emitted("");
    expect(handler).not.toContain("ForbiddenError");
    expect(handler).not.toContain("current_user");
  });

  it("`requires true` emits an always-pass gate without reading the principal", async () => {
    const { handler } = await emitted("requires true");
    expect(handler).toContain("    if not (True):");
    expect(handler).not.toContain("current_user");
  });
});
