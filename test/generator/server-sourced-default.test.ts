import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

// Server-sourced create defaults (`now()` / `currentUser.*`) are applied by the
// server: the field is wire-optional and every backend's create path coalesces
// it per request (server-sourced-create-default.test.ts).  No backend serves a
// separate defaults endpoint and no frontend fetches one, so a create form
// seeds the type-zero value on every target.
//
// String tier, ABSENCE: what this pins is that no `/prepare` route, hook or
// overlay is emitted — nothing a compile or booted tier can observe.

const SYS = (field: string, design: string, extra = "") => `
  system S {
    ${extra}
    subdomain Sales {
      context Sales {
        aggregate Order with crudish {
          customerId: string
          ${field}
        }
        repository Orders for Order { }
      }
    }
    api SalesApi from Sales
    storage db { type: postgres }
    resource st { for: Sales, kind: state, use: db }
    deployable api { platform: node contexts: [Sales] dataSources: [st] serves: SalesApi port: 3000${extra ? " auth: required" : ""} }
    deployable web { platform: web targets: api ui: WebApp { Sales: api } design: "${design}" port: 3001 }
    ui WebApp with scaffold(aggregates: [Order]) { api Sales: SalesApi }
  }
`;

const DEFAULTS: readonly [string, string][] = [
  ["createdAt: datetime = now()", ""],
  ["ownerId: string = currentUser.tenantId", "user { tenantId: string }"],
];

describe("server-sourced create defaults: no defaults endpoint, no fetch", () => {
  for (const design of ["shadcn@v4", "mantine@v9", "mui@v7", "chakra@v3"]) {
    for (const [field, extra] of DEFAULTS) {
      it(`${design}, \`${field}\``, async () => {
        const files = await generateSystemFiles(SYS(field, design, extra));
        const routes = findBySuffix(files, "order.routes.ts");
        const api = findBySuffix(files, "api/order.ts");
        const newPage = findBySuffix(files, "orders/new.tsx");
        expect(routes).not.toMatch(/\/prepare/);
        expect(routes).not.toMatch(/PrepareOrderResponse/);
        expect(api).not.toMatch(/usePrepareOrder|PrepareOrderResponse|\/prepare/);
        expect(newPage).not.toMatch(/__prep|usePrepare/);
      });
    }
  }
});

function findBySuffix(files: Map<string, string>, suffix: string): string {
  const hit = [...files.entries()].find(([k]) => k.endsWith(suffix));
  if (!hit) throw new Error(`no generated file ending in ${suffix}`);
  return hit[1];
}
