import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// Angular generator — invariant-derived client-side form validation.
//
// The aggregate's wire-translatable `invariant`s fold into per-field
// `Validators.*` on the typed Reactive `FormControl` — the Angular twin of the
// zod native chain the other JSX frontends emit on `Create<Agg>Request`.  The
// classification runs through the SAME shared `takeSingleFieldChain` gate, so
// Angular admits a constraint iff React/Vue/Svelte do.
// ---------------------------------------------------------------------------

const SOURCE = `
  system Shop {
    subdomain Sales {
      context Catalog {
        aggregate Product with crudish {
          sku: string
          name: string
          quantity: int
          price: decimal
          invariant sku.matches("^[A-Z0-9-]+$")
          invariant name.length >= 2 && name.length <= 120
          invariant quantity >= 1
          invariant price >= 0
        }
        repository Products for Product { }
      }
    }
    api CatalogApi from Sales
    ui WebApp {
      framework: angular
      api Sales: CatalogApi
      page ProductNew {
        route: "/"
        body: CreateForm { of: Product, testid: "products-new" }
      }
    }
    storage primary { type: postgres }
    resource productsState { for: Catalog, kind: state, use: primary }
    deployable api {
      platform: node
      contexts: [Catalog]
      dataSources: [productsState]
      serves: CatalogApi
      port: 8080
    }
    deployable web {
      platform: web
      targets: api
      ui: WebApp { Sales: api }
      port: 3005
    }
  }
`;

async function formPage(): Promise<string> {
  const all = await generateSystemFiles(SOURCE);
  return all.get("web/src/app/pages/product-new.component.ts")!;
}

describe("angular generator — invariant-derived form Validators", () => {
  it("folds single-field invariants into Validators on each FormControl", async () => {
    const page = await formPage();
    // regex → an inline pattern check that judges the blank text too (a
    // required field's blank is a value; `Validators.pattern` skips it).
    expect(page).toContain(
      'sku: new FormControl("", { nonNullable: true, validators: [((c: AbstractControl) => /^[A-Z0-9-]+$/.test(String(c.value ?? "")) ? null : { pattern: { requiredPattern: String(/^[A-Z0-9-]+$/), actualValue: c.value } })] })',
    );
    // length range → a code-point min + a code-point max.  NOT
    // `Validators.minLength/maxLength`: those count UTF-16 code units while
    // the `minLength`/`maxLength` the server publishes for this same field
    // are JSON-Schema code points (F2-XB-2).
    expect(page).toContain(
      'name: new FormControl("", { nonNullable: true, validators: [((c: AbstractControl) => [...String(c.value ?? "")].length >= 2 ? null : { minlength: { requiredLength: 2 } }), ((c: AbstractControl) => [...String(c.value ?? "")].length <= 120 ? null : { maxlength: { requiredLength: 120 } })] })',
    );
    // The UTF-16 built-ins must not survive anywhere in the file.
    expect(page).not.toContain("Validators.minLength");
    expect(page).not.toContain("Validators.maxLength");
    // int >= 1 → an inline bound that judges a cleared control as the 0 it
    // submits (`Validators.min` skips an empty control).
    expect(page).toContain(
      'quantity: new FormControl(0, { nonNullable: true, validators: [((c: AbstractControl) => Number(c.value || 0) >= 1 ? null : { "min": { min: 1, actual: c.value } })] })',
    );
    // decimal >= 0 → the same, at 0.
    expect(page).toContain(
      'price: new FormControl(0, { nonNullable: true, validators: [((c: AbstractControl) => Number(c.value || 0) >= 0 ? null : { "min": { min: 0, actual: c.value } })] })',
    );
  });

  it("imports AbstractControl, not Validators, for inline validators", async () => {
    const page = await formPage();
    expect(page).toContain(
      'import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule } from "@angular/forms";',
    );
  });

  it("marks all fields touched on a blocked submit so errors reveal", async () => {
    const page = await formPage();
    expect(page).toContain(
      "if (this.productForm.invalid) { this.productForm.markAllAsTouched(); return; }",
    );
  });

  it("renders an inline error per validated field, gated on touched", async () => {
    const page = await formPage();
    // On the MATERIAL pack the message is a `<mat-error>` INSIDE the form
    // field — the only placement `MatFormField` associates with its input
    // (M-T1.12 slice 6; the raw-pack `<p>` shape is pinned in
    // `field-aria.test.ts`).
    expect(page).toContain(
      // A server 422's message for the field (`errors.server`) takes the slot
      // over the client sentence.
      '@if (productForm.controls.sku.invalid && productForm.controls.sku.touched) {<mat-error id="products-new-error-sku" data-testid="products-new-error-sku">@if (productForm.controls.sku.errors?.[\'server\']; as serverError) { {{ serverError }} } @else { Not in the expected format }</mat-error>}</mat-form-field>',
    );
    expect(page).toContain('data-testid="products-new-error-quantity"');
  });
});

