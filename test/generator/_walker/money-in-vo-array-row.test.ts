// A `money` cell inside a REPEATABLE ROW — `valueobject LineItem { sku: string
// price: money }` + `items: LineItem[]` on a form.
//
// A money row is a SECOND money renderer per pack.  The flat field goes through
// `field-input-money.hbs`; a row cell goes through `field-input-array.hbs`,
// which owns its own per-sub-field arms and shares no markup with the flat
// template.  When #2876 taught every flat arm to hold a real `Decimal` (form
// state carries an already-constructed Decimal — `moneySchema`'s own contract),
// the row arms were left behind: the money cell fell through to the generic
// STRING arm and `defaultRowValue` seeded a fresh row with the string `"0"`.
//
// The two frontends that type form state on the schema's OUTPUT type said so —
// `vue-tsc` and `svelte-check` both reported "Type 'string' is not assignable to
// type 'Decimal'" on the `push(...)` seed (2026-09-10 e-shop audit, P8).  React
// types its form on `z.input` (`Decimal | string`), so its own gate stayed green
// while its row templates drifted, which is why this test asserts the CONTRACT
// (a constructed Decimal, an arm that reads one back) on every pack rather than
// leaning on any one frontend's type-checker.
//
// Angular is deliberately NOT in the contract: it builds its controls from its
// own `src/generator/angular/form-fields.ts`, where wire `money` is a `string`
// end to end.  The last case pins that divergence so a future "fix" that drags
// a `Decimal` into an Angular FormControl fails here rather than at `ng build`.

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
  deployable web { platform: static, targets: api, ui: W { C: api }, port: 3001, design: "${design}" }
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
  { framework: "react", design: "mantine@v7" },
  { framework: "react", design: "mantine@v9" },
  { framework: "react", design: "shadcn@v3" },
  { framework: "react", design: "shadcn@v4" },
  { framework: "react", design: "mui@v5" },
  { framework: "react", design: "mui@v7" },
  { framework: "react", design: "chakra@v2" },
  { framework: "react", design: "chakra@v3" },
  { framework: "vue", design: "vuetify@v3" },
  { framework: "vue", design: "shadcnVue@v1" },
  { framework: "svelte", design: "shadcnSvelte@v1" },
  { framework: "svelte", design: "flowbite@v1" },
];

describe.each(PACKS)("money in a row group — $framework/$design", ({ framework, design }) => {
  it("seeds a fresh row with a constructed Decimal, not a string", async () => {
    const src = await page(framework, design);
    // The `append(...)` / `push(...)` seed.  `"0"` here is the whole P8 defect:
    // `moneySchema`'s OUTPUT (what Vue's and Svelte's `FormValues<T>` bind) is
    // `Decimal`, and a string is not one.
    expect(src).toContain('price: new Decimal("0")');
    expect(src).not.toContain('price: "0"');
    // Non-money cells keep their own seeds — this is a money-only change.
    expect(src).toContain('sku: ""');
    expect(src).toContain("qty: 0");
  });

  it("imports the Decimal the seed constructs", async () => {
    // Every JS frontend's page shell decides this import by scanning its own
    // assembled source (`usesDecimalBinding`), so the row arm needs no import
    // wiring of its own — but an unimported `Decimal` is a hard build failure,
    // so assert the scan actually reaches the form fragment.
    const src = await page(framework, design);
    expect(src).toMatch(/import (\{ )?Decimal( \})? from "decimal\.js"/);
  });

  it("routes the money cell through a money arm, not the generic string arm", async () => {
    const src = await page(framework, design);
    if (framework === "react") {
      // RHF `register` hands back the raw input string; `setValueAs` is what
      // turns it into the `Decimal` the form state is declared to hold.
      expect(src).toMatch(/items\.\$\{index\}\.price`, \{ setValueAs:/);
      expect(src).toContain('return new Decimal(v || "0");');
    } else {
      // Vue / Svelte bind the value directly, so the cell must READ a Decimal
      // back out as a string — the same `instanceof Decimal` shape the flat
      // `field-input-money` arm uses.
      expect(src).toMatch(/items\[index\]\.price instanceof Decimal/);
      expect(src).toMatch(/items\[index\]\.price = new Decimal\(/);
    }
    // The generic string arm is what the cell used to fall through to.
    expect(src).not.toMatch(/items\[index\]\.price = String\(/);
    expect(src).not.toMatch(/bind:value=\{form\.values\.items\[index\]\.price\s/);
  });
});

describe("money in a row group — angular keeps its string-shaped control", () => {
  it("seeds the row control with a string, and imports no Decimal for it", async () => {
    // Angular's row controls come from `src/generator/angular/form-fields.ts`,
    // not the shared `_walker/form-fields-vm.ts` seed — its wire `money` is a
    // `string` on both sides, so the P8 defect never reached it.  Pinned so the
    // divergence stays deliberate.
    const src = await page("angular", "angularMaterial@v1");
    expect(src).toContain('price: new FormControl("0"');
    expect(src).toContain('inputmode="decimal"');
    expect(src).not.toContain("new Decimal(");
  });
});
