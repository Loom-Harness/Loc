// A wrong verb on a STATIC sub-path answers 405 with an `Allow` header — not
// the 422 the sibling `{id}` route's identifier validator would give it.
//
// Every router here resolves (method, path). `DELETE /api/customers/by_email`
// finds no DELETE on the static path, matches `DELETE /api/customers/{id}`
// with `id = "by_email"`, and the `{id}` validator then answers `422 Invalid
// UUID` for a path that has no DELETE at all. RFC 9110 §15.5.6 makes 405 the
// answer, and it is the only one that can carry an `Allow` the caller can act
// on. Reported as schemathesis F8 (node, fixed) and F18 (python / java /
// .NET, fixed here).
//
// Registration ORDER already fixes the same-verb case — a static path mounts
// before `/{id}` on every backend.
// Only the WRONG-verb case needs a guard, and the guard has to run BEFORE
// routing on all four: the 422 comes from the matched route's own parameter
// binding, so anything inside the handler is already too late.
//
// ── Measured on booted stacks (this fixture, postgres, `crudish` + a named
//    find), `DELETE /api/customers/by_email` ─────────────────────────────────
//
//              before   after   Allow
//   node        405      405    GET     ← F8, already fixed
//   python      422      405    GET
//   .NET        422      405    GET
//   java        422      405    GET
//
// with the guard removed on each, the before column reproduces exactly. The
// java arm additionally fixes F26 — `Allow` was missing from EVERY 405 that
// backend answered, `/health` and `/ready` included, because the advice
// re-wrapped the body and dropped `ErrorResponse.getHeaders()`:
//
//   PATCH /health         405 allow=[]  →  405 allow=[GET]
//   PATCH /api/customers  405 allow=[]  →  405 allow=[POST, GET]
//
// ── The narrowness that matters ────────────────────────────────────────────
// A malformed path IDENTIFIER (`DELETE /api/customers/not-a-uuid`) must STILL
// answer 422 — that is the declared contract `malformed-path-id-status.test.ts`
// pins across all four. Constraining the route to `{id:guid}` would have fixed
// the collision and broken that, which is why the fix is a guard on the known
// static paths rather than a tighter route template. Verified on every booted
// backend: 422 before and after.
//
// Only ONE-segment statics are guarded. `/{id}/history` and `/{id}/can_<op>`
// have a param in front, so nothing shadows them.
//
// ── Explicit routes are guarded too ────────────────────────────────────────
// The static path is usually served by an EXPLICIT route — `scaffoldGetApi`
// or a routed `queryHandler` mounts `GET /customers/by_email` — not by a
// derived operation.  The table is the derived operations' static sub-paths
// PLUS the explicit routes on one (`explicitStaticSubpaths`), so the fixture
// below has no derived static path at all and every backend must still guard.

import { describe, expect, it } from "vitest";
import {
  contextStaticSubpathRoutes,
  deriveContextOperations,
  explicitStaticSubpaths,
  staticSubpathMethods,
  staticSubpathRoutes,
} from "../../src/ir/util/api-surface.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { buildLoomModel, enrichedContexts } from "../_helpers/ir.js";

const CTX = `
  context Shop with scaffoldGet(of: ByEmail) {
    aggregate Customer with crudish {
      email: string
      name: string
    }
    repository Customers for Customer
    criterion ByEmail(email: string) of Customer = this.email == email
  }
`;

const src = (platform: string): string => `
system Shop {
  subdomain D {
    ${CTX}
  }
  api A with scaffoldGetApi(of: ByEmail) from D
  storage pg { type: postgres }
  resource shopState { for: Shop, kind: state, use: pg }
  deployable d { platform: ${platform}, contexts: [Shop], dataSources: [shopState], serves: A, port: 4000 }
}
`;