// ---------------------------------------------------------------------------
// Operation forms fold the same source as the zod `<Op>Request`: the
// aggregate's invariants + the op's preconditions, gated to the op's params.
// ---------------------------------------------------------------------------

const OP_SOURCE = `
  system Shop {
    subdomain Sales {
      context Catalog {
        aggregate Product with crudish {
          name: string
          quantity: int
          operation restock(amount: int) {
            precondition amount >= 1
            quantity := quantity + amount
          }
        }
        repository Products for Product { }
      }
    }
    api CatalogApi from Sales
    ui WebApp {
      framework: angular
      api Sales: CatalogApi
      page ProductRestock {
        route: "/products/:id/restock"
        body: OperationForm(of: Product, op: restock)
      }
    }
    storage primary { type: postgres }
    resource productsState { for: Catalog, kind: state, use: primary }
    deployable api {
      platform: node
      contexts: [Catalog]
      dataSources: [productsState]
      serves: CatalogApi
      port: 8080
    }
    deployable web {
      platform: web
      targets: api
      ui: WebApp { Sales: api }
      port: 3006
    }
  }
`;

describe("angular generator — operation-form Validators", () => {
  it("folds the op precondition into a min bound on the param control", async () => {
    const all = await generateSystemFiles(OP_SOURCE);
    const page = all.get("web/src/app/pages/product-restock.component.ts")!;
    expect(page).toContain(
      'amount: new FormControl(0, { nonNullable: true, validators: [((c: AbstractControl) => Number(c.value || 0) >= 1 ? null : { "min": { min: 1, actual: c.value } })] })',
    );
    expect(page).toContain(
      "import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule }",
    );
    expect(page).toContain(
      "if (this.restockProductForm.invalid) { this.restockProductForm.markAllAsTouched(); return; }",
    );
    expect(page).toContain('data-testid="products-op-restock-error-amount"');
  });
});

// ---------------------------------------------------------------------------
// F2-XB-2 — a form whose ONLY wire constraint is a `len-*` bound emits inline
// code-point `ValidatorFn`s and never spells `Validators`, so the import must
// not be registered (an unused import is a `tsc` error in the generated
// project).
// ---------------------------------------------------------------------------

const LEN_ONLY_SOURCE = `
  system Shop {
    subdomain Sales {
      context Catalog {
        aggregate Product with crudish {
          sku: string
          invariant sku.length <= 8
        }
        repository Products for Product { }
      }
    }
    api CatalogApi from Sales
    ui WebApp {
      framework: angular
      api Sales: CatalogApi
      page ProductNew {
        route: "/"
        body: CreateForm { of: Product, testid: "products-new" }
      }
    }
    storage primary { type: postgres }
    resource productsState { for: Catalog, kind: state, use: primary }
    deployable api {
      platform: node
      contexts: [Catalog]
      dataSources: [productsState]
      serves: CatalogApi
      port: 8080
    }
    deployable web {
      platform: web
      targets: api
      ui: WebApp { Sales: api }
      port: 3007
    }
  }
`;

describe("angular generator — code-point length validators", () => {
  it("a length-only form imports AbstractControl and not Validators", async () => {
    const all = await generateSystemFiles(LEN_ONLY_SOURCE);
    const page = all.get("web/src/app/pages/product-new.component.ts")!;
    expect(page).toContain(
      'import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule } from "@angular/forms";',
    );
    expect(page).not.toContain("Validators");
    expect(page).toContain(
      '[...String(c.value ?? "")].length <= 8 ? null : { maxlength: { requiredLength: 8 } }',
    );
  });
});

describe("angular generator — exclusive numeric bounds", () => {
  const source = SOURCE.replace(
    "invariant price >= 0",
    "invariant price > 0.5\n          invariant price < 9.5",
  );

  it("emits an inline exclusive ValidatorFn that rejects the boundary value", async () => {
    const all = await generateSystemFiles(source);
    const page = all.get("web/src/app/pages/product-new.component.ts")!;
    expect(page).not.toContain("Validators.min(0.5)");
    expect(page).not.toContain("Validators.max(9.5)");
    const compile = (key: string): ((c: { value: unknown }) => unknown) => {
      const m = page.match(
        new RegExp(
          `\\(\\(c: AbstractControl\\) => Number\\(c\\.value \\|\\| 0\\) [<>] [\\d.]+ \\? null : \\{ "${key}": [^}]*\\} \\}\\)`,
        ),
      );
      expect(m, key).toBeTruthy();
      return new Function(`return ${m![0].replace(": AbstractControl", "")}`)() as never;
    };
    const gt = compile("greater-than");
    expect(gt({ value: 0.5 })).not.toBeNull();
    expect(gt({ value: 0.6 })).toBeNull();
    // A cleared required control is the 0 it submits, which `> 0.5` refuses.
    expect(gt({ value: "" })).not.toBeNull();
    const lt = compile("less-than");
    expect(lt({ value: 9.5 })).not.toBeNull();
    expect(lt({ value: 9.4 })).toBeNull();
  });
});
