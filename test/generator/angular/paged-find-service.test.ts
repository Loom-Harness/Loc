import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// A paged criterion read (`Order.findAllByInStatus(…)`, the find `scaffoldPaged`
// synthesises) answers the `<Agg>Paged` envelope and takes the page controls the
// page threads through its query bag.  The Angular service must type both, or the
// page's `.data()?.items` and `{ page, pageSize, sort, dir }` fail `ng build`.

const SRC = `
  system S {
    subdomain Sub { context Sales with scaffoldPaged(of: InStatus) {
      aggregate Order { status: string  customerId: string }
      repository Orders for Order
      criterion InStatus(status: string) of Order = this.status == status
    } }
    api SalesApi with scaffoldPagedApi(of: InStatus) from Sub
    ui WebApp {
      api Sub: SalesApi
      page ByStatus {
        route: "/by-status"
        state { wanted: string = "open" }
        body: QueryView { of: Order.findAllByInStatus(wanted), data: rows => Text { "rows" } }
      }
    }
    storage loomDb { type: postgres }
    resource salesState { for: Sales, kind: state, use: loomDb }
    deployable api { platform: node, contexts: [Sales], dataSources: [salesState], serves: SalesApi, port: 3000 }
    deployable web { platform: angular, targets: api, ui: WebApp { Sub: api }, port: 3001 }
  }
`;

describe("angular paged criterion service", () => {
  it("types the envelope and the page controls", async () => {
    const all = await generateSystemFiles(SRC);
    const api = [...all].find(([p]) => p.startsWith("web/") && /src\/api\/order\.ts$/.test(p))?.[1];
    expect(api).toBeDefined();
    expect(api).toContain("export interface OrderPaged {");
    expect(api).toMatch(
      /findAllByInStatus\(query: FindAllByInStatusOrderQuery\) \{[^}]*http\.get<OrderPaged>/,
    );
    expect(api).toMatch(
      /export interface FindAllByInStatusOrderQuery \{[^}]*page\?: number;[^}]*dir\?: string;/,
    );
  });
});
