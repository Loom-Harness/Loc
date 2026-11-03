import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

// ---------------------------------------------------------------------------
// Custom validation messages on the Python/FastAPI backend — a named rule
// renders through the wire refine carrier (`@model_validator` raising
// `ValueError(<text>)`) and the domain floor (`_assert_invariants` raising
// `DomainError(<text>)`); an unnamed single-field rule keeps its native
// `Field(min_length=N)` constraint + the derived `Invariant violated:`
// default, byte-identical to before.
// ---------------------------------------------------------------------------

// The rules' English comes from the translator tree (`locales/en/Cat.json`); a
// test hands the generator the same overrides.
const TEXT = new Map([
  ["Cat.Product.rule.skuRequired", "SKU is required"],
  ["Cat.Product.rule.nameLength", "Name must be 2-120 characters"],
  ["Cat.Product.rule.amountPositive", "Amount must be positive"],
]);

const FIXTURE = `system S {
  subdomain Sales {
    context Cat {
      aggregate Product {
        sku: string check skuRequired: sku.length > 0
        name: string
        invariant nameLength: name.length >= 2 && name.length <= 120
        invariant sku.length > 0
        create(name: string, sku: string) { name := name  sku := sku }
      }
      repository Products for Product { }
    }
  }
  api CatApi from Sales
  storage db { type: postgres }
  resource st { for: Cat, kind: state, use: db }
  deployable api { platform: python contexts: [Cat] dataSources: [st] serves: CatApi port: 8080 }
}
`;

async function gen() {
  const files = await generateSystemFiles(FIXTURE, { sourceOverrides: TEXT });
  const key = (suffix: string) => [...files.keys()].find((k) => k.endsWith(suffix))!;
  return {
    domain: files.get(key("domain/product.py"))!,
    routes: files.get(key("http/product_routes.py"))!,
  };
}

describe("python — named rule → wire refine + domain floor text", () => {
  it("routes a named invariant/check through @model_validator PydanticCustomError(code, text)", async () => {
    const { routes } = await gen();
    expect(routes).toContain('@model_validator(mode="after")');
    expect(routes).toContain("from pydantic_core import InitErrorDetails, PydanticCustomError");
    // identity-key wire code (i18n key) + clean rule text, no "Value error,"
    // prefix — and the field's `loc`, so `errors[].pointer` names the field the
    // way every other backend's carrier does.  An error raised from a
    // `model_validator` carries no `loc` on its own, so it is raised through
    // `ValidationError.from_exception_data` (M-T1.11).
    expect(routes).toContain(
      'type=PydanticCustomError("Cat.Product.rule.nameLength", "Name must be 2-120 characters"),',
    );
    expect(routes).toContain('loc=("name",),');
    expect(routes).toContain(
      'type=PydanticCustomError("Cat.Product.rule.skuRequired", "SKU is required"),',
    );
    expect(routes).toContain('loc=("sku",),');
  });

  it("keeps an UNNAMED single-field rule as a native Field() constraint", async () => {
    const { routes } = await gen();
    expect(routes).toContain("sku: WireStr = Field(min_length=1)");
    // the unnamed rule never becomes a refine ValueError
    expect(routes).not.toContain('raise ValueError("Invalid value")');
  });
});
