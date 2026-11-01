// The policy read gate on a single-row read route, Hono (D-AUTH-OIDC /
// default-deny).  A `policy { read T requires <expr> }` over a
// `scaffoldGet(of: <Criterion>)` read emits an in-handler 403 gate at the top
// of the GET /<plural>/<read> route — the read-side twin of the view gate —
// evaluated against the request's currentUser before the query runs.  An
// ungated aggregate's read emits no gate.

import { describe, expect, it } from "vitest";
import { generateSystems } from "../../../src/system/index.js";
import { parseValid } from "../../_helpers/parse.js";

function sys(readClause: string): string {
  return `
  system Sys {
    user { id: string role: string }
    subdomain S {
      context Tickets with scaffoldGet(of: BySubject) {
        aggregate Ticket { subject: string open: bool }
        repository Tickets for Ticket
        criterion BySubject(s: string) of Ticket = this.subject == s${readClause ? `\n        policy { read Ticket ${readClause}}` : ""}
      }
    }
    storage primary { type: postgres }
    resource st { for: Tickets, kind: state, use: primary }
    api Api with scaffoldGetApi(of: BySubject) from S
    deployable api { platform: node  contexts: [Tickets]  serves: Api  dataSources: [st]  port: 3000  auth: required }
  }
`;
}

async function routesFile(readClause: string): Promise<string> {
  const files = (await generateSystems(await parseValid(sys(readClause)))).files;
  const path = [...files.keys()].find((k) => k.endsWith("http/api-routes.ts"));
  expect(path, "api-routes.ts not emitted").toBeDefined();
  const rf = files.get(path!)!;
  expect(rf).toContain('path: "/tickets/by_subject",');
  return rf;
}

describe("Hono single-row read requires gate", () => {
  it("emits the 403 gate before the query", async () => {
    const rf = await routesFile('requires currentUser.role == "agent" ');
    expect(rf).toContain(
      'if (!(currentUser.role === "agent")) throw new ForbiddenError("Forbidden: currentUser.role == \\"agent\\"");',
    );
    const gateIdx = rf.indexOf("throw new ForbiddenError");
    const queryIdx = rf.indexOf("await tickets.runFindAllByBySubject(s, { limit: 1 })");
    expect(gateIdx).toBeGreaterThan(0);
    expect(queryIdx).toBeGreaterThan(gateIdx);
  });

  // KNOWN DEFECT: a routed queryHandler's `requires currentUser…` (the read
  // gate `scaffoldGet` splices, or a hand-written one) renders the gate in
  // `http/api-routes.ts` without binding `currentUser` from the request
  // context, so the generated project does not type-check.  Flip to `it` once
  // the handler route binds it.
  it.fails("binds currentUser from the request before the gate reads it", async () => {
    const rf = await routesFile('requires currentUser.role == "agent" ');
    expect(rf).toContain('.get("currentUser")');
    expect(rf).toContain(
      'if (!(currentUser.role === "agent")) throw new ForbiddenError("Forbidden: currentUser.role == \\"agent\\"");',
    );
    const gateIdx = rf.indexOf("throw new ForbiddenError");
    const queryIdx = rf.indexOf("await tickets.runFindAllByBySubject(s, { limit: 1 })");
    expect(gateIdx).toBeGreaterThan(0);
    expect(queryIdx).toBeGreaterThan(gateIdx);
  });

  it("emits no gate for an ungated read", async () => {
    const rf = await routesFile("");
    expect(rf).toContain("await tickets.runFindAllByBySubject(s, { limit: 1 })");
    expect(rf).not.toContain("throw new ForbiddenError");
  });

  it("`requires true` emits an always-pass gate without reading currentUser", async () => {
    const rf = await routesFile("requires true ");
    expect(rf).toContain("if (!(true)) throw new ForbiddenError");
  });
});
