// The Angular shell's default sidebar links only pages a link can reach: a
// scaffolded detail page's `/:id` route has no id to fill, and create pages are
// reached from their list.  String tier — an ABSENCE claim (no such link is
// emitted), which no compile tier observes.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SYS = `
system Shop {
  subdomain Sales {
    context Sales {
      aggregate Order with crudish { ref: string }
      repository Orders for Order { }
    }
  }
  storage primary { type: postgres }
  resource st { for: Sales, kind: state, use: primary }
  api SalesApi from Sales
  deployable api { platform: node contexts: [Sales] serves: SalesApi dataSources: [st] port: 8080 }
  ui WebApp with scaffold(subdomains: [Sales]) { }
  deployable web { platform: angular targets: api ui: WebApp port: 3004 }
}
`;

describe("angular default sidebar", () => {
  it("links list pages and home, never a detail route or a create page", async () => {
    const files = await generateSystemFiles(SYS);
    const shell = [...files].find(([k]) => k.endsWith("src/app/app.component.ts"))![1];
    const links = [...shell.matchAll(/<a [^>]*routerLink="([^"]*)"[^>]*data-testid="nav-/g)].map(
      (m) => m[1],
    );
    expect(links).toContain("/orders");
    expect(links.filter((l) => l.includes(":") || l.endsWith("/new"))).toEqual([]);
  });
});
