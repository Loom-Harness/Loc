// A read whose predicate touches a `mask unless` field inherits the mask as a
// leading `requires` on every backend — for a handler and for a workflow's
// command `create` alike — so a caller who cannot read `ssn` gets 403 before
// the query runs, never a 200-or-404 that confirms a guessed value.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const source = (platform: string) => `
system S {
  user { id: guid  role: string }
  subdomain Sub {
    context C {
      aggregate Driver with crudish { name: string  ssn: string mask unless currentUser.role == "hr" }
      repository Drivers for Driver
      criterion BySsn(s: string) of Driver = this.ssn == s
      queryHandler GetDriverBySsn(s: string): Driver {
        if let d = Drivers.find(BySsn(s)) { return d } else { notFound }
      }
      workflow CheckSsn {
        create(s: string) {
          let d = Drivers.find(BySsn(s))
        }
      }
    }
  }
  api A from Sub {
    route GET "/drivers/by_ssn/{s}" -> C.GetDriverBySsn
  }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable api { platform: ${platform} contexts: [C] dataSources: [st] serves: A port: 3000 auth: required }
}`;

const GATE = "mask unless — the read filters Driver on a masked field";

/** Per backend: a path fragment of the handler's file and of the workflow's. */
const SITES: Record<string, { handler: RegExp; workflow: RegExp }> = {
  node: { handler: /http\/a-routes\.ts$/, workflow: /http\/workflows\.ts$/ },
  dotnet: { handler: /GetDriverBySsnHandler\.cs$/, workflow: /CheckSsnHandler\.cs$/ },
  java: { handler: /GetDriverBySsnHandler\.java$/, workflow: /CWorkflows\.java$/ },
  python: { handler: /get_driver_by_ssn\.py$/, workflow: /workflows_routes\.py$/ },
  elixir: { handler: /handlers\/get_driver_by_ssn\.ex$/, workflow: /workflows\/check_ssn\.ex$/ },
};

describe("mask unless — a masked-predicate read inherits the mask as a 403 gate", () => {
  for (const [platform, sites] of Object.entries(SITES)) {
    it(`${platform}: the handler and the workflow create both lead with the gate`, async () => {
      const files = [...(await generateSystemFiles(source(platform))).entries()];
      for (const [site, pattern] of Object.entries(sites)) {
        const hit = files.find(([p]) => pattern.test(p));
        expect(hit, `${platform}: no ${site} file matches ${pattern}`).toBeDefined();
        expect(hit![1], `${platform} ${site}`).toContain(GATE);
      }
    });
  }
});
