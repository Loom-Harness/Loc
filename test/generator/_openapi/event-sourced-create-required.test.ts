// The OpenAPI create request is the declared create command record.
//
// An event-sourced aggregate's create command takes its `create` action's
// params (`owner`); its folded state (`balance`, set by `apply`) is never sent.
// Java's `@Schema(requiredProperties = …)` and Phoenix's OpenApiSpex
// `required:` list read the record through `createRequestRequiredNames`
// (`src/ir/plan/create-request.ts`), so neither advertises `balance` as a
// required body field the controller never binds.  Node, .NET and Python
// derive the document from the request DTO itself, which already takes the
// params alone.
//
// Spelling with no booted tier here: the per-PR legs do not serve this model's
// OpenAPI document, and the conformance-parity leg boots a model with no
// event-sourced create.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { javaRequiredSets } from "../../_helpers/java-openapi-annotations.js";

const source = (platform: string) => `
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
  deployable api { platform: ${platform} contexts: [Ledger] dataSources: [log] serves: A port: 3000 }
}`;

describe("the OpenAPI create request of an event-sourced aggregate is its create params", () => {
  it("java: CreateAccountRequest requires owner alone", async () => {
    const files = await generateSystemFiles(source("java"));
    expect(javaRequiredSets(files).get("CreateAccountRequest")).toEqual(["owner"]);
  });

  it("elixir: the OpenApiSpex CreateAccountRequest lists and requires owner alone", async () => {
    const files = await generateSystemFiles(source("elixir"));
    const schema = [...files].find(([p]) => p.endsWith("/create_account_request.ex"))?.[1];
    expect(schema, "create_account_request.ex is emitted").toBeDefined();
    const props = [
      ...(schema!.match(/properties: %\{([\s\S]*?)\n\s*\}/)?.[1] ?? "").matchAll(
        /^\s*(\w+): %OpenApiSpex/gm,
      ),
    ].map((m) => m[1]);
    const required = [
      ...(schema!.match(/required: \[([^\]]*)\]/)?.[1] ?? "").matchAll(/:(\w+)/g),
    ].map((m) => m[1]);
    expect({ props, required }).toEqual({ props: ["owner"], required: ["owner"] });
  });
});
