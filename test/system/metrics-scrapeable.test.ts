// F-022 — the generated Prometheus config must be able to scrape the
// generated app.
//
// Both halves come out of THIS tool, from ONE model: the scrape job in
// `monitoring/prometheus.yml` (no `bearer_token`, no `basic_auth`) and the
// backend's own auth middleware.  On an `auth: required` deployable the
// middleware used to answer `GET /metrics` with 401, so every scrape the
// generator had just configured failed — a monitoring stack that cannot
// monitor.
//
// The resolution taken: `/metrics` joins `/health` and `/ready` on the
// auth-bypass list of every backend, and the scrape config says why in its
// header.  The alternative (mint a shared bearer token into both halves) puts
// a long-lived secret in the repository and protects nothing once the port is
// published — see `docs/observability.md`.
//
// Non-vacuity is the second `it`: the bypass must NOT have swallowed the API
// surface or the session probe along with it.

import { NodeFileSystem } from "langium/node";
import { parseHelper } from "langium/test";
import { describe, expect, it } from "vitest";
import { createDddServices } from "../../src/language/ddd-module.js";
import type { Model } from "../../src/language/generated/ast.js";
import { generateSystems } from "../../src/system/index.js";

const services = createDddServices(NodeFileSystem);
const parse = parseHelper<Model>(services.Ddd);

/** One `auth: required` backend on `platform`, with a system `user {}` block
 *  (without one no backend emits an auth middleware at all). */
const system = (platform: string) => `
system Shop {
  user { id: guid  role: string }
  auth { oidc { issuer: "https://idp.example.com"  clientId: "app" } }
  subdomain Sales {
    context Orders {
      aggregate Order with crudish { total: int }
      repository Orders for Order { }
    }
  }
  api OrdersApi from Sales
  storage primary { type: postgres }
  resource st { for: Orders, kind: state, use: primary }
  deployable api { platform: ${platform} contexts: [Orders] serves: OrdersApi dataSources: [st] port: 8080 auth: required }
}`;

async function filesFor(platform: string): Promise<Map<string, string>> {
  const doc = await parse(system(platform), { validation: false });
  expect(doc.parseResult.parserErrors.map((e) => e.message)).toEqual([]);
  return generateSystems(doc.parseResult.value).files;
}

describe("F-022 — a generated Prometheus job can actually scrape the generated app", () => {
  // Each backend's bypass list, located by the FILE that declares it and
  // sliced to the declaration itself — not grepped for `/metrics` across the
  // project, which the routes file alone would satisfy.
  const BYPASS_SITES: Record<string, { file: string; from: string; to: string }> = {
    node: { file: "api/auth/middleware.ts", from: "BYPASS_PREFIXES", to: "] as const" },
    dotnet: { file: "api/Auth/UserMiddleware.cs", from: "BypassPrefixes", to: "};" },
    java: {
      file: "api/src/main/java/com/loom/api/auth/UserFilter.java",
      from: "BYPASS_PREFIXES",
      to: "};",
    },
    python: { file: "api/app/auth/middleware.py", from: "BYPASS", to: ")" },
  };

  for (const [platform, site] of Object.entries(BYPASS_SITES)) {
    it(`${platform}: /metrics is on the auth-bypass list beside /health`, async () => {
      const files = await filesFor(platform);
      const content = files.get(site.file);
      expect(content, `${platform} emits ${site.file}`).toBeDefined();
      const start = content!.indexOf(site.from);
      expect(start, `${site.file} declares ${site.from}`).toBeGreaterThanOrEqual(0);
      const list = content!.slice(start, content!.indexOf(site.to, start));
      // The list is the one that already bypasses the probes…
      expect(list, `${site.file}: sliced the bypass list`).toContain("/health");
      // …and it must let the scrape through.
      expect(list, `${site.file}: /metrics must bypass auth (F-022)`).toContain("/metrics");
    });
  }

  it("elixir serves /metrics outside the authenticated :api pipeline", async () => {
    const files = await filesFor("elixir");
    const router = [...files.entries()].find(([p]) => p.endsWith("router.ex"))![1];
    // The `/metrics` scope pipes through nothing, exactly like `/health`.
    const scope = router.slice(router.indexOf('scope "/metrics"'));
    expect(scope.slice(0, scope.indexOf("end"))).not.toContain("pipe_through");
  });

  it("the scrape config stays credential-free and says why", async () => {
    const files = await filesFor("node");
    const cfg = files.get("monitoring/prometheus.yml")!;
    expect(cfg).toContain("metrics_path: /metrics");
    expect(cfg).not.toContain("bearer_token");
    expect(cfg).not.toContain("basic_auth");
    expect(cfg).toContain("auth-bypass");
  });

  // --- non-vacuity: the bypass did not open the app ------------------------

  it("the API surface and the session probe stay gated", async () => {
    const files = await filesFor("node");
    const middleware = [...files.entries()].find(([p]) => p.endsWith("auth/middleware.ts"))![1];
    const list = middleware.slice(
      middleware.indexOf("BYPASS_PREFIXES"),
      middleware.indexOf("] as const"),
    );
    expect(list).toContain("/metrics");
    // The two that would make the bypass a hole rather than a scrape door.
    expect(list).not.toContain('"/api"');
    expect(list).not.toContain("/auth/me");
  });
});
