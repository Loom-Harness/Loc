// The pooled `domain/repository-ports.ts` narrows its imports to the domain
// types the member signatures reference.  A criterion read with a `money` /
// `decimal` parameter spells `Decimal` in its port signature, so the port file
// must import it — without it the generated Hono project fails `tsc` with
// `TS2304: Cannot find name 'Decimal'`.  This pins the import where the fast
// suite runs, and its absence when no signature needs it (an unused import
// fails the generated-code lint gate).

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const withMoneyFind = `
system Shop {
  subdomain Sales {
    context Catalog {
      aggregate Product with crudish {
        name: string
        price: money
      }
      repository Products for Product { }
      criterion ProductsByFloorPrice(whole: money) of Product = this.price.floor() == whole
      queryHandler ListByFloorPrice(whole: money): Product[] {
        let r = Products.findAll(ProductsByFloorPrice(whole))
        return r
      }
    }
  }
  api ShopApi from Sales
  storage primary { type: postgres }
  resource catalogState { for: Catalog, kind: state, use: primary }
  deployable d {
    platform: node
    contexts: [Catalog]
    dataSources: [catalogState]
    serves: ShopApi
    port: 4000
  }
}
`;

const withoutMoneyFind = withMoneyFind
  .replace(
    "criterion ProductsByFloorPrice(whole: money) of Product = this.price.floor() == whole",
    "criterion ProductsByName(q: string) of Product = this.name == q",
  )
  .replace(
    "ListByFloorPrice(whole: money): Product[] {\n        let r = Products.findAll(ProductsByFloorPrice(whole))",
    "ListByName(q: string): Product[] {\n        let r = Products.findAll(ProductsByName(q))",
  );

function portsFile(files: Map<string, string>): string {
  const key = [...files.keys()].find((k) => k.endsWith("domain/repository-ports.ts"));
  if (!key) throw new Error("no repository-ports.ts emitted");
  return files.get(key)!;
}

describe("Hono repository ports — a money read parameter imports Decimal", () => {
  it("imports the decimal.js type when a port signature spells Decimal", async () => {
    const src = portsFile(await generateSystemFiles(withMoneyFind));
    expect(src).toContain(
      "runFindAllByProductsByFloorPrice(whole: Decimal, page?: { offset?: number; limit?: number }): Promise<Product[]>;",
    );
    expect(src).toContain('import type Decimal from "decimal.js";');
  });

  it("does not import it when no signature needs it", async () => {
    expect(withoutMoneyFind).not.toContain("money)");
    const src = portsFile(await generateSystemFiles(withoutMoneyFind));
    expect(src).toContain("runFindAllByProductsByName(q: string");
    expect(src).not.toMatch(/\bDecimal\b/);
  });
});
