// A `WorkflowForm`'s run button is the identity-keyed message
// `<Ctx>.<Workflow>.op.run`, the key the HEEx form reads too, so the React and
// Phoenix targets share one catalog entry.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SRC = (body: string): string => `
system Shop {
  subdomain S {
    context Sales {
      aggregate Order with crudish { code: string }
      repository Orders for Order { }
      workflow PlaceOrder transactional {
        create(ref: string) {
          let o = Order.create(code: ref)
        }
      }
    }
  }
  api SalesApi from S
  ui Web {
    api Sales: SalesApi
    page Home { route: "/" body: ${body} }
  }
  storage primary { type: postgres }
  resource st { for: Sales, kind: state, use: primary }
  deployable api { platform: node contexts: [Sales] dataSources: [st] serves: SalesApi port: 3000 }
  deployable web { platform: react targets: api ui: Web { Sales: api } design: shadcn port: 3100 }
}
`;

const page = (files: Map<string, string>): string => {
  const hit = [...files].find(([p]) => p.endsWith("home.tsx"));
  expect(hit).toBeDefined();
  return hit![1];
};

describe("WorkflowForm run button", () => {
  it("binds through t() under i18n and is catalogued under the workflow's identity key", async () => {
    const files = await generateSystemFiles(
      SRC(`Stack { Heading { "Place" }, WorkflowForm { runs: PlaceOrder } }`),
    );
    expect(page(files)).toContain(`t("Sales.PlaceOrder.op.run", "Run")`);
    const catalog = JSON.parse(
      [...files].find(([p]) => p.endsWith("locales/en.json"))![1],
    ) as Record<string, string>;
    expect(catalog["Sales.PlaceOrder.op.run"]).toBe("Run");
  });

  it("keeps the literal `Run` when nothing in the app is translatable", async () => {
    const files = await generateSystemFiles(SRC(`WorkflowForm { runs: PlaceOrder }`));
    expect(page(files)).toContain(">Run<");
    expect(page(files)).not.toContain("op.run");
  });
});
