// An event-sourced aggregate's create request is its `create` action's params.
//
// The backend's create command takes the action's params (`owner`), and the
// declared `CreateAccountCommand` record says so; the folded state fields
// (`balance`, set by `apply`) are never sent.  The React and Vue clients read
// the create request off the Frontend Contract's declared record, so their
// `CreateAccountRequest` asks for `owner` alone.
//
// No booted leg submits a create form against an event-sourced aggregate, so
// the emitted schema is EXECUTED here: it must accept the body the backend's
// create command takes, and ask for nothing else.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { generateSystemFiles } from "../../_helpers/generate.js";

/** Evaluate the emitted `CreateAccountRequest` with the repo's zod. */
function createRequestSchema(api: string): z.ZodObject {
  const at = api.indexOf("export const CreateAccountRequest = ");
  expect(at, "CreateAccountRequest is emitted").toBeGreaterThan(-1);
  const end = api.indexOf("});", at) + "});".length;
  const expr = api.slice(at + "export const CreateAccountRequest = ".length, end - 1);
  return new Function("z", `return ${expr};`)(z) as z.ZodObject;
}

const source = (frontend: string) => `
system L {
  subdomain S {
    context Ledger {
      aggregate Account persistedAs: eventLog {
        owner: string
        balance: int
        create(owner: string) {
          emit AccountOpened { accountRef: id, owner: owner }
        }
        apply(e: AccountOpened) {
          owner := e.owner
          balance := 0
        }
      }
      event AccountOpened { accountRef: Account id, owner: string }
      repository Accounts for Account { }
    }
  }
  api A from S
  storage db { type: postgres }
  resource st { for: Ledger, kind: state, use: db }
  resource log { for: Ledger, kind: eventLog, use: db }
  ui W with scaffold(subdomains: [S]) { api S: A }
  deployable api { platform: node contexts: [Ledger] dataSources: [st, log] serves: A port: 3000 }
  deployable web { platform: ${frontend} targets: api ui: W { S: api } port: 3001 }
}`;

describe("an event-sourced create request is the create action's params", () => {
  it.each(["react", "vue"])("%s: CreateAccountRequest takes owner, not balance", async (fe) => {
    const files = await generateSystemFiles(source(fe));
    const api = files.get("web/src/api/account.ts");
    expect(api, "web/src/api/account.ts").toBeDefined();
    const schema = createRequestSchema(api!);
    expect(Object.keys(schema.shape)).toEqual(["owner"]);
    expect(schema.safeParse({ owner: "ada" }).success).toBe(true);
  });
});
