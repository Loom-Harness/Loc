import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// The BACKEND message catalog, on the backends that still ship one.
//
// The server never translates a response (#4473): every refusal carries the
// catalog `code` a client localizes it by.  node/Hono, the reference, ships no
// catalog any more; the other four lose theirs with the #4473 fan-out, which
// deletes their rows here as it flips them in
// `test/_helpers/error-code-rows.ts`.
//
// A NAMED `invariant` / `check` / `precondition` puts its identity key
// `<Ctx>.<Owner>.rule.<name>` as the `code` on the 422 `errors[]`.  Each backend
// ships a CATALOG keyed by those same codes and resolves `errors[].message`
// through it for the request locale, so localisation does not require every
// client to carry a copy of every rule's text.
//
// Two invariants are asserted per backend:
//
//   1. the catalog exists, keyed by the rule's identity key — the SAME code
//      on the wire;
//   2. the backend's single 422 chokepoint RESOLVES through it (an emitted
//      catalog nothing reads is the dead-catalog class, gated on the UI side by
//      `user-visible-slot-coverage.test.ts`).
//
// Plus the byte-identical gate: a system with no named rule emits no catalog
// and no lookup anywhere.
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

/** A message-LESS twin of `DOMAIN` — the byte-identical baseline. */
const NO_MESSAGES = `
      aggregate Product {
        name: string
        qty: int
        invariant qty >= 0
        create(name: string, qty: int) { }
      }
      repository Products for Product { }
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

describe(".NET — Localization/LoomMessages.cs + exception-filter resolution", () => {
  it("emits the catalog keyed by the wire codes", async () => {
    const catalog = bySuffix(await filesFor("dotnet"), "Localization/LoomMessages.cs")!;
    expect(catalog).toBeDefined();
    for (const code of ALL_CODES) expect(catalog).toContain(`["${code}"]`);
    expect(catalog).toContain(`["${NAME_CODE}"] = "Name length"`);
    expect(catalog).toContain("RequestContext.Current?.Locale");
  });

  it("resolves errors[].message through the catalog in the 422 arm", async () => {
    const filter = bySuffix(await filesFor("dotnet"), "Api/DomainExceptionFilter.cs")!;
    expect(filter).toContain("LoomMessages.Localize(e.ErrorCode, e.ErrorMessage)");
  });

  it("routes a messaged PRECONDITION onto the carrier with its text + code", async () => {
    // The op validator dropped `message` when lifting preconditions, silently
    // downgrading an authored precondition to the generic text and
    // costing it the wire `code` every other backend keyed.
    const validator = bySuffix(await filesFor("dotnet"), "RestockCommandValidator.cs")!;
    expect(validator).toContain('.WithMessage("Amount positive")');
    expect(validator).toContain(`.WithErrorCode("${AMOUNT_CODE}")`);
  });
});

describe("python/FastAPI — app/i18n.py + validation-handler resolution", () => {
  it("emits the catalog keyed by the wire codes", async () => {
    const catalog = bySuffix(await filesFor("python"), "app/i18n.py")!;
    expect(catalog).toBeDefined();
    expect(catalog).toContain(`"${NAME_CODE}": "Name length"`);
    expect(catalog).toContain("from app.obs.log import locale");
  });

  it("resolves errors[].message through the catalog in the 422 handler", async () => {
    const problem = bySuffix(await filesFor("python"), "app/http/problem.py")!;
    expect(problem).toContain("from app.i18n import localize_message");
    expect(problem).toContain('entry["message"] = localize_message(code, entry["message"])');
  });
});

describe("cross-backend parity", () => {
  it("the catalog backends ship the SAME code set — one collector, N renderings", async () => {
    const codesIn = (content: string): string[] =>
      [...new Set(content.match(/Cat\.Product\.rule\.[A-Za-z0-9]+/g) ?? [])].sort();
    const [dotnet, python] = await Promise.all([filesFor("dotnet"), filesFor("python")]);
    expect(codesIn(bySuffix(dotnet, "Localization/LoomMessages.cs")!)).toEqual(ALL_CODES);
    expect(codesIn(bySuffix(python, "app/i18n.py")!)).toEqual(ALL_CODES);
  });

  it("the catalog keys equal the keys in the system's .loom/messages.en.json", async () => {
    // ONE system catalog for translators, N runtime catalogs derived from it.
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

  it("the catalog backends resolve the SAME locale-lookup contract off the ambient locale", async () => {
    // `RequestContext.locale` is the Accept-Language header VERBATIM (D-CTX-SHAPE),
    // so each rendering must normalise it the same way or a `fr-CA,fr;q=0.9`
    // request would resolve differently per backend.  The contract: take the first
    // listed language, drop its `;q=` weight, then fall back to the primary
    // subtag.
    const [dotnet, python] = await Promise.all([filesFor("dotnet"), filesFor("python")]);
    // .NET / python own the whole walk, including the primary-subtag step.
    const catalogs = [
      bySuffix(dotnet, "Localization/LoomMessages.cs")!,
      bySuffix(python, "app/i18n.py")!,
    ];
    for (const c of catalogs) {
      expect(c).toMatch(/[Ss]plit\((["'])[,,]\1\)/); // first listed language
      expect(c).toMatch(/[Ss]plit\((["'])[;;]\1\)/); // drop the ;q= weight
      expect(c.toLowerCase()).toContain("primary"); // the subtag fallback
    }
  });

  it("a system with no authored message emits no catalog and no lookup", async () => {
    for (const [platform, suffix] of [
      ["node", "http/messages.ts"],
      ["dotnet", "Localization/LoomMessages.cs"],
      ["python", "app/i18n.py"],
    ] as const) {
      const files = await filesFor(platform, NO_MESSAGES);
      expect(bySuffix(files, suffix), `${platform} emitted a catalog with no messages`).toBe(
        undefined,
      );
    }
    // …and the resolution sites keep their pre-catalog form.
    expect(bySuffix(await filesFor("python", NO_MESSAGES), "app/http/problem.py")).not.toContain(
      "localize_message",
    );
  });
});

describe("a locales/en override", () => {
  it("replaces a named rule's English in every backend catalog and on the wire", async () => {
    const overrides = new Map([[NAME_CODE, "Name must be 2-120 characters"]]);
    for (const [platform, suffix] of [
      // node has no catalog: the override is the English its refine answers.
      ["node", "http/product.routes.ts"],
      ["python", "app/i18n.py"],
    ] as const) {
      const files = await generateSystemFiles(src(platform), { sourceOverrides: overrides });
      expect(bySuffix(files, suffix), platform).toContain("Name must be 2-120 characters");
      expect(bySuffix(files, suffix), platform).not.toContain("Name length");
    }
  });
});
