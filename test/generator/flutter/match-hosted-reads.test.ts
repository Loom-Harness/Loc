// Reads that live inside a `match` arm reach the Flutter read providers.
//
// A page that renders one read's `QueryView` in a `match` arm and another in
// `else` watches both providers in its view walk; the read collector in
// `reads-emit.ts` must therefore see both too, or `reads.dart` never defines
// them and the page names undefined identifiers (`flutter analyze`:
// `undefined_identifier`).  The collector's child step is the shared
// `walkExprChildren`, which visits every `match` arm.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const MATCH_PAGE = `
system Shop {
  api ShopApi from Catalog
  subdomain Catalog {
    context Cat {
      aggregate Product with crudish { name: string  price: money }
      repository Products for Product {
        find byName(name: string): Product?
      }
    }
  }
  storage db { type: postgres }
  resource catState { for: Cat, kind: state, use: db }
  ui WebApp {
    api Shop: ShopApi
    page Browse {
      route: "/browse"
      title: "Browse"
      state { chosen: string = "" }
      body: Stack {
        Field("Name", bind: chosen),
        match {
          chosen != "" => QueryView {
            of: Shop.Product.byName(chosen),
            data: p => Text { p.name }
          }
          else => QueryView {
            of: Shop.Product.all,
            data: rows => For { each: rows, p => Text { p.name } }
          }
        }
      }
    }
  }
  deployable api { platform: node contexts: [Cat] dataSources: [catState] serves: ShopApi port: 3000 }
  deployable web { platform: flutter targets: api ui: WebApp { Shop: api } port: 3005 }
}
`;

describe("flutter reads hosted by a match arm", () => {
  it("every provider the page watches is defined", async () => {
    const files = await generateSystemFiles(MATCH_PAGE);
    const reads = [...files].find(([p]) => p.endsWith("lib/reads.dart"))?.[1];
    const page = [...files].find(([p]) => p.endsWith("pages/browse_page.dart"))?.[1];
    expect(reads, "reads.dart not emitted").toBeDefined();
    expect(page, "browse page not emitted").toBeDefined();

    // Both arms of the `match` are watched by the page…
    expect(page).toContain("ref.watch(productByNameProvider(");
    expect(page).toContain("ref.watch(productAllProvider");

    // …so both must be declared — in reads.dart, or (for the page's own
    // notifier) in the page itself.
    const declared = new Set(
      [...`${reads}\n${page}`.matchAll(/^final (\w+Provider)\b/gm)].map((m) => m[1]!),
    );
    const watched = [...page!.matchAll(/ref\.(?:watch|read)\((\w+Provider)\b/g)].map((m) => m[1]!);
    expect(watched.filter((p) => !declared.has(p))).toEqual([]);
  });
});
