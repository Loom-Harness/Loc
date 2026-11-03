import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

// A page read spelled through the ui's api handle (`Sub.Order.findAllByInStatus`)
// must be recognised exactly like the bare `Order.findAllByInStatus`: the
// criterion's paged read is derived, not declared, so the phase-④ api-body check
// has to know the spelling (`findAllBy<Criterion>`).

const SRC = (read: string) => `
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
        body: QueryView { of: ${read}(wanted), data: rows => Text { "rows" } }
      }
    }
    storage loomDb { type: postgres }
    resource salesState { for: Sales, kind: state, use: loomDb }
    deployable api { platform: node, contexts: [Sales], dataSources: [salesState], serves: SalesApi, port: 3000 }
    deployable web { platform: react, targets: api, ui: WebApp { Sub: api }, port: 3001 }
  }
`;

describe("api-handle-qualified paged criterion read", () => {
  it("is accepted like the bare spelling and emits the same page", async () => {
    const bare = await generateSystemFiles(SRC("Order.findAllByInStatus"));
    const qualified = await generateSystemFiles(SRC("Sub.Order.findAllByInStatus"));
    const page = (m: Map<string, string>) =>
      [...m].find(([p]) => p.startsWith("web/") && /pages\/by_status/.test(p))?.[1] ?? "";
    expect(page(qualified)).toContain("useFindAllByInStatusOrder(");
    expect(page(qualified)).toBe(page(bare));
  });
});
