// An event-sourced aggregate's create request is its `create` action's params.
//
// The backend's create command takes the action's params (`owner`), and the
// declared `CreateAccountCommand` record says so; the folded state fields
// (`balance`, set by `apply`) are never sent.  Every frontend reads the create
// request through `createRequestFields` (`src/ir/plan/create-request.ts`), so
// the request schema, the create form and the page object ask for `owner`
// alone.
//
// The form-spec UI probe (`test/behavioral/form-spec-ui.mjs`,
// `judgeEventSourcedCreate`) submits the built create form; here the emitted
// schema is EXECUTED, and the absence of a `balance` input on every target is
// checked over the whole generated tree (an absence no booted leg observes on
// the targets that leg does not boot).

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

const WEB_FRAMEWORKS = ["react", "vue", "svelte", "angular"];
const isWeb = (frontend: string) => WEB_FRAMEWORKS.includes(frontend);

const source = (frontend: string, backend = "node") => `
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
  resource log { for: Ledger, kind: eventLog, use: db }
  ui W with scaffold(subdomains: [S]) { ${isWeb(frontend) ? `framework: ${frontend} ` : ""}api S: A }
  deployable api { platform: ${backend} contexts: [Ledger] dataSources: [log] serves: A ${frontend === "liveview" ? "ui: W { S: api } " : ""}port: 3000 }
  ${frontend === "liveview" ? "" : `deployable web { platform: ${isWeb(frontend) ? "web" : frontend} targets: api ui: W { S: api } port: 3001 }`}
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

  // Absence: no create form or page object on any target asks for `balance`.
  // Flutter's form has no test ids, so its create form is read for the field.
  it.each([
    ["react", "node", /accounts-new-input-balance/],
    ["vue", "node", /accounts-new-input-balance/],
    ["svelte", "node", /accounts-new-input-balance/],
    ["angular", "node", /accounts-new-input-balance/],
    ["feliz", "node", /accounts-new-input-balance/],
    ["flutter", "node", /'balance'|_balanceController/],
    ["liveview", "elixir", /accounts-new-input-balance/],
  ] as const)("%s: no create form or page object asks for balance", async (fe, be, balanceInput) => {
    const files = await generateSystemFiles(source(fe, be));
    const owner = fe === "flutter" ? /'owner'|_ownerController/ : /accounts-new-input-owner/;
    const forms = [...files].filter(([p]) => /new|App\.fs|forms\.dart|e2e\/pages/.test(p));
    expect(
      forms.some(([, c]) => owner.test(c)),
      "the create form asks for owner",
    ).toBe(true);
    const asking = forms.filter(([, c]) => balanceInput.test(c)).map(([p]) => p);
    expect(asking).toEqual([]);
  });
});
