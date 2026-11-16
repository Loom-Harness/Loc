// Loader `role="status"` on the RAW-element packs (M-T1.12 follow-up).
//
// The Loader primitive's a11y contract is `{ role: "status", live: "polite" }`.
// The library-backed packs get status semantics free from their spinner
// component (Mantine `<Loader>`, MUI `<CircularProgress>`, Chakra `<Spinner>`,
// vuetify/Angular progress components), but the packs that render a RAW element
// — shadcn/shadcnVue's lucide `<Loader2>` SVG icon and shadcnSvelte's `<span>` —
// carry no role or accessible name, so a screen reader gets nothing. These now
// spell out `role="status" aria-label="Loading"` (matching the spartanNg pack,
// which already did). Feliz's raw daisyUI span is pinned in its own suite
// (feliz/display-primitives.test.ts).

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

// A one-page ui whose loading branch renders a standalone Loader.
const system = (pack: string, framework: string): string => `
  system Shop {
    api ShopApi from Catalog
    subdomain Catalog {
      context Cat {
        aggregate Product with crudish { name: string }
        repository Products for Product { }
      }
    }
    storage db { type: postgres }
    resource s { for: Cat, kind: state, use: db }
    ui WebApp {
      framework: ${framework}
      api Shop: ShopApi
      page Products {
        route: "/"
        body: QueryView {
          of: Shop.Product.all,
          loading: Loader { },
          error: Text { "!" }, empty: Text { "0" },
          data: rows => Stack { For { each: rows, p => Card { p.name } } }
        }
      }
    }
    deployable api { platform: node contexts: [Cat] dataSources: [s] serves: ShopApi port: 3000 }
    deployable web { platform: web design: "${pack}" targets: api ui: WebApp { Shop: api } port: 3005 }
  }
`;

const RAW_PACKS: ReadonlyArray<{ pack: string; framework: string }> = [
  { pack: "shadcn", framework: "react" }, // lucide <Loader2> icon
  { pack: "shadcnVue", framework: "vue" }, // lucide <Loader2> icon
  { pack: "shadcnSvelte", framework: "svelte" }, // raw <span> spinner
];

describe("Loader role=status — raw-element packs", () => {
  for (const { pack, framework } of RAW_PACKS) {
    it(`${pack} (${framework}): the raw spinner carries role=status + an accessible name`, async () => {
      const files = await generateSystemFiles(system(pack, framework));
      const all = [...files.values()].join("\n");
      expect(all).toContain('role="status"');
      // The accessible name is "Loading" — a raw `aria-label="Loading"` when the
      // app has no i18n, or a `chrome.loading`-keyed `t()` binding when it does
      // (this scaffold has authored strings, so i18n is on).  M-T1.11.
      expect(all).toMatch(/aria-label[^>]*Loading/);
    });
  }
});
