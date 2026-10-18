// M-T1.36 F2 — a `scaffold` ui that declares its OWN page at `/` (under any
// name) still got the synthesised `Home` at `/` too: Vue's router and Angular's
// `app.routes.ts` carried two routes at the root (the second unreachable), and
// React wrote an unrouted `pages/home.tsx`.  The declared page wins, exactly as
// override-by-name (`page Home { … }`) already did.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

function source(framework: "react" | "vue" | "angular", uiExtra: string): string {
  return `
    system Shop {
      subdomain Sales { context Orders {
        aggregate Customer { name: string }
        repository Customers for Customer { }
      } }
      api SalesApi from Sales
      storage db { type: postgres }
      resource st { for: Orders, kind: state, use: db }
      ui WebApp with scaffold(subdomains: [Sales]) {
        framework: ${framework}
        api Sales: SalesApi
        ${uiExtra}
      }
      deployable api { platform: node, contexts: [Orders], dataSources: [st], serves: SalesApi, port: 8080 }
      deployable web { platform: ${framework}, targets: api, ui: WebApp { Sales: api }, port: 3000 }
    }`;
}

const WELCOME = `page Welcome { route: "/" body: Stack { Heading { "Mine", level: 1 } } }`;
const AREA_WELCOME = `area Front { page Welcome { route: "/" body: Stack { Heading { "Mine", level: 1 } } } }`;

describe("scaffold Home yields to a user page routed at `/` (F2)", () => {
  it("vue: one root route, the declared page", async () => {
    const router = (await generateSystemFiles(source("vue", WELCOME))).get("web/src/router.ts")!;
    expect(router.match(/path: "\/",/g)).toHaveLength(1);
    expect(router).toContain('{ path: "/", component: Welcome }');
  });

  it("angular: one root route, the declared page", async () => {
    const files = await generateSystemFiles(source("angular", WELCOME));
    const routes = files.get("web/src/app/app.routes.ts")!;
    expect(routes.match(/path: "",/g)).toHaveLength(1);
    expect(routes).toContain('{ path: "", component: WelcomeComponent }');
    expect(files.has("web/src/app/pages/home.component.ts")).toBe(false);
  });

  it("react: no unrouted home.tsx", async () => {
    const files = await generateSystemFiles(source("react", WELCOME));
    expect(files.has("web/src/pages/welcome.tsx")).toBe(true);
    expect(files.has("web/src/pages/home.tsx")).toBe(false);
  });

  it("a root page inside an area also owns `/`", async () => {
    const router = (await generateSystemFiles(source("vue", AREA_WELCOME))).get(
      "web/src/router.ts",
    )!;
    expect(router.match(/path: "\/",/g)).toHaveLength(1);
  });

  it("without a declared root page the scaffold Home is still synthesised", async () => {
    const files = await generateSystemFiles(source("react", ""));
    expect(files.has("web/src/pages/home.tsx")).toBe(true);
  });
});
