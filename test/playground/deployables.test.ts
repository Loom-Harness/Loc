import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeDeployables,
  frontendApiTarget,
  unsupportedPlatformOf,
} from "../../web/src/build/deployables.js";
import type { VirtualFile } from "../../web/src/build/protocol.js";
import { generateSystemFiles } from "../_helpers/generate.js";

// ---------------------------------------------------------------------------
// Which generated deployables the playground bundles + boots.
//
// The browser runtime boots every Hono backend, one worker each.  The Acme
// example with its two `.NET` deployables switched to `platform: node`
// generates three Hono backends; the playground boots all three, the one the
// React frontend targets first (the default request target).
// ---------------------------------------------------------------------------

const ACME = readFileSync(path.resolve(__dirname, "../../web/src/examples/acme.ddd"), "utf8");

/** The generated tree as the build worker hands it over: path-sorted. */
async function tree(source: string): Promise<VirtualFile[]> {
  const files = await generateSystemFiles(source);
  return [...files]
    .map(([p, content]) => ({ path: p, content, size: content.length }) as VirtualFile)
    .sort((a, b) => a.path.localeCompare(b.path));
}

describe("analyzeDeployables", () => {
  it("Acme switched to all-node boots every Hono backend, the targeted one first", async () => {
    const allNode = ACME.replaceAll("platform: dotnet", "platform: node");
    expect(allNode).not.toContain("platform: dotnet");
    const out = analyzeDeployables(await tree(allNode));
    expect(out.backends).toEqual([
      "api/http/index.ts",
      "catalog_api/http/index.ts",
      "catalog_web/http/index.ts",
    ]);
    expect(out.frontends).toEqual([
      { slug: "web_app", entry: "web_app/src/main.tsx", framework: "react", apiTarget: "api" },
    ]);
    expect(out.unsupported).toEqual([]);
  });

  it("prefers the Hono backend the React frontend targets over path order", async () => {
    // `catalogWeb` grows the Orders context so it can serve every page the
    // frontend reads, then becomes the frontend's target.
    const catalogWeb = [
      "        contexts: [Products]",
      "        dataSources: [productsState]",
      "        port: 3000",
    ].join("\n");
    expect(ACME).toContain(catalogWeb);
    const source = ACME.replaceAll("platform: dotnet", "platform: node")
      .replace(
        catalogWeb,
        [
          "        contexts: [Products, Orders]",
          "        dataSources: [productsState, ordersState]",
          "        serves: CatalogApi, SalesApi",
          "        port: 3000",
        ].join("\n"),
      )
      .replace("targets: api", "targets: catalogWeb");
    const out = analyzeDeployables(await tree(source));
    expect(out.backends).toEqual([
      "catalog_web/http/index.ts",
      "api/http/index.ts",
      "catalog_api/http/index.ts",
    ]);
    expect(out.unsupported).toEqual([]);
  });

  it("the shipped Acme boots its only Hono backend and lists the .NET ones", async () => {
    const out = analyzeDeployables(await tree(ACME));
    expect(out.backends).toEqual(["catalog_web/http/index.ts"]);
    expect(out.unsupported).toEqual([
      { slug: "api", platform: "dotnet" },
      { slug: "catalog_api", platform: "dotnet" },
    ]);
  });
});

describe("analyzeDeployables lists every frontend", () => {
  it("previews each React and Vue frontend against the backend its targets: names", async () => {
    const source = `system Shop {
  subdomain Core {
    context Sales {
      aggregate Item with crudish { title: string }
      repository Items for Item { }
    }
  }
  ui WebApp with scaffold(subdomains: [Core]) { }
  storage primary { type: postgres }
  resource st { for: Sales, kind: state, use: primary }
  deployable writer { platform: node, contexts: [Sales], dataSources: [st], port: 3000 }
  deployable reader { platform: node, contexts: [Sales], dataSources: [st], port: 3002 }
  deployable shopWeb { platform: vue, targets: reader, ui: WebApp, port: 3003 }
  deployable adminWeb { platform: react, targets: writer, ui: WebApp, port: 3001 }
}`;
    const out = analyzeDeployables(await tree(source));
    expect(out.frontends).toEqual([
      {
        slug: "admin_web",
        entry: "admin_web/src/main.tsx",
        framework: "react",
        apiTarget: "writer",
      },
      { slug: "shop_web", entry: "shop_web/src/main.ts", framework: "vue", apiTarget: "reader" },
    ]);
    // The first frontend's backend leads the boot order (the console's
    // default target).
    expect(out.backends).toEqual(["writer/http/index.ts", "reader/http/index.ts"]);
    expect(out.unsupported).toEqual([]);
  });
});

describe("frontendApiTarget", () => {
  const compose = [
    "services:",
    "  api:",
    "    build: ./api",
    "  web_app:",
    "    environment:",
    '      VITE_API_PROXY_TARGET: "http://catalog_web:3000"',
    "  other:",
    '      VITE_API_PROXY_TARGET: "http://api:3000"',
  ].join("\n");

  it("reads the proxy target inside the frontend's own service block", () => {
    expect(frontendApiTarget(compose, "web_app")).toBe("catalog_web");
  });

  it("does not read past the frontend's block into the next service", () => {
    expect(frontendApiTarget(compose, "api")).toBeNull();
  });
});

describe("analyzeDeployables names every toolchain the browser does not run", () => {
  it("lists Java, Python, Feliz and Flutter deployables as files-only", async () => {
    const source = `system Shop {
  subdomain Core {
    context Sales {
      aggregate Item with crudish { title: string }
      repository Items for Item { }
    }
  }
  ui WebApp with scaffold(subdomains: [Core]) { }
  storage primary { type: postgres }
  resource st { for: Sales, kind: state, use: primary }
  deployable jvApi { platform: java, contexts: [Sales], dataSources: [st], port: 3000 }
  deployable pyApi { platform: python, contexts: [Sales], dataSources: [st], port: 3002 }
  deployable fzWeb { platform: feliz, targets: jvApi, ui: WebApp, port: 3001 }
  deployable flWeb { platform: flutter, targets: pyApi, ui: WebApp, port: 3003 }
}`;
    const out = analyzeDeployables(await tree(source));
    expect(out.backends).toEqual([]);
    expect(out.frontends).toEqual([]);
    expect(out.unsupported).toEqual([
      { slug: "fl_web", platform: "flutter" },
      { slug: "fz_web", platform: "feliz" },
      { slug: "jv_api", platform: "java" },
      { slug: "py_api", platform: "python" },
    ]);
  });
});

describe("unsupportedPlatformOf", () => {
  it("finds a multi-word files-only deployable by its declared name (Targets drawer note)", async () => {
    const { unsupported } = analyzeDeployables(await tree(ACME));
    expect(unsupported.map((d) => d.slug)).toContain("catalog_api");
    expect(unsupportedPlatformOf(unsupported, "catalogApi")).toBe("dotnet");
    expect(unsupportedPlatformOf(unsupported, "api")).toBe("dotnet");
    expect(unsupportedPlatformOf(unsupported, "catalogWeb")).toBeNull();
  });
});
