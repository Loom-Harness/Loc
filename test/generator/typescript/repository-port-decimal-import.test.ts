// The pooled `domain/repository-ports.ts` narrows its imports to the domain
// types the member signatures reference.  A `find` with a `money` / `decimal`
// parameter (or result) spells `Decimal` in its signature — and until the
// wave C3 3d fold nothing in the corpus had one, so the port file never learned
// to import it: the generated Hono project failed `tsc` with
// `TS2304: Cannot find name 'Decimal'` on the `intrinsics` fixture
// (`find byFloorPrice(whole: money)`), caught only by the corpus × tsc leg.
// This pins the import where the fast suite runs, and its absence when no
// signature needs it (an unused import fails the generated-code lint gate).

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
      repository Products for Product {
        find byFloorPrice(whole: money): Product[] where this.price.floor() == whole
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

const withoutMoneyFind = withMoneyFind.replace(
  "find byFloorPrice(whole: money): Product[] where this.price.floor() == whole",
  "find byName(q: string): Product[] where this.name == q",
);

function portsFile(files: Map<string, string>): string {
  const key = [...files.keys()].find((k) => k.endsWith("domain/repository-ports.ts"));
  if (!key) throw new Error("no repository-ports.ts emitted");
  return files.get(key)!;
}

describe("Hono repository ports — a money find parameter imports Decimal", () => {
  it("imports the decimal.js type when a port signature spells Decimal", async () => {
    const src = portsFile(await generateSystemFiles(withMoneyFind));
    expect(src).toContain("byFloorPrice(whole: Decimal): Promise<Product[]>;");
    expect(src).toContain('import type Decimal from "decimal.js";');
  });

  it("does not import it when no signature needs it", async () => {
    const src = portsFile(await generateSystemFiles(withoutMoneyFind));
    expect(src).not.toMatch(/\bDecimal\b/);
  });
});
