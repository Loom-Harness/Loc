// The Svelte app's form runtime localizes by catalog code (#4473): a server
// field error and a refusal render through `t(code, english, params)`, and a
// client zod issue is localized when `form.errors` is READ (render time).  The
// emitted `src/lib/forms.svelte.ts` is RUN here (runes stubbed as plain
// values, `./i18n` and `./api/client` stubbed).

import { describe, expect, it } from "vitest";
import { WIRE_ERROR_MESSAGES } from "../../../src/generator/_i18n/wire-error-text.js";
import {
  FIELD_PROBLEM,
  FR,
  fileOf,
  frT,
  GLOBAL_PROBLEM,
  generateFor,
  loadTs,
} from "../_frontend/error-codes-fixture.js";

class ApiError extends Error {
  constructor(public body: unknown) {
    super("api");
  }
}

type Issue = {
  path: PropertyKey[];
  message: string;
  code?: string;
  params?: Record<string, unknown>;
};
type Form = {
  errors: Record<string, string>;
  submit: (ok: (v: unknown) => void) => Promise<void>;
  applyServerErrors: (e: unknown) => { kind: string; title?: string };
};

const load = (source: string, t: (k: string, d: string, v?: Record<string, unknown>) => string) =>
  loadTs(
    source,
    { "./api/client": { ApiError }, "./locale.svelte": { t } },
    { $state: <T>(x: T) => x },
  ) as {
    createForm: (schema: unknown, defaults: Record<string, unknown>) => Form;
  };

const schemaWith = (issues: Issue[]) => ({
  safeParse: () => ({ success: issues.length === 0, data: {}, error: { issues } }),
});

describe("Svelte — the form runtime localizes by catalog code", () => {
  it("renders a server field error and a global error through t, by code", async () => {
    const files = await generateFor("svelte");
    const source = fileOf(files, "web/src/lib/forms.svelte.ts");
    expect(source).toContain('import { t } from "./locale.svelte";');
    const { createForm } = load(source, frT);

    const form = createForm(schemaWith([]), {});
    expect(form.applyServerErrors(new ApiError(FIELD_PROBLEM))).toEqual({ kind: "fields" });
    expect(form.errors.qty).toBe("Quantité -1 refusée");
    expect(form.errors.sku).toBe(FR["field.rule"]);

    const refusal = createForm(schemaWith([]), {});
    expect(refusal.applyServerErrors(new ApiError(GLOBAL_PROBLEM))).toEqual({
      kind: "global",
      title: FR["problem.not-found"],
    });
  });

  it("localizes a client zod issue when errors is READ, so a locale switch re-renders", async () => {
    const files = await generateFor("svelte");
    const source = fileOf(files, "web/src/lib/forms.svelte.ts");
    let active: Record<string, string> = FR;
    const { createForm } = load(source, (k, d, v) =>
      (active[k] ?? d).replace(/\{(\w+)\}/g, (_, n: string) => String(v?.[n] ?? `{${n}}`)),
    );
    const form = createForm(
      schemaWith([
        {
          path: ["qty"],
          message: "Qty positive",
          code: "custom",
          params: { loomCode: "Sales.Order.rule.qtyPositive" },
        },
        {
          path: ["sku"],
          message: "Too small: expected string to have >=3 characters",
          code: "too_small",
        },
        {
          // A declared field limit: its code and its bound ride the issue.
          path: ["note"],
          message: "Note must be at most 5 characters",
          code: "custom",
          params: { loomCode: "field.max-length", loomValues: { max: 5 } },
        },
      ]),
      {},
    );
    await form.submit(() => {});
    expect(form.errors.qty).toBe("Quantité {qty} refusée");
    expect(form.errors.sku).toBe("Valeur invalide");
    expect(form.errors.note).toBe("Note must be at most 5 characters");
    active = { "field.rule": "Invalid value", "field.max-length": "Au plus {max} caractères" };
    expect(form.errors.sku).toBe("Invalid value");
    expect(form.errors.note).toBe("Au plus 5 caractères");
  });

  it("an app without a catalog shows the English the server sent", async () => {
    const files = await generateFor("svelte", false);
    expect([...files.keys()].some((p) => p.endsWith("web/src/lib/i18n.ts"))).toBe(false);
    const source = fileOf(files, "web/src/lib/forms.svelte.ts");
    expect(source).not.toContain("./locale.svelte");
    const { createForm } = load(source, () => {
      throw new Error("no catalog to read");
    });
    const form = createForm(schemaWith([]), {});
    expect(form.applyServerErrors(new ApiError(GLOBAL_PROBLEM))).toEqual({
      kind: "global",
      title: "Order 7 not found",
    });
  });

  it("the app catalog carries every problem.* / field.* code", async () => {
    const files = await generateFor("svelte");
    const catalog = JSON.parse(fileOf(files, "web/src/lib/locales/en.json")) as Record<
      string,
      string
    >;
    for (const [code, english] of Object.entries(WIRE_ERROR_MESSAGES)) {
      expect(catalog[code], code).toBe(english);
    }
  });
});
