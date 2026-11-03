// The React app's one server-error localizer (#4473): the server never
// translates a response, so `applyServerErrors` renders each refusal through
// `t` BY ITS CODE — `t(e.code, e.message, e.params)` per field,
// `t(pd.code ?? "problem.internal", pd.detail, pd.params)` for the refusal —
// and every `problem.*` / `field.*` code is in the app catalog.  A client-side
// zod issue is localized when the form RENDERS (`fieldErrorText`), by the
// catalog code its Loom check carries through `zod-resolver.ts`.
//
// The emitted module is RUN here (transpiled, its `../i18n` import bound to a
// French catalog), so the assertion is on what the user sees, not on source.

import ts from "typescript";
import { describe, expect, it } from "vitest";
import { WIRE_ERROR_MESSAGES } from "../../../src/generator/_i18n/wire-error-text.js";
import { generateSystemFiles } from "../../_helpers/index.js";

const SYSTEM = (pageBody: string) => `
  system Shop {
    subdomain Sales {
      context Sales {
        aggregate Order with crudish {
          status: string
          qty: int
          invariant qtyPositive: qty > 0
        }
        repository Orders for Order { }
      }
    }
    api SalesApi from Sales
    ui Web with scaffold(subdomains: [Sales]) {
      api Sales: SalesApi
      page Home { route: "/" body: ${pageBody} }
    }
    storage primary { type: postgres }
    resource salesState { for: Sales, kind: state, use: primary }
    deployable api {
      platform: node
      contexts: [Sales]
      dataSources: [salesState]
      serves: SalesApi
      port: 3000
    }
    deployable web { platform: react targets: api ui: Web { Sales: api } port: 3100 }
  }
`;

const fileOf = (files: Map<string, string>, suffix: string): string => {
  const hit = [...files].find(([p]) => p.endsWith(suffix));
  if (!hit) throw new Error(`${suffix} not emitted`);
  return hit[1];
};

/** Run an emitted TS module with `../i18n` bound to `t`. */
function load(source: string, t: (key: string, d: string, v?: Record<string, unknown>) => string) {
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  const require = (id: string) => {
    if (id === "../i18n") return { t };
    throw new Error(`unexpected import ${id}`);
  };
  new Function("require", "exports", js)(require, exports);
  return exports;
}

/** A French catalog with ICU-ish `{x}` holes, the way the real `t` fills them. */
const FR: Record<string, string> = {
  "field.rule": "Valeur invalide",
  "problem.not-found": "Introuvable",
  "Sales.Order.rule.qtyPositive": "Quantité {qty} refusée",
};
const frT = (key: string, d: string, v?: Record<string, unknown>) =>
  (FR[key] ?? d).replace(/\{(\w+)\}/g, (_, k: string) => String(v?.[k] ?? `{${k}}`));

