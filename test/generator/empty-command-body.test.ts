// RS-39 — an EMPTY request body reads as `{}`, and a parameterless command
// publishes an optional request body, on all five backends.
//
// `operation confirm()` → `POST /api/<aggs>/{id}/confirm` has nothing to send,
// and a caller with nothing to say sends no body.  Measured on booted
// backends against Postgres before the rule existed (the PR body has the full
// matrix):
//
//                   no body, no CT   CT json, 0 bytes   `{}`   text/plain `{}`
//   node                 415              400            204        415
//   python               422              422            204        422
//   dotnet               415              422            204        415
//   java                 204              204            204        204
//   elixir               204              204            204        204
//
// After: 204 / 204 / 204 / 415 on every backend, plus 400 for malformed JSON.
// The runtime half is pinned by the wire-golden probe
// (`__emptyCommandBodyProbes`, test/behavioral/wire-differential.mjs); these
// are the EMITTED-CODE assertions that keep each backend's seam in place.
import { describe, expect, it } from "vitest";
import { commandBodyOptional } from "../../src/ir/util/command-body.js";
import { UNSUPPORTED_MEDIA_TYPE_DETAIL } from "../../src/ir/util/openapi-errors.js";
import { generateSystemFiles } from "../_helpers/generate.js";

const src = (platform: string): string => `
system Rs43 {
  subdomain D {
    context Sales {
      enum OrderStatus { Open, Closed }
      aggregate Order {
        name: string
        status: OrderStatus = Open
        create(name: string) { }
        operation close() when status == Open {
          status := Closed
        }
        operation rename(newName: string) {
          name := newName
        }
      }
      workflow Housekeeping {
        create() {
          let o = Order.create({ name: "auto" })
        }
      }
      repository Orders for Order { }
    }
  }
  api A from D
  storage pg { type: postgres }
  resource salesState { for: Sales, kind: state, use: pg }
  deployable d { platform: ${platform}, contexts: [Sales], dataSources: [salesState], serves: A, port: 4000 }
}
`;

async function files(platform: string): Promise<Map<string, string>> {
  return generateSystemFiles(src(platform));
}

