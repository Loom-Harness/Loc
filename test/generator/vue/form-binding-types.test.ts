// The generated Vue app has to pass its OWN `npm run build`, whose first half is
// `vue-tsc --noEmit`.  The 2026-09-10 e-shop dev-experience audit (§P4) measured
// 31 errors on a ~300-line model — every one of them emitted by a SCAFFOLDED
// page, in three classes, none of which the `generated-vue-build` corpus carried:
//
//   TS18049  `'updateForm.values.shipping' is possibly 'null' or 'undefined'`
//            — an optional VALUE OBJECT dereferenced by its own form group.
//   TS2322   `Type 'string' is not assignable to type 'Decimal'`
//            — a `money` field: the input model is a `Decimal`, and the vue
//              packs' `field-input-money` template wrote a bare string into it.
//   TS2322   `'string | null | undefined'` → `'string | number | undefined'`
//            — an optional scalar bound to a typed pack input.
//
// The first and third are one defect: `LoomForm.values` was typed straight off
// the wire schema, so every field carried the request type's `| null |
// undefined`.  That is a WIRE fact ("the client may omit it"), not a fact about
// the bound value — `useLoomForm` SEEDS every field the form renders.  The fix
// is `FormValues<T>` in `vue/loom-form.hbs`, the twin of the Svelte runtime's,
// recursing so a nested optional sub-field is stripped too.  The second is the
// pack templates, which now write a `Decimal` (what `moneySchema` documents as
// the form-state shape, and what the Svelte packs already did).
//
// The end-to-end proof is the `scaffold` case of `test/e2e/generated-vue-build.
// test.ts`, which carries all of these shapes and type-checks the real project;
// this suite pins the emitted shapes in the fast tier.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SRC = `
system Shop {
  subdomain Sales {
    context Orders {
      valueobject Address { line1: string  line2: string?  city: string }
      enum Tier { Bronze, Silver, Gold }
      aggregate Customer with crudish {
        email: string
        shipping: Address?
        tier: Tier?
      }
      aggregate Product with crudish {
        name: string
        price: money
        description: string?
        derived display: string = name
      }
    }
  }
  api SalesApi from Sales
  ui WebApp with scaffold(subdomains: [Sales]) { api Sales: SalesApi }
  storage primary { type: postgres }
  resource ordersState { for: Orders, kind: state, use: primary }
  deployable api { platform: node contexts: [Orders] dataSources: [ordersState] serves: SalesApi port: 8080 }
  deployable web { platform: vue targets: api ui: WebApp { Sales: api } port: 3000 design: "shadcnVue@v1" }
}
`;

async function files(src = SRC): Promise<Map<string, string>> {
  const all = await generateSystemFiles(src);
  const out = new Map<string, string>();
  for (const [p, content] of all) {
    if (p.startsWith("web/")) out.set(p.slice("web/".length), content);
  }
  return out;
}

describe("vue form runtime — the bound value type", () => {
  it("types `values` as the null-stripped draft, not the raw wire type", async () => {
    const form = (await files()).get("src/lib/form.ts")!;
    expect(form).toContain("values: FormValues<T>;");
    // The old signature is what handed every binding a `T | null | undefined`.
    expect(form).not.toContain("  values: T;");
  });

  it("strips `null | undefined` at EVERY depth", async () => {
    // The nested arm is the whole point: a one-level strip left
    // `values.shipping.line2` nullish, one level below where it stopped.
    const form = (await files()).get("src/lib/form.ts")!;
    expect(form).toContain("{ [K in keyof T]-?: FormValues<NonNullable<T[K]>> }");
  });

  it("stops the recursion at class instances so a `Decimal` survives", async () => {
    // Mapping over `Decimal`'s members would strip its call signatures and
    // break `new Decimal(...)` assignment.  The guard is structural on purpose:
    // `decimal.js` is a CONDITIONAL dependency of the generated project (each
    // pack's package.json adds it only when the model uses money), so this
    // runtime file — which money-free projects emit too — must not name it.
    const form = (await files()).get("src/lib/form.ts")!;
    expect(form).toContain("T extends Record<string, unknown>");
    expect(form).not.toContain(`from "decimal.js"`);
  });

  it("keeps a `File` field nullable — 'nothing uploaded yet' is a real state", async () => {
    const form = (await files()).get("src/lib/form.ts")!;
    expect(form).toContain("T extends FileRefValue\n  ? T | null");
  });
});

describe("vue money form binding", () => {
  it("writes a Decimal into the form value, not a string", async () => {
    const page = (await files()).get("src/pages/products/new.vue")!;
    expect(page).toContain("form.values.price = new Decimal(");
    // The defect: `Type 'string' is not assignable to type 'Decimal'`.
    expect(page).not.toContain(`form.values.price = String(v || '0')`);
  });

  it("reads the Decimal back as a string for the input model", async () => {
    const page = (await files()).get("src/pages/products/new.vue")!;
    expect(page).toContain("form.values.price instanceof Decimal");
    expect(page).toContain("form.values.price.toString()");
  });

  it("pulls decimal.js into the SFC that names Decimal", async () => {
    const page = (await files()).get("src/pages/products/new.vue")!;
    expect(page).toContain(`import Decimal from "decimal.js";`);
  });
});
