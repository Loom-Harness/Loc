// The Angular app localizes by catalog code (#4473): `server-errors.ts` renders
// a server field error and a refusal through `t(code, english, params)`, and a
// constrained field's client message is a `t("<rule code>", english)`
// interpolation in the form template, so it re-evaluates when the form renders.
// The emitted `src/lib/server-errors.ts` is RUN here with `./i18n` stubbed.

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

type Outcome = { kind: string; title?: string };
type Mod = {
  applyServerErrors: (error: unknown, form: { get(p: string): unknown }) => Outcome;
};

const load = (source: string, t: typeof frT) => loadTs(source, { "./i18n": { t } }) as Mod;

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
    expect(source).toContain('import { t } from "./i18n";');
    const { applyServerErrors } = load(source, frT);

    const { set, form } = controls();
    expect(applyServerErrors({ body: FIELD_PROBLEM }, form)).toEqual({ kind: "fields" });
    expect(set.qty?.server).toBe("Quantité -1 refusée");
    expect(set.sku?.server).toBe(FR["field.rule"]);

    expect(applyServerErrors({ body: GLOBAL_PROBLEM }, controls().form)).toEqual({
      kind: "global",
      title: FR["problem.not-found"],
    });
  });

  it("a body without a code stays unhandled; a pointer-less entry is global", async () => {
    const files = await generateFor("angular");
    const { applyServerErrors } = load(fileOf(files, "web/src/lib/server-errors.ts"), frT);
    expect(applyServerErrors({ body: { detail: "boom" } }, controls().form)).toEqual({
      kind: "unhandled",
    });
    expect(
      applyServerErrors(
        { body: { errors: [{ message: "x", code: "problem.not-found" }] } },
        controls().form,
      ),
    ).toEqual({ kind: "global", title: FR["problem.not-found"] });
  });

  it("an app without a catalog shows the English the server sent", async () => {
    const files = await generateFor("angular", false);
    expect([...files.keys()].some((p) => p.endsWith("web/src/lib/i18n.ts"))).toBe(false);
    const source = fileOf(files, "web/src/lib/server-errors.ts");
    expect(source).not.toContain("./i18n");
    const { applyServerErrors } = load(source, () => {
      throw new Error("no catalog to read");
    });
    expect(applyServerErrors({ body: GLOBAL_PROBLEM }, controls().form)).toEqual({
      kind: "global",
      title: "Order 7 not found",
    });
  });

  it("a constrained field's client message is a render-time t() call keyed by its rule", async () => {
    const files = await generateFor("angular");
    const pages = [...files].filter(([p]) => p.startsWith("web/src/app/") && p.endsWith(".ts"));
    const text = pages.map(([, s]) => s).join("\n");
    // A named rule answers its identity key.
    expect(text).toContain('{{ t("Sales.Order.rule.qtyPositive", "Qty is invalid") }}');
    expect(text).toContain('{{ t("Sales.Order.rule.skuShape", "Sku is invalid") }}');
  });

  it("an unnamed field limit renders under the code of the validator that failed, with its bound", async () => {
    const files = await generateSystemFiles(
      errorCodeSystem("angular")
        .replace("invariant qtyPositive: qty > 0", "invariant qty > 0 && qty <= 9")
        .replace(
          'invariant skuShape: sku.length >= 3 message "Sku is too short"',
          "invariant sku.length >= 3",
        ),
    );
    const pages = [...files].filter(([p]) => p.startsWith("web/src/app/") && p.endsWith(".ts"));
    const text = pages.map(([, s]) => s).join("\n");
    expect(text).toContain(
      `@if (orderForm.controls.qty.errors?.['min']) { {{ t("field.min", "Qty is invalid", { min: 1 }) }} } @else { {{ t("field.max", "Qty is invalid", { max: 9 }) }} }`,
    );
    expect(text).toContain('{{ t("field.min-length", "Sku is invalid", { min: 3 }) }}');
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