function fileEndingWith(m: Map<string, string>, suffix: string): string {
  const key = [...m.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return m.get(key!)!;
}

/** The source line that declares `needle`, so an assertion reads one route. */
function lineWith(text: string, needle: string): string {
  const line = text.split("\n").find((l) => l.includes(needle));
  expect(line, `no line contains ${needle}`).toBeDefined();
  return line!;
}

describe("RS-39 — an empty request body is `{}`; a parameterless command's body is optional", () => {
  it("the shared predicate: no inputs ⇒ optional body", () => {
    expect(commandBodyOptional([])).toBe(true);
    expect(commandBodyOptional([{ name: "newName" }])).toBe(false);
  });

  it("node: the normaliser is mounted app-wide; zero-arg routes publish `required: false`", async () => {
    const m = await files("node");
    const problem = fileEndingWith(m, "http/problem-details.ts");
    expect(problem).toContain("export const emptyBodyAsEmptyObject: MiddlewareHandler");
    // A 415 reads the same whichever layer raised it.
    expect(problem).toContain(`status === 415 ? ${JSON.stringify(UNSUPPORTED_MEDIA_TYPE_DETAIL)}`);
    expect(fileEndingWith(m, "http/index.ts")).toContain('app.use("*", emptyBodyAsEmptyObject);');

    const routes = fileEndingWith(m, "http/order.routes.ts");
    const bodies = routes.split("\n").filter((l) => l.includes("body: { content:"));
    const close = bodies.find((l) => l.includes("CloseOrderRequest"));
    const rename = bodies.find((l) => l.includes("RenameOrderRequest"));
    expect(close).toContain("required: false");
    expect(rename).not.toContain("required: false");
    expect(lineWith(fileEndingWith(m, "http/workflows.ts"), "HousekeepingRequest } }")).toContain(
      "required: false",
    );
  });

  it("python: JsonBodyMiddleware is installed; zero-arg routes take a defaulted body", async () => {
    const m = await files("python");
    const problem = fileEndingWith(m, "app/http/problem.py");
    expect(problem).toContain("class JsonBodyMiddleware:");
    expect(problem).toContain(
      `UNSUPPORTED_MEDIA_TYPE = ${JSON.stringify(UNSUPPORTED_MEDIA_TYPE_DETAIL)}`,
    );
    expect(fileEndingWith(m, "app/main.py")).toContain("app.add_middleware(JsonBodyMiddleware)");

    const routes = fileEndingWith(m, "app/http/order_routes.py");
    expect(lineWith(routes, "async def close_order(")).toContain(
      "body: Annotated[CloseOrderRequest, Body(default_factory=CloseOrderRequest)]",
    );
    expect(lineWith(routes, "async def rename_order(")).toContain("body: RenameOrderRequest");
    expect(routes).toMatch(/^from fastapi import APIRouter, Body, Depends/m);
    expect(fileEndingWith(m, "app/http/workflows_routes.py")).toContain(
      "body: Annotated[HousekeepingRequest, Body(default_factory=HousekeepingRequest)]",
    );
  });

  it("dotnet: EmptyJsonBodyMiddleware is emitted and mounted; a 415 carries the shared detail", async () => {
    const m = await files("dotnet");
    const mw = fileEndingWith(m, "Middleware/EmptyJsonBodyMiddleware.cs");
    // The binder decides "is there a body?" from this feature, not the stream.
    expect(mw).toContain("ctx.Features.Set<IHttpRequestBodyDetectionFeature>(HasBody.Instance);");
    const program = fileEndingWith(m, "Program.cs");
    expect(program).toMatch(/app\.UseMiddleware<[\w.]+\.Middleware\.EmptyJsonBodyMiddleware>\(\);/);
    expect(program).toContain(
      `if (status == 415) ctx.ProblemDetails.Detail = ${JSON.stringify(UNSUPPORTED_MEDIA_TYPE_DETAIL)};`,
    );
    // Mounted ahead of the controllers it normalises for.
    expect(program.indexOf("EmptyJsonBodyMiddleware")).toBeLessThan(
      program.indexOf("app.MapControllers();"),
    );
  });

  it("java: EmptyJsonBodyFilter is emitted; zero-arg routes READ an optional body", async () => {
    const m = await files("java");
    expect(fileEndingWith(m, "config/EmptyJsonBodyFilter.java")).toContain(
      "public class EmptyJsonBodyFilter extends OncePerRequestFilter",
    );
    const controller = fileEndingWith(m, "OrdersController.java");
    // Reading the body is what makes malformed JSON 400 and a foreign
    // Content-Type 415 — a route that never binds one accepts anything.
    expect(lineWith(controller, "public void closeOrder(")).toContain(
      "@RequestBody(required = false) java.util.Map<String, Object> body",
    );
    expect(lineWith(controller, "public void renameOrder(")).toContain(
      "@Valid @RequestBody RenameOrderRequest request",
    );
    const workflows = [...m.entries()].find(([k]) => k.endsWith("WorkflowsController.java"))![1];
    expect(lineWith(workflows, "public void housekeeping(")).toContain(
      "@RequestBody(required = false)",
    );
    // The hidden body leaves springdoc with no request body to publish; the
    // customizer attaches the named empty one the other four publish.
    const customizer = fileEndingWith(m, "OpenApiContractCustomizer.java");
    expect(customizer).toContain('new EmptyRequest("/api/orders/{id}/close", "CloseOrderRequest")');
    expect(customizer).toContain(
      'new EmptyRequest("/api/workflows/housekeeping", "HousekeepingRequest")',
    );
    expect(fileEndingWith(m, "ApiExceptionAdvice.java")).toContain(
      `case 415 -> ${JSON.stringify(UNSUPPORTED_MEDIA_TYPE_DETAIL)};`,
    );
  });

  it("elixir: BodyParser answers a foreign media type 415; zero-arg bodies publish `required: false`", async () => {
    const m = await files("elixir");
    const parser = fileEndingWith(m, "_web/body_parser.ex");
    expect(parser).toContain('request_path: "/api/" <> _} = conn, opts)');
    expect(parser).toContain(
      `send_problem(conn, 415, ${JSON.stringify(UNSUPPORTED_MEDIA_TYPE_DETAIL)})`,
    );
    // The spec module is named after the api (`api A` → `a_spec.ex`).
    const spec = fileEndingWith(m, "_web/api/a_spec.ex");
    const block = (operationId: string): string => {
      const at = spec.indexOf(`operationId: "${operationId}"`);
      expect(at, `${operationId} not in the spec module`).toBeGreaterThan(-1);
      return spec.slice(at, spec.indexOf("requestBody:", at) + 200);
    };
    expect(block("closeOrder")).toContain("required: false");
    expect(block("renameOrder")).toContain("required: true");
    expect(block("housekeepingWorkflow")).toContain("required: false");
  });
});
