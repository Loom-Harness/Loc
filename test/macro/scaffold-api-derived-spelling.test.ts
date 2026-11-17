// `api X with scaffoldApi(of: S)` declares the same contract as `api X from S`:
// on every backend the scaffolded routes bind the path parameter `id` and name
// the get-by-id read `getOrderById`, the derived surface's spelling.  The URLs
// are identical either way, so no booted wire golden can tell the two apart;
// the difference lives only in the declared spelling (route template
// placeholders and operationIds), which is what this test reads from source.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const BACKENDS = ["node", "dotnet", "python", "java", "elixir"] as const;

const SRC = (platform: string, api: string) => `
system Shop {
  subdomain Sales {
    context Ordering with scaffoldHandlers {
      aggregate Order {
        code: string
        status: string
        create(code: string, status: string) { }
        operation setNote(note: string) { status := note }
      }
      repository Orders for Order { }
    }
  }
  ${api}
  storage pg { type: postgres }
  resource st { for: Ordering, kind: state, use: pg }
  deployable api { platform: ${platform}, contexts: [Ordering], dataSources: [st], serves: SalesApi, port: 5001 }
}
`;

/** The path string of a route declaration, in each backend's spelling: an
 *  ASP.NET `[Http<Verb>("…")]`, a Spring `@<Verb>Mapping("…")`, a router
 *  `.<verb>("…")` call (Hono, FastAPI), a Phoenix `<verb> "…"` line, or an
 *  OpenAPI route's `path: "…"`. */
const ROUTE_TEMPLATE =
  /(?:Http(?:Get|Post|Put|Patch|Delete)\(|(?:Get|Post|Put|Patch|Delete)Mapping\(|\.(?:get|post|put|patch|delete)\(|^\s*(?:get|post|put|patch|delete) |path: )"([^"]*)"/gm;

/** Every path placeholder in a route template, and
 *  every declared operationId, across the generated tree. */
async function contract(platform: string, api: string) {
  const files = await generateSystemFiles(SRC(platform, api));
  const placeholders = new Set<string>();
  const operationIds = new Set<string>();
  for (const text of files.values()) {
    for (const route of text.matchAll(ROUTE_TEMPLATE)) {
      for (const p of route[1]!.matchAll(/\{(\w+)\}|:(\w+)/g)) placeholders.add(p[1] ?? p[2]!);
    }
    for (const m of text.matchAll(/operation(?:Id: |_id=)"(\w+)"/g)) operationIds.add(m[1]!);
  }
  return { placeholders, operationIds };
}

describe("scaffoldApi spells the derived surface's contract", () => {
  for (const platform of BACKENDS) {
    it(`${platform}: same path parameter and get-by-id operationId as \`from\``, async () => {
      const derived = await contract(platform, "api SalesApi from Sales");
      const macro = await contract(platform, "api SalesApi with scaffoldApi(of: Sales)");
      expect([...macro.placeholders]).toEqual(["id"]);
      expect([...macro.placeholders]).toEqual([...derived.placeholders]);
      if (derived.operationIds.has("getOrderById")) {
        expect(macro.operationIds).toContain("getOrderById");
      }
    }, 120_000);
  }
});
