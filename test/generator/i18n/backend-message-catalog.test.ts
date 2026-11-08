import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// No backend ships a message catalog.
//
// The server never translates a response (#4473): every refusal carries the
// catalog `code` a client localizes it by, and `errors[].message` stays the
// English.  A NAMED `invariant` / `check` / `precondition` puts its identity
// key `<Ctx>.<Owner>.rule.<name>` as that `code`; the ONE catalog for
// translators is the system's `.loom/messages.en.json`, and a `locales/en`
// override changes the English every backend answers.
//
// Asserted per backend: no runtime catalog file and no locale lookup at the
// 422 chokepoint, and every named rule's identity key spelled as a code.
// ---------------------------------------------------------------------------
const DOMAIN = `
      aggregate Product {
        sku: string check skuRequired: sku.length > 0
        name: string
        qty: int
        invariant nameLength: name.length >= 2 && name.length <= 120
        invariant qty >= 0
        create(name: string, sku: string, qty: int) { }
        operation restock(amount: int) {
          precondition amountPositive: amount >= 1
          qty := qty + amount
        }
      }
      repository Products for Product { }
`;

/** The same system on each backend, so the catalogs are directly comparable. */
const src = (platform: string, domain = DOMAIN) => `
  system S {
    subdomain Sales {
      context Cat {
${domain}
      }
    }
    api CatApi from Sales
    storage db { type: postgres }
    resource st { for: Cat, kind: state, use: db }
    deployable api { platform: ${platform} contexts: [Cat] dataSources: [st] serves: CatApi port: 8080 }
  }
`;

const NAME_CODE = "Cat.Product.rule.nameLength";
const SKU_CODE = "Cat.Product.rule.skuRequired";
const AMOUNT_CODE = "Cat.Product.rule.amountPositive";
const ALL_CODES = [AMOUNT_CODE, NAME_CODE, SKU_CODE].sort();

async function filesFor(platform: string, domain?: string): Promise<Map<string, string>> {
  return generateSystemFiles(src(platform, domain));
}

/** The catalog file for a backend, found by suffix (java/dotnet route files
 *  through a layout adapter, so an exact path would be layout-coupled). */
function bySuffix(files: Map<string, string>, suffix: string): string | undefined {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  return key ? files.get(key) : undefined;
}

describe("node/Hono — no catalog: the 422 answers the code, the client localizes", () => {
  it("ships no message catalog and no locale lookup", async () => {
    const files = await filesFor("node");
    expect(bySuffix(files, "http/messages.ts")).toBeUndefined();
    const problem = bySuffix(files, "http/problem-details.ts")!;
    expect(problem).not.toContain("localizeMessage");
    // The entry answers the English message with its catalog code beside it.
    expect(problem).toContain(
      "return { pointer, message: issue.message, code: issueCode(issue), ...(params ? { params } : {}) };",
    );
  });

  it("each named rule's refine carries its identity key as the code", async () => {
    const all = [...(await filesFor("node")).values()].join("\n");
    for (const code of ALL_CODES) expect(all).toContain(`loomCode: "${code}"`);
  });
});

describe(".NET — no catalog: the 422 answers the code, the client localizes", () => {
  it("ships no message catalog and no locale lookup", async () => {
    const files = await filesFor("dotnet");
    expect(bySuffix(files, "Localization/LoomMessages.cs")).toBeUndefined();
    const filter = bySuffix(files, "Api/DomainExceptionFilter.cs")!;
    expect(filter).not.toContain("LoomMessages");
    // Every rule names its catalog code, an unnamed one included.
    expect(filter).toContain('err["code"] = e.ErrorCode');
  });

  it("routes a named PRECONDITION onto the carrier with its text + code", async () => {
    // The op validator dropped `message` when lifting preconditions, silently
    // downgrading an authored precondition to the generic text and
    // costing it the wire `code` every other backend keyed.
    const validator = bySuffix(await filesFor("dotnet"), "RestockCommandValidator.cs")!;
    expect(validator).toContain('.WithMessage("Amount positive")');
    expect(validator).toContain(`.WithErrorCode("${AMOUNT_CODE}")`);
  });
});

describe("python/FastAPI — no catalog: the 422 answers the code, the client localizes", () => {
  it("ships no message catalog and no locale lookup", async () => {
    const files = await filesFor("python");
    expect(bySuffix(files, "app/i18n.py")).toBeUndefined();
    const problem = bySuffix(files, "app/http/problem.py")!;
    expect(problem).not.toContain("localize_message");
    expect(problem).toContain('"code": _wire_code(e),');
  });

  it("each named rule's pydantic error type is its identity key", async () => {
    const all = [...(await filesFor("python")).values()].join("\n");
    for (const code of ALL_CODES) expect(all).toContain(`"${code}"`);
  });
});

describe("java/Spring — no catalog: the 422 answers the code, the client localizes", () => {
  it("ships no message bundle and no MessageSource lookup", async () => {
    const files = await filesFor("java");
    expect(bySuffix(files, "src/main/resources/messages.properties")).toBeUndefined();
    const advice = bySuffix(files, "ApiExceptionAdvice.java")!;
    expect(advice).not.toContain("MessageSource");
  });

  it("each named rule's code is its identity key", async () => {
    const all = [...(await filesFor("java")).values()].join("\n");
    for (const code of ALL_CODES) expect(all).toContain(`"${code}"`);
  });
});

describe("elixir/Phoenix — no catalog: the 422 answers the code, the client localizes", () => {
  it("ships no gettext catalog and no locale switch on the 422", async () => {
    const files = await filesFor("elixir");
    expect(bySuffix(files, "priv/gettext/en/LC_MESSAGES/default.po")).toBeUndefined();
    const all = [...files.values()].join("\n");
    expect(all).not.toContain("Gettext.with_locale");
  });

  it("each named rule's code is its identity key", async () => {
    const all = [...(await filesFor("elixir")).values()].join("\n");
    for (const code of ALL_CODES) expect(all).toContain(`"${code}"`);
  });
});

describe("the system catalog", () => {
  it("carries every named rule's identity key — the codes every backend answers", async () => {
    const files = await filesFor("node");
    const systemCatalog = JSON.parse(files.get(".loom/messages.en.json")!) as Record<
      string,
      string
    >;
    for (const code of ALL_CODES) {
      expect(Object.keys(systemCatalog)).toContain(code);
    }
    expect(systemCatalog[NAME_CODE]).toBe("Name length");
  });
});

describe("a locales/en override", () => {
  it("replaces a named rule's English on the wire of every backend", async () => {
    const overrides = new Map([[NAME_CODE, "Name must be 2-120 characters"]]);
    for (const platform of ["node", "dotnet", "python", "java", "elixir"] as const) {
      const files = await generateSystemFiles(src(platform), { sourceOverrides: overrides });
      const all = [...files.values()].join("\n");
      expect(all, platform).toContain("Name must be 2-120 characters");
    }
  });
});
