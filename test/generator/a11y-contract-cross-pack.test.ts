// Cross-pack a11y-contract guard (M-T1.12).
//
// The per-slice a11y tests each pin one primitive on a representative pack.
// This guard runs the MECHANICAL a11y facts across EVERY JSX/markup design
// pack at once, so a template/caller drift that only bites one pack is caught
// centrally.  It exists because the `a11yAttr` slice shipped a latent
// strict-Handlebars throw: `{{{a11yAttr}}}` was added to primitive-button.hbs
// but only ONE of its five emit callers passed the key, so the OTHER callers
// (Action / DestroyForm) threw "a11yAttr not defined" — but only on the strict
// packs (shadcnSvelte), which no per-pack unit test exercised for those
// callers.  A scaffold system drives every button caller (Toolbar actions,
// per-operation Action buttons, the DestroyForm delete) + Skeleton + Icon
// through each pack, so:
//   1. generation MUST NOT throw (the strict-Handlebars tripwire), and
//   2. the framework-agnostic ARIA facts (role="toolbar", aria-hidden) are
//      present in the emitted output.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

// (packName, framework) — one row per JSX/markup pack the a11y contract covers.
// Feliz/HEEx render through their own procedural packs (own per-target tests)
// and don't share the Handlebars pack layer, so they're excluded here.
const PACKS: ReadonlyArray<{ pack: string; framework: string }> = [
  { pack: "mantine", framework: "react" },
  { pack: "shadcn", framework: "react" },
  { pack: "mui", framework: "react" },
  { pack: "chakra", framework: "react" },
  { pack: "vuetify", framework: "vue" },
  { pack: "shadcnVue", framework: "vue" },
  { pack: "shadcnSvelte", framework: "svelte" }, // strict Handlebars
  { pack: "flowbite", framework: "svelte" }, // strict Handlebars
  { pack: "angularMaterial", framework: "angular" },
  { pack: "primeng", framework: "angular" },
  { pack: "spartanNg", framework: "angular" },
];

// A scaffold system whose aggregate carries a public operation — so the emitted
// detail page drives the Toolbar, per-operation Action button, and DestroyForm
// delete button (the three non-emitButton primitive-button callers), plus the
// list page's loading Skeleton.
const system = (pack: string, framework: string): string => `
  system Shop {
    api ShopApi from Catalog
    subdomain Catalog {
      context Cat {
        aggregate Product with crudish {
          name: string
          operation archive() { }
        }
        repository Products for Product { }
      }
    }
    storage db { type: postgres }
    resource s { for: Cat, kind: state, use: db }
    ui WebApp with scaffold(aggregates: [Product]) { framework: ${framework} api Shop: ShopApi }
    deployable api { platform: node contexts: [Cat] dataSources: [s] serves: ShopApi port: 3000 }
    deployable web { platform: web design: "${pack}" targets: api ui: WebApp { Shop: api } port: 3005 }
  }
`;

describe("a11y contract — cross-pack render guard", () => {
  for (const { pack, framework } of PACKS) {
    it(`${pack} (${framework}): scaffold renders + carries the mechanical ARIA facts`, async () => {
      // 1. The strict-Handlebars tripwire — a template var no caller passes
      //    throws here rather than shipping a broken page.
      const files = await generateSystemFiles(system(pack, framework));
      const all = [...files.values()].join("\n");

      // 2. Framework-agnostic a11y facts (identical string across React JSX,
      //    Vue/Svelte/Angular templates): the header action cluster is a
      //    labelled toolbar, and decorative glyphs / loading placeholders are
      //    hidden from assistive tech.
      expect(all).toContain('role="toolbar"');
      expect(all).toContain('aria-hidden="true"');
    });
  }
});
