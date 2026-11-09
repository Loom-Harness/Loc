// HEEx placeholder text that carries no authored label — a column header that
// is neither a literal nor `label(…)`, a form with nothing to ask, a workflow's
// run button — is catalogued and rendered through gettext, so an i18n-enabled
// app translates it like every other string.  The catalog and the emitted
// `pgettext` call are two halves keyed by the same name; both are pinned.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = (body: string): string => `
system Shop {
  subdomain S {
    context Sales {
      aggregate Order with crudish {
        code: string
      }
      repository Orders for Order { }
      workflow PlaceOrder transactional {
        create(ref: string) {
          let o = Order.create(code: ref)
        }
      }
      workflow SweepOrders {
        create() { }
      }
    }
  }
  api SalesApi from S
  storage pg { type: postgres }
  resource st { for: Sales, kind: state, use: pg }
  ui Web {
    framework: phoenixLiveView
    api Sales: SalesApi
    page Home {
      route: "/"
      state { q: string = "" }
      body: ${body}
    }
  }
  deployable app {
    platform: elixir
    contexts: [Sales]
    dataSources: [st]
    serves: SalesApi
    ui: Web { Sales: app }
    port: 4000
  }
}
`;

const BODY = `Stack {
  Heading { "Storefront" },
  Table { rows: Sales.Order.all, Column { "Code", o => o.code }, Column { q, o => o.code } },
  WorkflowForm { runs: PlaceOrder, testid: "place" },
  WorkflowForm { runs: SweepOrders, testid: "sweep" }
}`;

const gen = (body: string) =>
  generateSystemFiles(SRC(body), { translations: new Map([["de", {}]]) });

const part = (files: Map<string, string>, suffix: string): string => {
  const hit = [...files].find(([p]) => p.endsWith(suffix));
  expect(hit, `no ${suffix} in: ${[...files.keys()].join(", ")}`).toBeDefined();
  return hit![1];
};

describe("HEEx fallback chrome", () => {
  it("a non-literal column header reads the `chrome.column.<n>` sentence", async () => {
    const files = await gen(BODY);
    const live = part(files, "/home_live.ex");
    expect(live).toContain('label={pgettext("chrome.column.2", "Column 2")}');
    expect(live).not.toContain('label="Column 2"');
    expect(part(files, "default.pot")).toContain('msgctxt "chrome.column.2"');
  });

  it("a workflow form's run button reads `<Ctx>.<Workflow>.op.run`", async () => {
    const files = await gen(BODY);
    const live = part(files, "/home_live.ex");
    expect(live).toContain('<%= pgettext("Sales.PlaceOrder.op.run", "Run") %>');
    expect(live).not.toContain(">Submit<");
    expect(part(files, "default.pot")).toContain('msgctxt "Sales.PlaceOrder.op.run"');
  });

  it("a parameterless workflow form's placeholder input label is a chrome message", async () => {
    const files = await gen(BODY);
    const live = part(files, "/home_live.ex");
    expect(live).toContain('label={pgettext("chrome.fieldFallback", "Field")}');
    expect(live).not.toContain('label="Field"');
    expect(part(files, "default.pot")).toContain('msgctxt "chrome.fieldFallback"');
  });

  it("keeps the English literal when the app has nothing to translate", async () => {
    const files = await generateSystemFiles(
      SRC(`Stack { WorkflowForm { runs: SweepOrders, testid: "sweep" } }`),
    );
    const live = part(files, "/home_live.ex");
    expect(live).toContain('label="Field"');
    expect(live).toContain(">Run</.button>");
    expect(live).not.toContain("pgettext");
  });
});
