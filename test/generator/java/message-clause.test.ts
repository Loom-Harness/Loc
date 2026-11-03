import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// Custom validation messages on the Java/Spring Boot backend — a named
// rule surfaces the rule text on the wire validator
// (`WireValidationException.error("/path", <text>)`) AND the domain floor
// (`throw new DomainException(<text>)`); an unnamed rule keeps its
// derived `Invariant violated:` default, byte-identical.
// ---------------------------------------------------------------------------

// The rules' English comes from the translator tree (`locales/en/Cat.json`); a
// test hands the generator the same overrides.
const TEXT = new Map([
  ["Cat.Product.rule.skuRequired", "SKU is required"],
  ["Cat.Product.rule.nameLength", "Name must be 2-120 characters"],
  ["Cat.Product.rule.amountPositive", "Amount must be positive"],
]);

const SRC = `
system S {
  subdomain Sales {
    context Cat {
      aggregate Product {
        sku: string check skuRequired: sku.length > 0
        name: string
        invariant nameLength: name.length >= 2 && name.length <= 120
        invariant sku.length > 0
        create(name: string, sku: string) { }
      }
      repository Products for Product { }
    }
  }
  api CatApi from Sales
  storage db { type: postgres }
  resource st { for: Cat, kind: state, use: db }
  deployable api { platform: java contexts: [Cat] dataSources: [st] serves: CatApi port: 8080 }
}
`;

async function gen() {
  const all = await generateSystemFiles(SRC, { sourceOverrides: TEXT });
  const key = (suffix: string) => [...all.keys()].find((k) => k.endsWith(suffix))!;
  return {
    domain: all.get(key("features/products/Product.java"))!,
    validator: all.get(key("features/products/CreateProductValidator.java"))!,
  };
}

describe("java — named rule → wire validator + domain floor text", () => {
  it("surfaces the rule text + an identity-key wire code via rejectValue", async () => {
    const { validator } = await gen();
    // named rule → rejectValue(field, "<Ctx>.<Owner>.rule.<name>", <text>) carrying the i18n key
    expect(validator).toContain(
      'errors.rejectValue("name", "Cat.Product.rule.nameLength", "Name must be 2-120 characters")',
    );
    expect(validator).toContain(
      'errors.rejectValue("sku", "Cat.Product.rule.skuRequired", "SKU is required")',
    );
  });

  it("keeps an UNNAMED single-field rule with the sentinel code (no wire code)", async () => {
    const { validator } = await gen();
    // The unnamed `invariant sku.length > 0` uses the `loom.invariant`
    // sentinel code, which the advice does NOT surface as a wire `code`.
    expect(validator).toContain(
      'errors.rejectValue("sku", "loom.invariant", "Sku must be at least 1 character")',
    );
  });
});
