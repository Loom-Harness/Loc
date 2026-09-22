// ---------------------------------------------------------------------------
// `money` / `File` / `valueobject` as a declared `component` parameter — the
// three shapes the shared TypeScript prop layer had no spelling for
// (`loom.frontend-prop-type-unsupported`, register gap, M-T1.20).
//
// Before this landed, `component PriceTag(amount: money)` validated `0 error(s)`
// only because phase ⑦ refused the DECLARATION; bypass the gate and
// `componentPropTsType` threw a raw stack trace mid-generate.  Angular diverged
// a fourth way — its own `angularWireType` copy answered `unknown` for all
// three, so on that one frontend the gate was refusing a model that would have
// emitted silently-wrong types instead of crashing.
//
// The spellings, and why each is what it is:
//
//   money         `Decimal` — what `moneySchema` parses the wire's decimal
//                 string into, so it is what `<Agg>Response["price"]` holds.
//                 The binding arrives through the file's ONE
//                 `import Decimal from "decimal.js"`, never a second
//                 `import type { Decimal }` (that would be TS2300).
//   File          the four-field ref object, spelled structurally — there is no
//                 emitted `FileRef` alias to import, and the global DOM `File`
//                 is a different type.
//   valueobject   also structural, from the VO's own fields — the emitted
//                 `<VO>Schema` lives inside whichever aggregate's api module
//                 reaches it, so there is no import path a standalone prop can
//                 name.
//
// All four TS-prop frontends are asserted, because `TS_PROP_FRAMEWORKS` (the
// gate's own membership set) names all four — a fix that landed on three would
// leave the gate half-true.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const propSystem = (platform: string): string => `
  system Props {
    subdomain Shop {
      context Shop {
        valueobject Address {
          street: string
          zip: string
        }
        aggregate Product with crudish {
          sku: string
          price: money
          brochure: File
          shipTo: Address
          derived display: string = sku
        }
        repository Products for Product { }
      }
    }
    api ShopApi from Shop
    ui Web {
      api Shop: ShopApi
      component PriceTag(amount: money) { body: Text { string(amount) } }
      component Brochure(doc: File) { body: Text { doc.url } }
      component ShipPanel(at: Address) { body: Text { at.street } }
      page Home {
        route: "/"
        body: Heading { "Props", level: 1 }
      }
    }
    storage primary { type: postgres }
    storage files { type: localDisk }
    resource shopState { for: Shop, kind: state, use: primary }
    resource shopFiles { for: Shop, kind: objectStore, use: files }
    deployable api {
      platform: node, contexts: [Shop], dataSources: [shopState, shopFiles],
      serves: ShopApi, port: 4500
    }
    deployable web { platform: ${platform}, targets: api, ui: Web { Shop: api } }
  }
`;

const FILE_REF = "{ url: string; key: string; contentType: string; size: number }";

/** Concatenate every generated file so the assertions stay path-agnostic. */
function allFiles(files: Map<string, string>): string {
  let all = "";
  for (const content of files.values()) all += `\n${content}`;
  return all;
}

describe("a component parameter may be money / File / a value object", () => {
  // Per frontend: how it spells the prop declaration for each of the three.
  const CASES: ReadonlyArray<{ target: string; money: string; file: string; vo: string }> = [
    {
      target: "react",
      money: "amount: Decimal;",
      file: `doc: ${FILE_REF};`,
      vo: "at: { street: string; zip: string };",
    },
    {
      target: "vue",
      money: "amount: Decimal;",
      file: `doc: ${FILE_REF};`,
      vo: "at: { street: string; zip: string };",
    },
    {
      target: "svelte",
      money: "{ amount: Decimal }",
      file: `{ doc: ${FILE_REF} }`,
      vo: "{ at: { street: string; zip: string } }",
    },
    {
      target: "angular",
      money: "@Input() amount!: Decimal;",
      file: `@Input() doc!: ${FILE_REF};`,
      vo: "@Input() at!: { street: string; zip: string };",
    },
  ];

  for (const { target, money, file, vo } of CASES) {
    it(`${target}: each of the three declares its real type, never \`unknown\``, async () => {
      const out = allFiles(await generateSystemFiles(propSystem(target)));
      expect(out).toContain(money);
      expect(out).toContain(file);
      expect(out).toContain(vo);
      // Angular's own copy of the mapping answered `unknown` for all three; a
      // regression to it is a silent one, so name it.
      expect(out).not.toContain("amount!: unknown");
      expect(out).not.toContain("amount: unknown");
      expect(out).not.toContain("doc: unknown");
      expect(out).not.toContain("at: unknown");
    });

    it(`${target}: the money prop's file binds \`Decimal\` exactly once`, async () => {
      const files = await generateSystemFiles(propSystem(target));
      const priceTag = [...files.entries()].find(([p]) => /PriceTag\.(tsx|vue|svelte|ts)$/.test(p));
      expect(priceTag, "PriceTag component file").toBeDefined();
      const src = priceTag![1];
      // One import statement, whichever form the frontend uses — two would be
      // TS2300 ("Duplicate identifier 'Decimal'"), which is exactly what a
      // `dtoImports`-serialized `import type { Decimal }` beside the shell's
      // own default import would produce.
      const importCount = (src.match(/from ["']decimal\.js["']/g) ?? []).length;
      expect(importCount, `decimal.js imports in\n${src}`).toBe(1);
      // …and never the raw sentinel key leaking through an import serializer.
      expect(src).not.toContain('decimal.js";\nimport type { \u0000');
      expect(src).not.toContain("\u0000decimal");
    });
  }

  it("the generated package.json declares decimal.js for a money PROP ALONE", async () => {
    // `uiUsesMoney` looked only at `state {}` fields.  A money prop is the other
    // producer of a `Decimal` binding, and it only became reachable when the
    // prop layer learned to spell it — so the conditional-dep gate had to grow
    // with it or the file imports a package nothing installs.
    //
    // Deliberately a DIFFERENT system from the one above: there, `Product.price`
    // is money, so `contextUsesMoney` already answers true and this assertion
    // would pass with the gate untouched — a hollow check that never reaches
    // the thing it names.  Here NOTHING in the domain is money; the component
    // parameter is the only producer in the whole model.
    const moneyPropOnly = `
      system PropOnly {
        subdomain Shop {
          context Shop {
            aggregate Product with crudish {
              sku: string
              derived display: string = sku
            }
            repository Products for Product { }
          }
        }
        api ShopApi from Shop
        ui Web {
          api Shop: ShopApi
          component PriceTag(amount: money) { body: Text { string(amount) } }
          page Home {
            route: "/"
            body: PriceTag(amount: 0)
          }
        }
        storage primary { type: postgres }
        resource shopState { for: Shop, kind: state, use: primary }
        deployable api {
          platform: node, contexts: [Shop], dataSources: [shopState],
          serves: ShopApi, port: 4501
        }
        deployable web { platform: react, targets: api, ui: Web { Shop: api } }
      }
    `;
    const files = await generateSystemFiles(moneyPropOnly);
    // The premise: the component file really does bind `Decimal`…
    const priceTag = [...files.entries()].find(([p]) => p.endsWith("PriceTag.tsx"));
    expect(priceTag, "PriceTag component file").toBeDefined();
    expect(priceTag![1]).toContain("amount: Decimal;");
    // …so the package that provides it must be declared.
    const pkg = [...files.entries()].find(([p]) => p.endsWith("web/package.json"));
    expect(pkg, "frontend package.json").toBeDefined();
    expect(pkg![1]).toContain("decimal.js");
  });
});
