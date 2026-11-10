// The Feliz app localizes by catalog code (#4473).  F# cannot be run under
// vitest, so these pin the emitted wiring (the generated app is compiled by
// `dotnet fable` in the heavy gates): a rejected submit decodes each
// `errors[]` entry and the problem body into a `ServerIssue` {Code; Message;
// Params} and the view renders `ServerIssue.text` — `I18n.tf code message
// params` — when it RENDERS; a client validation message is a `(code, english)`
// pair the view renders through `I18n.t code english`.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { fileOf, generateFor } from "../_frontend/error-codes-fixture.js";

const appFs = async (scaffold = true) => fileOf(await generateFor("feliz", scaffold), "src/App.fs");

/** A feliz app with a form and NO translatable string: no `I18n` module. */
const PLAIN = `
system Shop {
  api ShopApi from Catalog
  subdomain Catalog {
    context Cat {
      aggregate Product with crudish { name: string  qty: int }
      repository Products for Product { }
    }
  }
  storage db { type: postgres }
  resource catState { for: Cat, kind: state, use: db }
  ui WebApp {
    api Shop: ShopApi
    page ProductNew { route: "/products/new"  body: CreateForm { of: Product } }
  }
  deployable api { platform: node contexts: [Cat] dataSources: [catState] serves: ShopApi port: 3000 }
  deployable web { platform: feliz targets: api ui: WebApp { Shop: api } port: 3005 }
}
`;

describe("Feliz — server errors and client rules localize by catalog code", () => {
  it("decodes a server field error and a global error with their code and params", async () => {
    const app = await appFs();
    expect(app).toContain(
      "type ServerIssue = { Code: string; Message: string; Params: (string * obj) list }",
    );
    // A field entry: code, message and params all ride along.
    expect(app).toContain(
      '{ Code = (get.Optional.Field "code" Decode.string |> Option.defaultValue "")',
    );
    expect(app).toContain(
      'Params = (get.Optional.Field "params" paramsDecoder |> Option.defaultValue [])',
    );
    // A refusal with no errors[]: the problem's own code over its English.
    expect(app).toContain('Option.defaultValue "problem.internal"');
    expect(app).toContain(
      "type ServerErrors = { Fields: Map<string, ServerIssue>; Form: ServerIssue option }",
    );
  });

  it("renders both through I18n.tf by code, when the view renders", async () => {
    const app = await appFs();
    expect(app).toContain("try I18n.tf (key issue) issue.Message issue.Params");
    expect(app).toContain("let key (issue: ServerIssue) : string =");
    expect(app).toContain("with _ -> issue.Message");
    // The view helpers localize at render time, not at decode time.
    expect(app).toContain("prop.text (ServerIssue.text m)");
    expect(app).not.toContain("prop.text m ]");
  });

  it("renders a client validation message through I18n.t / I18n.tf by its code", async () => {
    const app = await appFs();
    expect(app).toContain("(err: (string * string * (string * obj) list) option)");
    expect(app).toContain("| true, Some (code, e, ps) ->");
    expect(app).toContain(
      "prop.text (if List.isEmpty ps then I18n.t code e else I18n.tf code e ps)",
    );
    // Required → field.missing, an unparseable number → field.type-mismatch, a
    // named rule → its identity key.
    expect(app).toContain('Some ("field.missing", "Required", [])');
    expect(app).toMatch(
      /Some \("Sales\.Order\.rule\.qtyPositive", "Must be greater than 0", \[\]\)|Some \("Sales\.Order\.rule\.qtyPositive", "Must be at least 1", \[\]\)/,
    );
  });

  it("an app without a catalog shows the English as written", async () => {
    const files = await generateSystemFiles(PLAIN);
    const app = fileOf(files, "src/App.fs");
    expect(app).not.toContain("module I18n");
    expect(app).not.toContain("I18n.");
    expect(app).toContain("    issue.Message");
    expect(app).toContain("prop.text (e)");
  });
});
