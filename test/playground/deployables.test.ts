import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeDeployables, frontendApiTarget } from "../../web/src/build/deployables.js";
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
    expect(out.react).toBe("web_app/src/main.tsx");
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
