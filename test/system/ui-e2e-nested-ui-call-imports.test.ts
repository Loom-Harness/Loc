// The page objects a ui e2e spec imports are collected from every `ui.<x>`
// call in the test body, at any depth.  A call nested in a statement block or
// in an expression kind the collector did not list was missed, so the spec
// used a page-object class it never imported.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const src = (body: string): string => `
system Shop {
  subdomain Sales {
    context Orders {
      aggregate Order with crudish {
        customerId: string
        status: string
      }
      repository Orders for Order { }
    }
  }
  api SalesApi from Sales
  storage pg { type: postgres }
  resource ordersState { for: Orders, kind: state, use: pg }
  ui WebApp with scaffold(subdomains: [Sales]) {
    api Sales: SalesApi
  }
  deployable api { platform: node contexts: [Orders] dataSources: [ordersState] serves: SalesApi port: 8080 }
  deployable web { platform: react targets: api ui: WebApp { Sales: api } port: 3000 }
  test e2e "nested ui call" against web {
${body}
  }
}
`;

async function specText(body: string): Promise<string> {
  const files = await generateSystemFiles(src(body));
  let out = "";
  for (const [p, c] of files) if (/\.spec\.ts$/.test(p) && /nested/i.test(c)) out += c;
  return out;
}

describe("ui e2e spec imports the page objects of nested ui calls", () => {
  it("a ui call inside a list literal", async () => {
    const spec = await specText(
      `    let ords = [ui.orders.create({ customerId: "c-1", status: "Draft" })]`,
    );
    expect(spec, "no spec was emitted").not.toBe("");
    expect(spec).toMatch(/OrderListPage/);
    expect(spec).toMatch(/import \{[^}]*OrderListPage/);
  });

  it("a ui call at the top level (control)", async () => {
    const spec = await specText(
      `    let ord = ui.orders.create({ customerId: "c-1", status: "Draft" })`,
    );
    expect(spec).toMatch(/import \{[^}]*OrderListPage/);
  });
});