function fileEndingWith(m: Map<string, string>, suffix: string): string {
  const key = [...m.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return m.get(key as string) as string;
}

/** The single lowered context this fixture declares. */
async function shopContext() {
  const model = await buildLoomModel(CTX);
  const ctx = model.contexts.find((c) => c.name === "Shop");
  expect(ctx, "context Shop did not lower").toBeDefined();
  return ctx as NonNullable<typeof ctx>;
}

describe("the shared derivation", () => {
  it("excludes the collection root and every parameterised path", async () => {
    const table = staticSubpathRoutes(deriveContextOperations(await shopContext()));

    // `/api/customers` is a genuine method-mismatch the framework already
    // answers 405 for; claiming it here would replace working behaviour.
    expect(table).not.toHaveProperty("/api/customers");
    // Nothing with a param may enter — `{id}` is what the guard protects
    // AGAINST, and `/{id}/update` has a param in front so nothing shadows it.
    for (const path of Object.keys(table)) expect(path).not.toContain("{");
  });

  it("an explicit route on a static sub-path joins the table", async () => {
    const model = await buildLoomModel(src("node"));
    const ctx = enrichedContexts(model).find((c) => c.name === "Shop");
    expect(ctx, "context Shop did not lower").toBeDefined();
    const shop = ctx as NonNullable<typeof ctx>;
    // Vacuity: the derived operations alone mount no static sub-path here —
    // the explicit route is the guard's only producer.
    expect(staticSubpathRoutes(deriveContextOperations(shop))).toEqual({});
    expect(explicitStaticSubpaths(shop)).toEqual([
      {
        aggregate: "Customer",
        segment: "by_email",
        method: "GET",
        path: "/api/customers/by_email",
      },
    ]);
    expect(contextStaticSubpathRoutes([shop])).toEqual({ "/api/customers/by_email": ["GET"] });
  });

  it("`extra` carries a static path that is not a lifted operation", async () => {
    // Hono's `GET /prepare` is deliberately outside `deriveAggregateOperations`
    // (see the note at the top of api-surface.ts). Without this seam it would
    // drop silently out of the guard while still being mounted.
    const ops = deriveContextOperations(await shopContext());
    expect(staticSubpathMethods(ops, [["prepare", "GET"]])).toEqual({ prepare: ["GET"] });
  });
});

describe("each backend mounts the guard ahead of routing", () => {
  it("node — a middleware inside the aggregate router", async () => {
    const files = await generateSystemFiles(src("node"));
    const routes = fileEndingWith(files, "http/customer.routes.ts");
    expect(routes).toContain(
      'const staticSubpathMethods: Record<string, string[]> = { by_email: ["GET"] }',
    );
    expect(routes).toContain('app.use("/:__seg"');
    // Before the `/{id}` route it protects — `app.use` runs in registration
    // order, so a guard emitted after the route never sees the request.
    const guard = routes.indexOf('app.use("/:__seg"');
    const byId = routes.indexOf('path: "/{id}"');
    expect(guard, "the guard is not emitted").toBeGreaterThan(-1);
    expect(byId, "the /{id} route is not emitted").toBeGreaterThan(-1);
    expect(guard).toBeLessThan(byId);
  });

  it("python — ASGI middleware, added first so it is innermost", async () => {
    const files = await generateSystemFiles(src("python"));
    const main = fileEndingWith(files, "app/main.py");
    expect(main).toContain('"/api/customers/by_email": ["GET"],');
    expect(main).toContain("async def _static_subpath_method_guard(");
    expect(main).toContain('headers={"Allow": ", ".join(methods)},');
    // Starlette runs LATER-added middleware outermost, so the guard must be
    // registered before the others to end up closest to the router — after
    // auth and observability have seen the request, as hono's does.
    const guard = main.indexOf("_static_subpath_method_guard");
    const transaction = main.indexOf("app.add_middleware(TransactionMiddleware)");
    expect(guard).toBeGreaterThan(-1);
    expect(transaction).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(transaction);
  });

  it("dotnet — app.Use before MapControllers, body left to UseStatusCodePages", async () => {
    const files = await generateSystemFiles(src("dotnet"));
    const program = fileEndingWith(files, "Program.cs");
    expect(program).toContain('["/api/customers/by_email"] = new[] { "GET" },');
    expect(program).toContain("http.Response.StatusCode = 405;");
    expect(program).toContain('http.Response.Headers["Allow"] = string.Join(", ", allow);');

    // INSIDE UseStatusCodePages and BEFORE MapControllers. The guard writes no
    // body on purpose: the status-code responder above it fills the same
    // RFC 7807 envelope a framework-detected 405 gets. Emitted the other way
    // round it would answer a bodiless 405 — a second error contract.
    const pages = program.indexOf("app.UseStatusCodePages(");
    // The guard is the `app.Use` that reads the static-subpath table; other
    // `app.Use` middleware (security headers) is emitted earlier.
    const guard = program.indexOf("staticSubpathMethods.TryGetValue(");
    const map = program.indexOf("app.MapControllers();");
    expect(pages).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(-1);
    expect(map).toBeGreaterThan(-1);
    expect(pages).toBeLessThan(guard);
    expect(guard).toBeLessThan(map);
  });

  it("java — a filter that hands Spring its own exception", async () => {
    const files = await generateSystemFiles(src("java"));
    const filter = fileEndingWith(files, "api/StaticSubpathMethodFilter.java");
    expect(filter).toContain('Map.entry("/api/customers/by_email", List.of("GET"))');
    expect(filter).toContain("extends OncePerRequestFilter");

    // It RAISES rather than renders. A filter is outside DispatcherServlet, so
    // a thrown exception would never reach @RestControllerAdvice; resolving it
    // explicitly puts the 405 back on the advice's own path, which is what
    // makes the envelope (and the Allow header) identical to a
    // framework-detected method miss instead of a second implementation of it.
    expect(filter).toContain("HandlerExceptionResolver");
    expect(filter).toContain(
      "new HttpRequestMethodNotSupportedException(request.getMethod(), allow)",
    );
    // …and never its own writer: an ObjectMapper here would lack Spring's
    // ProblemDetailJacksonMixin and emit `type` twice.
    expect(filter).not.toContain("ObjectMapper");
  });

  it("java — F26: every 405 carries the Allow the framework computed", async () => {
    const files = await generateSystemFiles(src("java"));
    const advice = fileEndingWith(files, "api/ApiExceptionAdvice.java");
    // The catch-all re-wraps an ErrorResponse's body in its own ResponseEntity,
    // which dropped the headers the framework put the SEMANTICS in — `Allow`
    // on a 405 (a MUST), `WWW-Authenticate` on a 401.
    expect(advice).toContain(
      "return respond(problem(status, reason, detail, frameworkCode(status), request), status, er.getHeaders());",
    );
    expect(advice).toContain(".headers(headers)");
  });

  it("a model with no static sub-path emits no guard at all", async () => {
    // Narrowness: nothing to shadow ⇒ no table, no middleware, no new file.
    const noStatic = (platform: string): string =>
      src(platform)
        .replace(" with scaffoldGet(of: ByEmail)", "")
        .replace(" with scaffoldGetApi(of: ByEmail)", "");
    const files = await generateSystemFiles(noStatic("java"));
    expect([...files.keys()].some((k) => k.endsWith("StaticSubpathMethodFilter.java"))).toBe(false);

    const py = await generateSystemFiles(noStatic("python"));
    expect(fileEndingWith(py, "app/main.py")).not.toContain("_STATIC_SUBPATH_METHODS");

    const dn = await generateSystemFiles(noStatic("dotnet"));
    expect(fileEndingWith(dn, "Program.cs")).not.toContain("staticSubpathMethods");
  });
});
