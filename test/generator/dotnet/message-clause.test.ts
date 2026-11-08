import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// Custom validation messages on the .NET backend — a named rule renders
// through the FluentValidation `.Must(...).WithMessage(<text>)` carrier and the
// `AssertInvariants` domain floor `DomainException(<text>)`; an unnamed rule
// keeps its native chain (a code-point `.Must`) + derived default unchanged.
// ---------------------------------------------------------------------------

// The rules' English comes from the translator tree (`locales/en/Cat.json`); a
// test hands the generator the same overrides.
const TEXT = new Map([
  ["Cat.Product.rule.skuRequired", "SKU is required"],
  ["Cat.Product.rule.nameLength", "Name must be 2-120 characters"],
  ["Cat.Product.rule.amountPositive", "Amount must be positive"],
]);

const SOURCE = `
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
    deployable api { platform: dotnet contexts: [Cat] dataSources: [st] serves: CatApi port: 8080 }
  }
`;

async function gen() {
  const all = await generateSystemFiles(SOURCE, { sourceOverrides: TEXT });
  const key = (suffix: string) => [...all.keys()].find((k) => k.endsWith(suffix))!;
  return {
    validator: all.get(key("Commands/CreateProductCommandValidator.cs"))!,
    domain: all.get(key("Domain/Products/Product.cs"))!,
  };
}

describe("dotnet — named rule → FluentValidation .WithMessage carrier", () => {
  it("routes a named invariant/check through .Must(...).WithMessage(text)", async () => {
    const { validator } = await gen();
    expect(validator).toContain(
      "RuleFor(x => x).Must(x => x.Name.EnumerateRunes().Count() >= 2 && x.Name.EnumerateRunes().Count() <= 120)",
    );
    expect(validator).toContain('.WithMessage("Name must be 2-120 characters")');
    expect(validator).toContain('.WithMessage("SKU is required")');
  });

  it("attaches a stable identity-key wire code via .WithErrorCode on a named rule", async () => {
    const { validator } = await gen();
    // The rules' identity keys (the removed `message` clause names them as the
    // codemod would).
    expect(validator).toContain(
      '.WithMessage("Name must be 2-120 characters")\n            .WithErrorCode("Cat.Product.rule.nameLength")',
    );
    expect(validator).toContain(
      '.WithMessage("SKU is required")\n            .WithErrorCode("Cat.Product.rule.skuRequired")',
    );
    // unnamed rule gets no error code.
    expect(validator).not.toContain('.WithErrorCode("msg." +');
  });

  it("keeps an UNNAMED invariant on the native chain", async () => {
    const { validator } = await gen();
    // A string LENGTH bound is a code-point `.Must`, not FluentValidation's
    // code-unit `.MinimumLength` (RS-31).
    expect(validator).toContain(
      `RuleFor(x => x.Sku).Must(v => v == null || v.EnumerateRunes().Count() >= 1)`,
    );
  });
});
