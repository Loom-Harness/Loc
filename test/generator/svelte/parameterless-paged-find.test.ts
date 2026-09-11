// A PARAMETERLESS find has an empty query object, and the walker's call site
// passes nothing (`useSellableProduct()`).  The 2026-09-10 e-shop audit (§P5)
// measured svelte-check red on exactly that:
//
//   src/routes/(app)/shop/+page.svelte:6  Expected 1 arguments, but got 0.
//
// The two emitters disagreed on arity, and only on Svelte: react/vue default the
// hook's query parameter, svelte defaulted it only for a NON-paged find.  The
// gate's stated reason — "svelte does not emit the `z.input` alias the react/vue
// module uses" — was stale: `api-builder.ts` emits `<Find>QueryInput` right
// beside `<Find>Query` for every paged find.  So a paged zero-parameter find was
// the one shape left un-defaulted, and every page reading one failed the build.
//
// The end-to-end proof is `test/e2e/fixtures/svelte-build/optional-fields.ddd`,
// whose `find open(): Project paged` + page reach a real `svelte-check`; this
// suite pins the emitted signature in the fast tier.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SRC = `
system Shop {
  subdomain Sales {
    context Orders {
      aggregate Product with crudish {
        name: string
        sellable: bool
        derived display: string = name
      }
      repository Products for Product {
        find sellable(): Product paged where this.sellable == true
        find named(needle: string): Product paged where this.name == needle
      }
    }
  }
  api SalesApi from Sales
  ui WebApp with scaffold(subdomains: [Sales]) {
    api Sales: SalesApi
    page ShopPage {
      route: "/shop"
      title: "Shop"
      body: Stack {
        QueryView {
          of: Sales.Product.sellable,
          data: rows => Table { rows: rows, Column { "Name", o => Text { o.name } } }
        }
      }
    }
  }
  storage primary { type: postgres }
  resource ordersState { for: Orders, kind: state, use: primary }
  deployable api { platform: node contexts: [Orders] dataSources: [ordersState] serves: SalesApi port: 8080 }
  deployable web { platform: svelte targets: api ui: WebApp { Sales: api } port: 3000 design: "flowbite@v1" }
}
`;

async function files(): Promise<Map<string, string>> {
  const all = await generateSystemFiles(SRC);
  const out = new Map<string, string>();
  for (const [p, content] of all) {
    if (p.startsWith("web/")) out.set(p.slice("web/".length), content);
  }
  return out;
}

describe("svelte paged find hook arity", () => {
  it("defaults the query accessor of a PAGED zero-parameter find", async () => {
    const client = (await files()).get("src/lib/api/product.ts")!;
    expect(client).toContain(
      "export function useSellableProduct(query: () => SellableQueryInput = () => ({})) {",
    );
  });

  it("takes the z.input alias for a paged find, as react/vue do", async () => {
    // `z.infer` makes page/pageSize/sort/dir REQUIRED (they carry wire
    // defaults); `z.input` is the caller-facing shape `() => ({})` satisfies.
    const client = (await files()).get("src/lib/api/product.ts")!;
    expect(client).toContain(
      "export type SellableQueryInput = z.input<typeof SellableQuery>;",
    );
  });

  it("leaves a find WITH parameters required", async () => {
    const client = (await files()).get("src/lib/api/product.ts")!;
    expect(client).toContain("export function useNamedProduct(query: () => NamedQueryInput) {");
  });

  it("the page calls the hook with no argument", async () => {
    const page = (await files()).get("src/routes/(app)/shop/+page.svelte")!;
    expect(page).toContain("useSellableProduct()");
  });
});

describe("svelte form runtime — the bound value type", () => {
  it("strips `null | undefined` at EVERY depth, not just one level", async () => {
    // A one-level strip left an optional sub-field of a value object nullish
    // (`form.values.budget.memo`), which a typed pack input rejects.
    const forms = (await files()).get("src/lib/forms.svelte.ts")!;
    expect(forms).toContain("{ [K in keyof T]-?: FormValues<NonNullable<T[K]>> }");
    // Structural leaf guard, not a `Decimal` import: `decimal.js` is a
    // CONDITIONAL dependency and money-free projects emit this file too.
    expect(forms).toContain("T extends Record<string, unknown>");
    expect(forms).not.toContain(`from "decimal.js"`);
  });
});
