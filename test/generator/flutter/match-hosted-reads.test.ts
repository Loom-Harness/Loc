// Reads that live inside a `match` arm reach the Flutter read providers.
//
// The scaffolded FILTER BAR renders the filtered find's `QueryView` in a
// `match` arm and the unfiltered `.all` view in `otherwise`.  The page shell's
// view walk watches both providers; the read collector in `reads-emit.ts` must
// therefore see both too, or `reads.dart` never defines them and the page names
// two undefined identifiers (`flutter analyze`: `undefined_identifier`).  The
// collector's child step is the shared `walkExprChildren`, which visits every
// `match` arm.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SCAFFOLD_FILTER = `
system Shop {
  api ShopApi from Catalog
  subdomain Catalog {
    context Cat {
      aggregate Product with crudish { name: string  price: money }
      repository Products for Product {
        find byName(name: string): Product[]
      }
    }
  }
  storage db { type: postgres }
  resource catState { for: Cat, kind: state, use: db }
  ui WebApp with scaffold(aggregates: [Product]) {
    api Shop: ShopApi
  }
  deployable api { platform: node contexts: [Cat] dataSources: [catState] serves: ShopApi port: 3000 }
  deployable web { platform: flutter targets: api ui: WebApp { Shop: api } port: 3005 }
}
`;

describe("flutter reads hosted by a match arm", () => {
  it("scaffolded filter bar: every provider the list page watches is defined", async () => {
    const files = await generateSystemFiles(SCAFFOLD_FILTER);
    const reads = [...files].find(([p]) => p.endsWith("lib/reads.dart"))?.[1];
    const page = [...files].find(([p]) => p.endsWith("pages/product_list_page.dart"))?.[1];
    expect(reads, "reads.dart not emitted").toBeDefined();
    expect(page, "product list page not emitted").toBeDefined();

    // Both halves of the filter bar's `match` are watched by the page…
    expect(page).toContain("ref.watch(productByNameProvider(");
    expect(page).toContain("ref.watch(productAllProvider(");

    // …so both must be declared — in reads.dart, or (for the page's own
    // notifier) in the page itself.
    const declared = new Set(
      [...`${reads}\n${page}`.matchAll(/^final (\w+Provider)\b/gm)].map((m) => m[1]!),
    );
    const watched = [...page!.matchAll(/ref\.(?:watch|read)\((\w+Provider)\b/g)].map((m) => m[1]!);
    expect(watched.filter((p) => !declared.has(p))).toEqual([]);
  });
});
