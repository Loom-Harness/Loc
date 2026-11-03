// A one-aggregate system with a client-checkable rule (`qty > 0`, a named
// rule `skuShape`) whose ui is translatable (`scaffold` supplies the
// strings), served to a frontend of the given platform.  The five non-React
// frontends' error-code tests (#4473) generate this and run / inspect the
// emitted error runtime.

import ts from "typescript";
import { generateSystemFiles } from "../../_helpers/index.js";

export type ErrorCodePlatform = "vue" | "svelte" | "angular" | "feliz" | "flutter";

const DEPLOYABLE: Record<ErrorCodePlatform, string> = {
  vue: `deployable web { platform: vue targets: api ui: Web { Sales: api } port: 3100 design: "shadcnVue@v1" }`,
  svelte: `deployable web { platform: svelte targets: api ui: Web { Sales: api } port: 3100 }`,
  angular: `deployable web { platform: angular targets: api ui: Web { Sales: api } port: 3100 }`,
  feliz: `deployable web { platform: feliz targets: api ui: Web { Sales: api } port: 3100 }`,
  flutter: `deployable web { platform: flutter targets: api ui: Web { Sales: api } port: 3100 }`,
};

export const errorCodeSystem = (platform: ErrorCodePlatform, scaffold = true): string => `
  system Shop {
    subdomain Sales {
      context Sales {
        aggregate Order with crudish {
          sku: string
          qty: int
          invariant qtyPositive: qty > 0
          invariant skuShape: sku.length >= 3 message "Sku is too short"
        }
        repository Orders for Order { }
      }
    }
    api SalesApi from Sales
    ui Web ${scaffold ? "with scaffold(subdomains: [Sales]) " : ""}{
      api Sales: SalesApi
      page Home { route: "/" body: ${scaffold ? `Heading { "Storefront" }` : "CreateForm { of: Order }"} }
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
    ${DEPLOYABLE[platform]}
  }
`;

export const generateFor = (platform: ErrorCodePlatform, scaffold = true) =>
  generateSystemFiles(errorCodeSystem(platform, scaffold));

export const fileOf = (files: Map<string, string>, suffix: string): string => {
  const hit = [...files].find(([p]) => p.endsWith(suffix));
  if (!hit) throw new Error(`${suffix} not emitted`);
  return hit[1];
};

type T = (key: string, d: string, v?: Record<string, unknown>) => string;

/** Run an emitted TS module with `require` bound to `modules`. */
export function loadTs(
  source: string,
  modules: Record<string, unknown>,
  globals: Record<string, unknown> = {},
): Record<string, unknown> {
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  const require = (id: string) => {
    if (id in modules) return modules[id];
    throw new Error(`unexpected import ${id}`);
  };
  const names = Object.keys(globals);
  new Function("require", "exports", ...names, js)(
    require,
    exports,
    ...names.map((n) => globals[n]),
  );
  return exports;
}

/** A French catalog with ICU-ish `{x}` holes, the way the real `t` fills them. */
export const FR: Record<string, string> = {
  "field.rule": "Valeur invalide",
  "field.missing": "Obligatoire",
  "problem.not-found": "Introuvable",
  "Sales.Order.rule.qtyPositive": "Quantité {qty} refusée",
};
export const frT: T = (key, d, v) =>
  (FR[key] ?? d).replace(/\{(\w+)\}/g, (_, k: string) => String(v?.[k] ?? `{${k}}`));

/** The ProblemDetails a 422 carries: one coded field error, one coded global. */
export const FIELD_PROBLEM = {
  code: "problem.field-invalid",
  detail: "One or more fields are invalid.",
  errors: [
    {
      pointer: "/qty",
      message: "Qty positive",
      code: "Sales.Order.rule.qtyPositive",
      params: { qty: -1 },
    },
    { pointer: "/sku", message: "Sku must be at least 1", code: "field.rule" },
  ],
};
export const GLOBAL_PROBLEM = { code: "problem.not-found", detail: "Order 7 not found" };
