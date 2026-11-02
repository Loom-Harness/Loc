// A routed read (`scaffoldGet` + `scaffoldGetApi`, or a hand-written
// `route GET … -> Ctx.Handler`) publishes the same OpenAPI contract on every
// backend: operationId = the bare lower-first handler name, the single-entity
// return's `<Agg>Response` at 200, and the shared RFC 7807 set — 400, the
// not-found status, 422 for the `?code=` it parses.  The 5-way parity gate
// (`test/e2e/e2e.test.ts`) only sees this on a booted stack; these pin each
// backend's emitted declaration.
// (.NET's half lives beside its routes controller, in
// `dotnet/explicit-handlers.test.ts`.)
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const src = (platform: string) => `
system S {
  subdomain Sales {
    context Orders with scaffoldGet(of: ByCode) {
      aggregate Order with crudish { code: string  total: int }
      repository Orders for Order
      criterion ByCode(code: string) of Order = this.code == code
    }
  }
  api A with scaffoldGetApi(of: ByCode) from Sales
  storage pg { type: postgres }
  resource s { for: Orders, kind: state, use: pg }
  deployable d { platform: ${platform}, contexts: [Orders], dataSources: [s], serves: A, port: 5001 }
}
`;

async function fileEndingWith(platform: string, suffix: string): Promise<string> {
  const files = await generateSystemFiles(src(platform));
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return files.get(key!)!;
}

describe("routed read — the OpenAPI contract every backend declares", () => {
  it("node: operationId is the bare handler name", async () => {
    const routes = await fileEndingWith("node", "http/a-routes.ts");
    expect(routes).toContain('operationId: "getOrderByCode",');
    expect(routes).toContain("schema: OrderResponse");
  });

  it("python: the decorator declares the 200 model and 400 / 404", async () => {
    const routes = await fileEndingWith("python", "app/http/a_routes.py");
    expect(routes).toContain('operation_id="getOrderByCode"');
    expect(routes).toContain('200: {"model": OrderResponse, "description": "OK"}');
    expect(routes).toContain('400: {"model": ProblemDetails');
    expect(routes).toContain('404: {"model": ProblemDetails');
    expect(routes).toContain("from app.http.order_routes import OrderResponse");
  });

  it("java: the contract customizer pins the 200 body and the error set", async () => {
    const customizer = await fileEndingWith("java", "OpenApiContractCustomizer.java");
    expect(customizer).toContain(
      'new Route("get", "/api/orders/by_code", "OrderResponse", new int[] {400, 404, 422}, null, 0)',
    );
  });

  it("elixir: the spec module publishes the routed path", async () => {
    const files = await generateSystemFiles(src("elixir"));
    const key = [...files.keys()].find((k) => /\/api\/a_spec\.ex$/.test(k));
    expect(key, "spec module not emitted").toBeDefined();
    const spec = files.get(key!)!;
    const at = spec.indexOf('"/api/orders/by_code" => %OpenApiSpex.PathItem{');
    expect(at).toBeGreaterThanOrEqual(0);
    const item = spec.slice(at, spec.indexOf("\n      }", at));
    expect(item).toContain('operationId: "getOrderByCode"');
    expect(item).toContain("name: :code, in: :query, required: true");
    expect(item).toMatch(/schema: \w+Web\.Api\.Schemas\.OrderResponse\}/);
    expect(item).toMatch(/400 => %OpenApiSpex\.Response/);
    expect(item).toMatch(/404 => %OpenApiSpex\.Response/);
  });
});
