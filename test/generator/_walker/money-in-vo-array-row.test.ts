// A `money` cell inside a REPEATABLE ROW — `valueobject LineItem { sku: string
// price: money }` + `items: LineItem[]` on a form.
//
// A money row is a SECOND money renderer per pack: the flat field goes through
// `field-input-money.hbs`, a row cell through `field-input-array.hbs`'s row
// arms, which render the same single-field template at the row path.  The
// contract is the flat field's: the cell holds the TEXT the user typed (seeded
// `"0"` on a fresh row) and the request schema parses it by the form text rule
// (`src/ir/plan/form-text.ts`) — no `Decimal` is built in the template, and the
// cell never falls through to the generic string arm.
//
// Angular builds its controls in `src/generator/angular/form-fields.ts`, where a
// money control holds the typed string too; the last case pins it.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const PAGE_OF: Record<string, RegExp> = {
  react: /\/src\/pages\/new_order\.tsx$/,
  vue: /\/src\/pages\/new_order\.vue$/,
  svelte: /\+page\.svelte$/,
  angular: /\/src\/app\/pages\/new-order\.component\.ts$/,
};

const SYSTEM = (framework: string, design: string): string => `
system S {
  subdomain D {
    context C {
      valueobject LineItem { sku: string  qty: int  price: money }
      aggregate Order with crudish {
        reference: string
        items: LineItem[]
      }
      repository Orders for Order { }
    }
  }
  api Api from D
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  ui W {
    framework: ${framework}
    api C: Api
    page NewOrder {
      route: "/new"
      body: Stack { CreateForm { of: Order } }
    }
  }
  deployable api { platform: node, contexts: [C], dataSources: [st], serves: Api, port: 3000 }
  deployable web { platform: web, targets: api, ui: W { C: api }, port: 3001, design: "${design}" }
}
`;

async function page(framework: string, design: string): Promise<string> {
  const files = await generateSystemFiles(SYSTEM(framework, design));
  const found = [...files].find(([k]) => PAGE_OF[framework]!.test(k))?.[1];
  expect(
    found,
    `no page emitted for ${framework}/${design}: ${[...files.keys()].join(", ")}`,
  ).toBeDefined();
  return found!;
}

/** Every pack whose `field-input-array` template renders row cells, with the
 *  frontend it belongs to.  The React list is `reactBuildPacks`; the Vue and
 *  Svelte lists are their build matrices' pack axes. */
const PACKS: { framework: string; design: string }[] = [
  { framework: "react", design: "mantine@v9" },
  { framework: "react", design: "shadcn@v4" },
  { framework: "react", design: "mui@v7" },
  { framework: "react", design: "chakra@v3" },
  { framework: "vue", design: "vuetify@v3" },
  { framework: "vue", design: "shadcnVue@v1" },
  { framework: "svelte", design: "shadcnSvelte@v1" },
  { framework: "svelte", design: "flowbite@v1" },
];

describe.each(PACKS)("money in a row group — $framework/$design", ({ framework, design }) => {
  it('seeds a fresh row\'s money cell with the text "0"', async () => {
    const src = await page(framework, design);
    // The `append(...)` / `push(...)` seed.
    expect(src).toContain('price: "0"');
    // Non-money cells keep their own seeds.
    expect(src).toContain('sku: ""');
    expect(src).toContain("qty: 0");
  });

  it("routes the money cell through the money arm, holding the typed text", async () => {
    const src = await page(framework, design);
    if (framework === "react") {
      // The pack's `field-input-money` input bound at the row path.
      expect(src).toContain("name={`items.${index}.price`}");
      expect(src).not.toContain("register(`items.${index}.price`");
    }
    // The money arm's decimal keyboard; no Decimal is built from the text.
    expect(src).toMatch(/inputMode="decimal"|inputmode="decimal"|inputMode: "decimal"/);
    expect(src).not.toContain("new Decimal(");
    // A money cell is never a JS number: no `valueAsNumber` registration.
    expect(src).not.toMatch(/items\.\$\{index\}\.price`?, \{ valueAsNumber/);
  });
});

describe("money in a row group — angular holds the typed text", () => {
  it("seeds the row control with a string, and imports no Decimal for it", async () => {
    const src = await page("angular", "angularMaterial@v1");
    expect(src).toContain('price: new FormControl("0"');
    expect(src).toContain('inputmode="decimal"');
    expect(src).not.toContain("new Decimal(");
  });
});
