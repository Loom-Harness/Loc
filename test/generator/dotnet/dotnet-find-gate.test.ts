// The policy read gate on a single-row read route, .NET (D-AUTH-OIDC /
// default-deny).  A `policy { read T requires <expr> }` over a `scaffoldGet(of:
// <Criterion>)` route splices an in-handler 403 gate at the top of the
// generated Mediator query handler — the read-side twin of the view gate —
// evaluated against the request's currentUser before the query runs.
// ForbiddenException maps to 403 via DomainExceptionFilter.  Ungated → no gate.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

async function emit(readGate: string): Promise<Map<string, string>> {
  return generateSystemFiles(`
    system Acme {
      user { id: string role: string }
      subdomain Sales {
        context Tickets with scaffoldGet(of: BySubject) {
          aggregate Ticket { subject: string open: bool }
          repository Tickets for Ticket
          criterion BySubject(s: string) of Ticket = this.subject == s
          ${readGate ? `policy { read Ticket ${readGate} }` : ""}
        }
      }
      api SalesApi with scaffoldGetApi(of: BySubject) from Sales { }
      storage pg { type: postgres }
      resource st { for: Tickets, kind: state, use: pg }
      deployable api {
        platform: dotnet
        contexts: [Tickets]
        dataSources: [st]
        serves: SalesApi
        port: 8080
        auth: required
      }
    }
  `);
}

function handlerOf(files: Map<string, string>): string {
  const key = [...files.keys()].find((k) => k.endsWith("GetTicketBySubjectHandler.cs"));
  expect(key, "GetTicketBySubjectHandler.cs not emitted").toBeDefined();
  return files.get(key!)!;
}

describe(".NET single-row read route — policy read gate", () => {
  // A plain (non-paged) .NET queryHandler whose `requires` gate reads
  // `currentUser` must inject ICurrentUserAccessor and bind
  // `var currentUser = _currentUser.User;`, or `currentUser.Role` is CS0103.
  it("emits a ForbiddenException gate evaluated against currentUser before the query", async () => {
    const handler = handlerOf(await emit('requires currentUser.role == "agent"'));
    expect(handler).toContain(
      'if (!(currentUser.Role == "agent")) throw new ForbiddenException("Forbidden: currentUser.role == \\"agent\\"");',
    );
    expect(handler).toMatch(/using Api\.Domain\.Common;/);
    const gateIdx = handler.indexOf("throw new ForbiddenException");
    const queryIdx = handler.indexOf("await _tickets.RunFindAllByBySubjectAsync(");
    expect(gateIdx).toBeGreaterThan(0);
    expect(queryIdx).toBeGreaterThan(gateIdx);
    expect(handler).toMatch(/ICurrentUserAccessor _currentUser/);
    expect(handler).toContain("var currentUser = _currentUser.User;");
  });

  it("emits no gate for an ungated read", async () => {
    const handler = handlerOf(await emit(""));
    expect(handler).toContain("await _tickets.RunFindAllByBySubjectAsync(");
    expect(handler).not.toContain("ForbiddenException");
  });

  it("`requires true` emits an always-pass gate without injecting the accessor", async () => {
    const handler = handlerOf(await emit("requires true"));
    expect(handler).toContain('if (!(true)) throw new ForbiddenException("Forbidden: true");');
    expect(handler).not.toContain("var currentUser = _currentUser.User;");
  });
});
