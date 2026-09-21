import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// M-T1.12 slice 6, the Angular half — a form control announces its error.
//
// Angular is the one frontend that builds its form controls ITSELF (typed
// Reactive Forms in `angular/form-fields.ts`) rather than through a design-pack
// template or a UI-kit field component.  So the field aria the others inherit
// for free — Mantine's `error` prop, vuetify's `<v-text-field>`, formsnap on
// Svelte — had no equivalent here: the validator work rendered a visible
//
//     </mat-form-field>@if (f.controls.sku.invalid && f.controls.sku.touched) {
//       <p class="loom-error" data-testid="…-error-sku">Sku is invalid</p> }
//
// AFTER the control, and nothing tied the two together.  Sighted users saw the
// message; a screen reader announced neither the invalid state nor the text, on
// a form that looks correct in a screenshot.  (The standalone
// `Field { … error: … }` PRIMITIVE was never the gap — all three Angular packs'
// `primitive-field.hbs` have carried both attributes since slice 6; the FORM
// path is what was missing.)
//
// The remedy DIVERGES by pack style, and this file gates the divergence,
// because getting it uniform would have been the bug:
//
//   material — `MatInput` host-binds `[attr.aria-invalid]` from its own
//     `errorState`, and `MatFormField` derives the input's `aria-describedby`
//     from its `<mat-error>` children.  So the message moves INSIDE the form
//     field and Loom spells no ARIA at all.  Emitting it anyway would put a
//     second writer on one attribute — measured on a booted bundle, where
//     `aria-invalid` was present on load and was not ours.
//
//   primeng / spartanNg — plain `<input>`s with no directive managing either
//     attribute, so Loom spells both, bound to exactly the condition the
//     visible message is gated on.
// ---------------------------------------------------------------------------

const SOURCE = (design: string) => `
  system Shop {
    subdomain Sales {
      context Catalog {
        aggregate Product {
          sku: string
          name: string
          quantity: int
          invariant sku.length >= 3
          invariant quantity >= 1
          operation restock(amount: int) { precondition amount >= 1 }
        }
        repository Products for Product { }
      }
    }
    api CatalogApi from Sales
    ui WebApp {
      api Sales: CatalogApi
      page ProductNew {
        route: "/"
        body: CreateForm { of: Product, testid: "products-new" }
      }
      page ProductDetail {
        route: "/products/:id"
        body: OperationForm { of: Product, op: restock, testid: "products-restock" }
      }
    }
    storage primary { type: postgres }
    resource productsState { for: Catalog, kind: state, use: primary }
    deployable api {
      platform: node
      contexts: [Catalog]
      dataSources: [productsState]
      serves: CatalogApi
      port: 3000
    }
    deployable web {
      platform: angular
      targets: api
      ui: WebApp { Sales: api }
      port: 3004
      design: "${design}"
    }
  }
`;

async function pages(design: string): Promise<Map<string, string>> {
  const files = await generateSystemFiles(SOURCE(design));
  const out = new Map<string, string>();
  for (const [p, c] of files) {
    if (p.includes("/src/app/pages/")) out.set(p, c);
  }
  return out;
}

function pageWith(files: Map<string, string>, needle: string): string {
  for (const [, c] of files) if (c.includes(needle)) return c;
  throw new Error(`no generated page contains ${needle}`);
}

/** The packs whose inputs are RAW — Loom spells the ARIA itself there. */
const RAW_PACKS = ["primeng", "spartanNg"] as const;
const ALL_PACKS = ["angularMaterial", ...RAW_PACKS] as const;

describe("Angular form fields announce their validation errors", () => {
  // --- the raw packs: Loom spells both attributes -------------------------
  for (const design of RAW_PACKS) {
    it(`${design}: a constrained CREATE-form control carries aria-invalid + aria-describedby`, async () => {
      const page = pageWith(await pages(design), "products-new-input-sku");
      // The invalid STATE — bound, so the attribute is absent while the field
      // is valid or untouched.
      expect(page).toContain(
        `[attr.aria-invalid]="productForm.controls.sku.invalid && productForm.controls.sku.touched ? 'true' : null"`,
      );
      // The association to the message.
      expect(page).toContain(
        `[attr.aria-describedby]="productForm.controls.sku.invalid && productForm.controls.sku.touched ? 'products-new-error-sku' : null"`,
      );
      // …which must EXIST, or the reference dangles.  Same id, same condition.
      expect(page).toContain(`<p id="products-new-error-sku" class="loom-error"`);
      // The int field is constrained too — this is not a string-only arm.
      expect(page).toContain(`'products-new-error-quantity' : null"`);
      expect(page).toContain(`<p id="products-new-error-quantity" class="loom-error"`);
    });

    it(`${design}: an OPERATION form's precondition-constrained control carries it too`, async () => {
      const page = pageWith(await pages(design), "products-restock-input-amount");
      expect(page).toContain(
        `[attr.aria-describedby]="restockProductForm.controls.amount.invalid && restockProductForm.controls.amount.touched ? 'products-restock-error-amount' : null"`,
      );
      expect(page).toContain(`<p id="products-restock-error-amount" class="loom-error"`);
    });
  }

  // --- material: the library owns both, so the PLACEMENT is the fix -------
  it("angularMaterial: the message is a <mat-error> INSIDE the form field, and Loom adds no aria", async () => {
    const page = pageWith(await pages("angularMaterial"), "products-new-input-sku");
    // Inside: `MatFormField` only associates `<mat-error>` children with its
    // input.  The old output closed `</mat-form-field>` first and then rendered
    // a `<p>`, which the form field never saw.
    expect(page).toContain(
      `@if (productForm.controls.sku.invalid && productForm.controls.sku.touched) {<mat-error id="products-new-error-sku" data-testid="products-new-error-sku">Sku is invalid</mat-error>}</mat-form-field>`,
    );
    // And NOT a second writer on an attribute `MatInput` host-binds.
    expect(page).not.toContain("[attr.aria-invalid]");
    expect(page).not.toContain("[attr.aria-describedby]");
    // The op form takes the same placement.
    expect(pageWith(await pages("angularMaterial"), "products-restock-input-amount")).toContain(
      `<mat-error id="products-restock-error-amount"`,
    );
  });

  // --- both: an unconstrained field is untouched --------------------------
  for (const design of ALL_PACKS) {
    it(`${design}: an UNconstrained control is untouched (validator-free forms stay byte-identical)`, async () => {
      const page = pageWith(await pages(design), "products-new-input-name");
      // `name` carries no invariant, so it gets no validator, no message — and
      // therefore no aria, which would otherwise point at an id that is never
      // rendered.
      expect(page).not.toMatch(/aria-describedby[^"]*products-new-error-name/);
      expect(page).not.toContain("products-new-error-name");
    });
  }

  it("the describedby target and the message id are the same string, on every constrained field", async () => {
    // The structural version of the assertions above: every
    // `aria-describedby` target that appears anywhere in the emitted pages must
    // also appear as an `id=` on a rendered element.  This is what fails if the
    // two sites ever stop sharing `fieldErrorId`.
    for (const design of RAW_PACKS) {
      for (const [path, src] of await pages(design)) {
        const targets = [...src.matchAll(/aria-describedby\]="[^"]*'([^']+)' : null"/g)].map(
          (m) => m[1]!,
        );
        expect(targets.length, `${design} ${path}`).toBeGreaterThan(0);
        for (const id of targets) {
          expect(src, `${design} ${path}: aria-describedby -> ${id}`).toContain(`id="${id}"`);
        }
      }
    }
  });
});
