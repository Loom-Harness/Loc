// The Vue app's form runtime localizes by catalog code (#4473): a server field
// error and a refusal render through `t(code, english, params)`, and a client
// zod issue is localized when the form's `errors` are READ (render time), by
// the code its Loom check carries (`params.loomCode`) or the field reason its
// zod code names.  The emitted `src/lib/form.ts` is RUN here with `vue`,
// `vee-validate` and `../i18n` stubbed, so the assertions are on what the user
// sees, not on source text.

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

type Issue = {
  path: PropertyKey[];
  message: string;
  code?: string;
  params?: Record<string, unknown>;
};

/** A minimal vee-validate: holds the error map, runs the typed schema on submit. */
function fakeVee() {
  const errors: Record<string, string> = {};
  return {
    useForm: (opts: {
      validationSchema: {
        parse: (v: unknown) => Promise<{ errors: { path?: string; errors: string[] }[] }>;
      };
    }) => ({
      errors: { value: errors },
      isSubmitting: { value: false },
      setValues: () => {},
      setErrors: (e: Record<string, string>) => {
        for (const k of Object.keys(errors)) delete errors[k];
        Object.assign(errors, e);
      },
      setFieldError: (path: string, message: string) => {
        errors[path] = message;
      },
      handleSubmit: (fn: (v: unknown) => Promise<void>) => async () => {
        const r = await opts.validationSchema.parse({});
        if (r.errors.length > 0) {
          for (const e of r.errors) if (e.path) errors[e.path] = e.errors[0]!;
          return;
        }
        await fn({});
      },
    }),
  };
}

const load = (source: string, t: typeof frT) =>
  loadTs(source, {
    vue: { reactive: <T>(x: T) => x },
    "vee-validate": fakeVee(),
    "./locale": { t },
  }) as {
    useLoomForm: (
      schema: unknown,
      init: Record<string, unknown>,
    ) => {
      errors: Record<string, string | undefined>;
      handleSubmit: (h: (v: unknown) => Promise<void> | void) => (e?: unknown) => Promise<void>;
    };
  };

const schemaWith = (issues: Issue[]) => ({
  safeParseAsync: async () => ({ success: issues.length === 0, data: {}, error: { issues } }),
});

describe("Vue — the form runtime localizes by catalog code", () => {
  it("renders a server field error and a global error through t, by code", async () => {
    const files = await generateFor("vue");
    const source = fileOf(files, "web/src/lib/form.ts");
    expect(source).toContain('import { t } from "./locale";');
    const { useLoomForm } = load(source, frT);

    const fieldForm = useLoomForm(schemaWith([]), {});
    await fieldForm.handleSubmit(async () => {
      throw { body: FIELD_PROBLEM };
    })();
    expect(fieldForm.errors.qty).toBe("Quantité -1 refusée");
    expect(fieldForm.errors.sku).toBe(FR["field.rule"]);

    const globalForm = useLoomForm(schemaWith([]), {});
    await globalForm.handleSubmit(async () => {
      throw { body: GLOBAL_PROBLEM };
    })();
    expect(globalForm.errors.__global).toBe(FR["problem.not-found"]);
  });

  it("localizes a client zod issue when the errors are READ, so a locale switch re-renders", async () => {
    const files = await generateFor("vue");
    const source = fileOf(files, "web/src/lib/form.ts");
    let active: Record<string, string> = FR;
    const { useLoomForm } = load(source, (k, d, v) =>
      (active[k] ?? d).replace(/\{(\w+)\}/g, (_, n: string) => String(v?.[n] ?? `{${n}}`)),
    );
    const form = useLoomForm(
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
        { path: ["note"], message: "Expected string, received number", code: "invalid_type" },
      ]),
      {},
    );
    await form.handleSubmit(() => {})();
    expect(form.errors.qty).toBe("Quantité {qty} refusée");
    expect(form.errors.sku).toBe("Valeur invalide");
    // An unmapped zod code is a type mismatch; this catalog has no French for it.
    expect(form.errors.note).toBe("Expected string, received number");
    // The message is looked up on every read: switching the catalog changes it.
    active = { "field.rule": "Invalid value" };
    expect(form.errors.sku).toBe("Invalid value");
  });

  it("an app without a catalog shows the English the server sent", async () => {
    const files = await generateFor("vue", false);
    expect([...files.keys()].some((p) => p.endsWith("web/src/i18n.ts"))).toBe(false);
    const source = fileOf(files, "web/src/lib/form.ts");
    expect(source).not.toContain("./locale");
    const { useLoomForm } = load(source, () => {
      throw new Error("no catalog to read");
    });
    const form = useLoomForm(schemaWith([]), {});
    await form.handleSubmit(async () => {
      throw { body: GLOBAL_PROBLEM };
    })();
    expect(form.errors.__global).toBe("Order 7 not found");
  });

  it("the app catalog carries every problem.* / field.* code", async () => {
    const files = await generateFor("vue");
    const catalog = JSON.parse(fileOf(files, "web/src/locales/en.json")) as Record<string, string>;
    for (const [code, english] of Object.entries(WIRE_ERROR_MESSAGES)) {
      expect(catalog[code], code).toBe(english);
    }
  });
});
