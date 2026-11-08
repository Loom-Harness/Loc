// An optional scalar handler param bound from the query string parses with the
// inner type's query schema and may be absent — the same decode the required
// param gets.  It fell through to `z.string()`, so `min: decimal?` reached the
// handler as `string | null` and a criterion read typed `number | null`
// refused it (TS2345 under the generated project's `tsc --noEmit`).

import { beforeAll, describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
system S {
  subdomain D { context Shop {
    aggregate Item with crudish { sku: string  qty: int  cap: decimal }
    repository Items for Item { }
    criterion CapAbove(min: decimal?) of Item = this.cap > min
    criterion QtyAbove(n: int?) of Item = this.qty > n
    queryHandler ListCap(min: decimal?): Item[] { let r = Items.all(CapAbove(min))  return r }
    queryHandler ListQty(n: int?): Item[] { let r = Items.all(QtyAbove(n))  return r }
  }}
  api A from D {
    route GET "/cap" -> Shop.ListCap
    route GET "/qty" -> Shop.ListQty
  }
  storage primary { type: postgres }
  resource st { for: Shop, kind: state, use: primary }
  deployable api { platform: node, contexts: [Shop], dataSources: [st], serves: A, port: 3000 }
}
`;

let routes: string;
beforeAll(async () => {
  routes = (await generateSystemFiles(SRC)).get("api/http/a-routes.ts") ?? "";
}, 120_000);

describe("node: an optional query param decodes like the required one", () => {
  it.each([
    ["decimal?", "min: z.coerce.number().optional()"],
    ["int?", "n: z.coerce.number().int().optional()"],
  ])("%s parses with the inner query schema, absent allowed", (_t, schema) => {
    expect(routes).toContain(`query: z.object({ ${schema} })`);
  });

  it("binds the parsed value (or null) and hands it to the criterion read", () => {
    expect(routes).toContain("const min = (__query.min == null ? null : __query.min);");
    expect(routes).toContain("await items.runFindAllByCapAbove(min);");
    expect(routes).not.toContain("min: z.string()");
  });
});
