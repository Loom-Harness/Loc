// The Angular app localizes by catalog code (#4473): `server-errors.ts` renders
// a server field error and a refusal through `t(code, english, params)`, and a
// constrained field's client message is a `t("<rule code>", english)`
// interpolation in the form template, so it re-evaluates when the form renders.
// The emitted `src/lib/server-errors.ts` is RUN here with `./locale` stubbed.

import { describe, expect, it } from "vitest";
import { WIRE_ERROR_MESSAGES } from "../../../src/generator/_i18n/wire-error-text.js";
import { generateSystemFiles } from "../../_helpers/index.js";
import {
  errorCodeSystem,
  FIELD_PROBLEM,
  FR,
  fileOf,
  frT,
  GLOBAL_PROBLEM,
  generateFor,
  loadTs,
} from "../_frontend/error-codes-fixture.js";

type Mod = {
  placeServerErrors: (error: unknown, form: { get(p: string): unknown }) => string | null;
};

const load = (source: string, t: typeof frT) => loadTs(source, { "./locale": { t } }) as Mod;

/** A control double recording what the mapper puts on it. */
const controls = () => {
  const set: Record<string, { server?: string }> = {};
  const form = {
    get: (path: string) => ({
      setErrors: (e: { server?: string }) => {
        set[path] = e;
      },
      markAsTouched: () => {},
    }),
  };
  return { set, form };
};

describe("Angular — server errors and client rules localize by catalog code", () => {
  it("renders a server field error and a global error through t, by code", async () => {
    const files = await generateFor("angular");
    const source = fileOf(files, "web/src/lib/server-errors.ts");
    expect(source).toContain('import { t } from "./locale";');
    const { placeServerErrors } = load(source, frT);

    const { set, form } = controls();
    expect(placeServerErrors({ status: 422, body: FIELD_PROBLEM }, form)).toBeNull();
    expect(set.qty?.server).toBe("Quantité -1 refusée");
    expect(set.sku?.server).toBe(FR["field.rule"]);

    expect(placeServerErrors({ status: 404, body: GLOBAL_PROBLEM }, controls().form)).toBe(
      FR["problem.not-found"],
    );
  });

  it("reads the problem off an HttpClient error, where the services' failures land", async () => {
    // The generated services call through `HttpClient`; a 422 rejects with an
    // `HttpErrorResponse`, whose parsed payload is `.error`, not `.body`.
    const files = await generateFor("angular");
    const { placeServerErrors } = load(fileOf(files, "web/src/lib/server-errors.ts"), frT);
    const { set, form } = controls();
    const httpError = { name: "HttpErrorResponse", status: 422, error: FIELD_PROBLEM };
    expect(placeServerErrors(httpError, form)).toBeNull();
    expect(set.qty?.server).toBe("Quantité -1 refusée");
  });

  it("a refusal without a code is the code of its status; a pointer-less entry is the form's message", async () => {
    const files = await generateFor("angular");
    const { placeServerErrors } = load(fileOf(files, "web/src/lib/server-errors.ts"), frT);
    // No catalog entry for the status's code in this locale: the server's English.
    expect(placeServerErrors({ status: 409, body: { detail: "boom" } }, controls().form)).toBe(
      "boom",
    );
    expect(
      placeServerErrors(
        { status: 422, body: { errors: [{ message: "x", code: "problem.not-found" }] } },
        controls().form,
      ),
    ).toBe(FR["problem.not-found"]);
  });

  it("a call that got no answer is the unreachable sentence", async () => {
    const files = await generateFor("angular");
    const { placeServerErrors } = load(fileOf(files, "web/src/lib/server-errors.ts"), frT);
    expect(placeServerErrors(new TypeError("Failed to fetch"), controls().form)).toBe(
      "Could not reach the server. Try again.",
    );
    expect(placeServerErrors({ status: 0, error: null }, controls().form)).toBe(
      "Could not reach the server. Try again.",
    );
  });

  it("an app without a catalog shows the English the server sent", async () => {
    const files = await generateFor("angular", false);
    expect([...files.keys()].some((p) => p.endsWith("web/src/lib/i18n.ts"))).toBe(false);
    const source = fileOf(files, "web/src/lib/server-errors.ts");
    expect(source).not.toContain("./locale");
    const { placeServerErrors } = load(source, () => {
      throw new Error("no catalog to read");
    });
    expect(placeServerErrors({ status: 404, body: GLOBAL_PROBLEM }, controls().form)).toBe(
      "Order 7 not found",
    );
  });

  it("a constrained field's client message is a render-time t() call keyed by its rule", async () => {
    const files = await generateFor("angular");
    const pages = [...files].filter(([p]) => p.startsWith("web/src/app/") && p.endsWith(".ts"));
    const text = pages.map(([, s]) => s).join("\n");
    // A named rule answers its identity key.
    expect(text).toContain('{{ t("Sales.Order.rule.qtyPositive", "Qty positive") }}');
    expect(text).toContain('{{ t("Sales.Order.rule.skuShape", "Sku shape") }}');
  });

  it("an unnamed field limit renders under the code of the validator that failed, with its bound", async () => {
    const files = await generateSystemFiles(
      errorCodeSystem("angular")
        .replace("invariant qtyPositive: qty > 0", "invariant qty > 0 && qty <= 9")
        .replace("invariant skuShape: sku.length >= 3", "invariant sku.length >= 3"),
    );
    const pages = [...files].filter(([p]) => p.startsWith("web/src/app/") && p.endsWith(".ts"));
    const text = pages.map(([, s]) => s).join("\n");
    expect(text).toContain(
      `@else if (orderForm.controls.qty.errors?.['min']) { {{ t("field.min", "Must be at least {min}", { min: 1 }) }} } @else { {{ t("field.max", "Must be at most {max}", { max: 9 }) }} }`,
    );
    expect(text).toContain(
      '{{ t("field.min-length", "{min, plural, one {Must be at least # character} other {Must be at least # characters}}", { min: 3 }) }}',
    );
  });

  it("the app catalog carries every problem.* / field.* code", async () => {
    const files = await generateFor("angular");
    const catalog = JSON.parse(fileOf(files, "web/src/lib/locales/en.json")) as Record<
      string,
      string
    >;
    for (const [code, english] of Object.entries(WIRE_ERROR_MESSAGES)) {
      expect(catalog[code], code).toBe(english);
    }
  });
});
