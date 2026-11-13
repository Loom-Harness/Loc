// Feliz multi-list ui: each list owns its page/sort state and refetches itself,
// loads when its route is entered (after the session under an auth gate), and the
// default nav names the aggregates.  These are emitted-text claims about MVU
// wiring that no compile tier observes (the Elmish shape, not wire behaviour).

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const MULTI = `
system Shop {
  user { id: string  role: string }
  api ShopApi from Sales
  subdomain Sales {
    context Sales {
      aggregate Product with crudish { sku: string  derived display: string = sku }
      aggregate Order with crudish { ref: string  derived display: string = ref }
      repository Products for Product { }
      repository Orders for Order { }
    }
  }
  ui WebApp with scaffold(subdomains: [Sales]) { api Shop: ShopApi }
  storage db { type: postgres }
  resource st { for: Sales, kind: state, use: db }
  deployable api { platform: node contexts: [Sales] dataSources: [st] serves: ShopApi port: 3000 }
  deployable web { platform: feliz targets: api ui: WebApp { Shop: api } port: 3005 }
}
`;
const AUTH = MULTI.replace("port: 3000 }", "port: 3000 auth: required }").replace(
  "port: 3005 }",
  "port: 3005 auth: ui }",
);

async function appFs(src: string): Promise<string> {
  const files = await generateSystemFiles(src);
  return [...files.entries()].find(([p]) => p.endsWith("src/App.fs"))![1];
}

describe("feliz multi-list ui", () => {
  it("gives each list its own page/sort cells and refetches that list", async () => {
    const app = await appFs(MULTI);
    for (const c of ["ProductList", "OrderList"]) {
      for (const f of ["SortKey", "SortDir", "PageNum"]) expect(app).toContain(`    ${c}${f}:`);
    }
    expect(app).not.toContain("    PageNum:");
    expect(app).toContain("  | SetOrderListPageNum v -> let __m = { model with OrderListPageNum =");
    expect(app).toMatch(/SetOrderListSortDir v -> .*Api\.allOrders __m\.OrderListPageNum/);
    expect(app).toMatch(/SetProductListSortDir v -> .*Api\.allProducts __m\.ProductListPageNum/);
  });

  it("loads a list on route entry, not at init", async () => {
    const app = await appFs(MULTI);
    expect(app).toContain("let pageCmd (model: Model) (page: Page) : Cmd<Msg> =");
    expect(app).toMatch(/\| ProductList -> Cmd\.OfAsync\.perform .*Api\.allProducts/);
    expect(app).toContain("  __m, pageCmd __m page");
    expect(app).toContain("      __m, pageCmd __m page");
  });

  it("fires reads only after the session resolves under an auth gate", async () => {
    const app = await appFs(AUTH);
    expect(app).not.toContain("  __m, Cmd.batch [\n    pageCmd");
    expect(app).toMatch(
      /SessionChecked true -> \(let __m = .* in __m, pageCmd __m __m\.CurrentPage\)/,
    );
    expect(app).toContain("(if __m.Session = Authed then pageCmd __m page else Cmd.none)");
  });

  it("labels the default nav by aggregate", async () => {
    const app = await appFs(MULTI);
    expect(app).toContain(
      'prop.href "/products"; prop.text (I18n.t "Sales.Product.name.other" "Products")',
    );
    expect(app).not.toContain('prop.text "List"');
    expect(app).not.toContain('prop.href "/products/new"; prop.text');
  });
});