describe("React — server errors are localized by code", () => {
  it("renders a server field error through t by its code, with its params", async () => {
    const files = await generateSystemFiles(SYSTEM(`Heading { "Storefront" }`));
    const source = fileOf(files, "web/src/lib/apply-server-errors.ts");
    expect(source).toContain('import { t } from "../i18n";');
    const { applyServerErrors } = load(source, frT) as {
      applyServerErrors: (a: unknown) => { kind: string; title?: string };
    };

    const set: Record<string, { type: string; message: string }> = {};
    const outcome = applyServerErrors({
      error: {
        status: 422,
        body: {
          code: "problem.field-invalid",
          detail: "One or more fields are invalid.",
          errors: [
            {
              pointer: "/qty",
              message: "Qty positive",
              code: "Sales.Order.rule.qtyPositive",
              params: { qty: -1 },
            },
            { pointer: "/status", message: "Status must be at least 1", code: "field.rule" },
          ],
        },
      },
      setError: (name: string, e: { type: string; message: string }) => {
        set[name] = e;
      },
      fieldMap: {},
    });
    expect(outcome.kind).toBe("applied");
    expect(set.qty?.message).toBe("Quantité -1 refusée");
    expect(set.status?.message).toBe("Valeur invalide");
  });

  it("renders a refusal with no errors[] by its top-level code", async () => {
    const files = await generateSystemFiles(SYSTEM(`Heading { "Storefront" }`));
    const { applyServerErrors } = load(
      fileOf(files, "web/src/lib/apply-server-errors.ts"),
      frT,
    ) as { applyServerErrors: (a: unknown) => { kind: string; title?: string } };
    const outcome = applyServerErrors({
      error: { status: 422, body: { code: "problem.not-found", detail: "Order 7 not found" } },
      setError: () => {},
      fieldMap: {},
    });
    expect(outcome).toEqual({ kind: "global", title: "Introuvable" });
  });

  it("an app without a catalog shows the English the server sent", async () => {
    // No scaffold and no authored string: nothing turns i18n on.
    const plain = SYSTEM(`Stack { }`).replace(" with scaffold(subdomains: [Sales])", "");
    const files = await generateSystemFiles(plain);
    expect([...files.keys()].some((p) => p.endsWith("src/i18n.ts"))).toBe(false);
    const source = fileOf(files, "web/src/lib/apply-server-errors.ts");
    expect(source).not.toContain("../i18n");
    const { applyServerErrors } = load(source, () => {
      throw new Error("no catalog to read");
    }) as { applyServerErrors: (a: unknown) => { kind: string; title?: string } };
    expect(
      applyServerErrors({
        error: { status: 422, body: { code: "problem.not-found", detail: "Order 7 not found" } },
        setError: () => {},
        fieldMap: {},
      }),
    ).toEqual({ kind: "global", title: "Order 7 not found" });
  });

  it("the app catalog carries every problem.* / field.* code", async () => {
    const files = await generateSystemFiles(SYSTEM(`Heading { "Storefront" }`));
    const catalog = JSON.parse(fileOf(files, "web/src/locales/en.json")) as Record<string, string>;
    for (const [code, english] of Object.entries(WIRE_ERROR_MESSAGES)) {
      expect(catalog[code], code).toBe(english);
    }
  });

  it("a form's field error localizes at render time, by the code zod-resolver keeps", async () => {
    const files = await generateSystemFiles(SYSTEM(`Heading { "Storefront" }`));
    const fieldError = fileOf(files, "web/src/lib/field-error.ts");
    const { fieldErrorText } = load(fieldError, frT) as {
      fieldErrorText: (e: unknown) => string | undefined;
    };
    // A named rule's issue: the resolver put its catalog code on the error.
    expect(
      fieldErrorText({
        type: "custom",
        message: "Qty positive",
        loomCode: "Sales.Order.rule.qtyPositive",
      }),
    ).toBe("Quantité {qty} refusée");
    // A native-chain bound carries no Loom code: it is an unnamed rule.
    expect(fieldErrorText({ type: "too_small", message: "Qty must be at least 1" })).toBe(
      "Valeur invalide",
    );
    // A server error was localized when applied; it renders as-is.
    expect(fieldErrorText({ type: "server", message: "déjà traduit" })).toBe("déjà traduit");
    expect(fieldErrorText(undefined)).toBeUndefined();
    // The forms take the resolver that keeps the code.
    const forms = [...files].filter(([p]) => p.startsWith("web/src/pages/") && p.endsWith(".tsx"));
    const withResolver = forms.filter(([, s]) => s.includes("zodResolver("));
    expect(withResolver.length).toBeGreaterThan(0);
    for (const [path, s] of withResolver) {
      expect(s, path).toMatch(/import \{ zodResolver \} from "(\.\.\/)+lib\/zod-resolver";/);
    }
    expect(fileOf(files, "web/src/lib/zod-resolver.ts")).toContain("loomCode");
  });
});
