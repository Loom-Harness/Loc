import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// Custom validation messages on the vanilla Phoenix/Ecto backend — a named
// rule (single-field OR cross-field) routes through the `validate_invariants/1`
// residual carrier, whose `add_error` carries the rule text AND the stable
// identity-key wire `code` as `loom_code:` metadata (Ecto's native validators
// can't carry a custom key). An UNNAMED single-field rule keeps its native
// `validate_*` line, byte-identical.
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
  deployable api { platform: elixir contexts: [Cat] dataSources: [st] serves: CatApi port: 8080 }
}
`;

async function changeset() {
  const all = await generateSystemFiles(SRC, { sourceOverrides: TEXT });
  const key = [...all.keys()].find((k) => k.endsWith("cat/product_changeset.ex"))!;
  return all.get(key)!;
}

describe("elixir/vanilla — named single-field rule → residual carrier + wire code", () => {
  it("routes a named single-field rule through validate_invariants with loom_code", async () => {
    const cs = await changeset();
    // `.length` predicates render against the applied struct via the shared
    // CODE-POINT count (RS-31 — `String.length/1` counts graphemes); add_error
    // carries the rule text + the identity-key wire code.
    expect(cs).toContain(
      'if length(String.to_charlist(data.name)) >= 2 and length(String.to_charlist(data.name)) <= 120, do: changeset, else: add_error(changeset, :name, "Name must be 2-120 characters", loom_code: "Cat.Product.rule.nameLength", loom_pointer: "/name")',
    );
    expect(cs).toContain(
      'if length(String.to_charlist(data.sku)) > 0, do: changeset, else: add_error(changeset, :sku, "SKU is required", loom_code: "Cat.Product.rule.skuRequired", loom_pointer: "/sku")',
    );
    // A named rule no longer emits a native validate_* line with `message:`.
    expect(cs).not.toContain('message: "Name must be 2-120 characters"');
    expect(cs).not.toContain('message: "SKU is required"');
  });

  it("keeps an UNNAMED single-field rule on the native validator chain", async () => {
    const cs = await changeset();
    // A length bound is the one pattern that is NOT a native `validate_*` call:
    // Ecto counts graphemes and offers no `:codepoints` option, so it rides a
    // `validate_change/3` closure over the shared code-point count instead
    // (RS-31).  Still the native chain — not the residual carrier.
    expect(cs).toContain("|> validate_change(:sku, fn _, value ->");
    expect(cs).toContain(
      '[{:sku, {"Sku must be at least 1 character", count: 1, validation: :length, kind: :min, type: :string}}]',
    );
  });
});

// A named CROSS-FIELD rule likewise routes through the `validate_invariants/1`
// residual carrier, whose `add_error` carries the stable content-hash wire
// `code` as `loom_code:` metadata; the 422 handler surfaces it as
// `errors[].code`.
const CROSS = `
system S {
  subdomain Sales {
    context Cat {
      aggregate Account with crudish {
        handle: string
        email: string
        invariant handle.length > 0
        invariant handleDiffersEmail: handle != email
      }
      repository Accounts for Account { }
    }
  }
  api CatApi from Sales
  storage db { type: postgres }
  resource st { for: Cat, kind: state, use: db }
  deployable api { platform: elixir contexts: [Cat] dataSources: [st] serves: CatApi port: 8080 }
}
`;

describe("elixir/vanilla — named cross-field rule → wire code", () => {
  it("attaches loom_code metadata on the validate_invariants add_error", async () => {
    const all = await generateSystemFiles(CROSS, {
      sourceOverrides: new Map([
        ["Cat.Account.rule.handleDiffersEmail", "Handle and email must differ"],
      ]),
    });
    const cs = all.get([...all.keys()].find((k) => k.endsWith("cat/account_changeset.ex"))!)!;
    expect(cs).toContain(
      'add_error(changeset, :handle, "Handle and email must differ", loom_code: "Cat.Account.rule.handleDiffersEmail", loom_pointer: "")',
    );
  });
});
