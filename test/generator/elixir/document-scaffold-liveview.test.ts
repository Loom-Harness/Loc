import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// A scaffolded LiveView over a `shape: document` aggregate: the form lifecycle
// calls `<Ctx>.change_<agg>/1,2` (so the facade must define it, over the
// embedded `Data` changeset) and every field read goes through `record.data` —
// a document record keeps its fields under the embedded `data` struct.

const SRC = `
  system Shop {
    subdomain S {
      context Shop {
        aggregate Order shape: document, with crudish { code: string  total: int }
        repository Orders for Order
      }
    }
    api ShopApi from S
    ui Web with scaffold(aggregates: [Order]) { api S: ShopApi }
    storage pg { type: postgres }
    resource st { for: Shop, kind: state, use: pg }
    deployable api { platform: elixir, contexts: [Shop], dataSources: [st], serves: ShopApi, port: 4000, ui: Web { S: api } }
  }
`;

describe("elixir LiveView scaffold over a document aggregate", () => {
  it("defines change_<agg> over the embedded Data changeset", async () => {
    const files = await generateSystemFiles(SRC);
    const facade = files.get("api/lib/api/shop.ex")!;
    expect(facade).toContain("def change_order(record_or_struct");
    expect(facade).toContain("Api.Shop.Order.Data.changeset(");
  });

  it("reads fields off record.data, never the document root", async () => {
    const files = await generateSystemFiles(SRC);
    const detail = files.get("api/lib/api_web/live/order_detail_live.ex")!;
    const list = files.get("api/lib/api_web/live/order_list_live.ex")!;
    expect(detail).toContain("@data.data.code");
    expect(list).toContain("o.data.code");
    expect(detail).not.toMatch(/@data\.code/);
    expect(list).not.toMatch(/\bo\.code\b/);
  });
});
