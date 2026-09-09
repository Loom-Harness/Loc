// A malformed path `{id}` answers the declared 422 on every backend — that is
// the contract `malformed-path-id-status.test.ts` pins across four of them.
// On .NET it held only for routes that carry NO body. Add a `[FromBody]`
// parameter and send no `Content-Type`, and `BodyModelBinder` short-circuits
// the whole binding pass with a **415** before the path parameter is looked at
// (schemathesis F22, waiver W26).
//
// ── Measured on a booted app ──────────────────────────────────────────────
//
//   request                                          before   after
//   POST /api/orders/not-a-uuid/confirm  (no CT)      415      422
//   POST /api/orders/not-a-uuid/confirm  (+ CT)       422      422
//   POST /api/orders/not-a-uuid/add_line (no CT)      415      422
//   GET  /api/orders/not-a-uuid                       422      422
//   node, every one of them                           422      422
//
// 415 is the one status the contract says least about, and it is not a
// rejection the caller can act on: the request's real defect is the identifier,
// which no media type would have fixed. The fuzzer does not count 415 as a
// rejection either, which is what made this a `negative_data_rejection` finding
// rather than a silent divergence.
//
// ── Why a RESOURCE filter, and not the two obvious alternatives ───────────
// MVC runs resource filters after routing but BEFORE model binding — the only
// window in which the route value can be judged ahead of the media-type check.
//
//  - A `{id:guid}` ROUTE CONSTRAINT was rejected for F18 and is still wrong: it
//    makes the route not match at all, turning the declared 422 into a
//    framework 404 and breaking the four-backend contract.
//  - MIDDLEWARE runs before routing, so it would have to re-derive every route
//    shape (and re-exclude every static sub-path) from a table — the duplication
//    F18's `staticSubpathRoutes` exists to avoid, for a check that needs no
//    table at all.
//
// The filter reads the ACTION's own `id` parameter type instead: an aggregate
// keyed by `int`/`string` has no Guid parameter and is untouched, and a static
// sub-path like `/api/customers/by_email` has already been routed to its own
// action by the time this runs.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const src = `
system S {
  subdomain D {
    context C {
      aggregate Order with crudish {
        sku: string
        operation confirm() { sku := sku }
      }
      repository Orders for Order { }
    }
  }
  api A from D
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d { platform: dotnet, contexts: [C], dataSources: [st], serves: A, port: 4000 }
}
`;

async function file(suffix: string): Promise<string> {
  const all = await generateSystemFiles(src);
  const key = [...all.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return all.get(key as string) as string;
}

describe("the guard runs before model binding, and only where it binds", () => {
  it("is a resource filter — the one stage that precedes the media-type check", async () => {
    const filter = await file("Api/MalformedPathIdFilter.cs");
    expect(filter).toContain("public sealed class MalformedPathIdFilter : IResourceFilter");
    expect(filter).toContain("public void OnResourceExecuting(ResourceExecutingContext context)");
  });

  it("keys on the ACTION's own Guid `id` parameter, not on a route table", async () => {
    const filter = await file("Api/MalformedPathIdFilter.cs");
    expect(filter).toContain("context.ActionDescriptor.Parameters.Any(p =>");
    expect(filter).toContain("p.ParameterType == typeof(Guid) || p.ParameterType == typeof(Guid?)");
    // No route shapes anywhere — that is the whole point of reading the action.
    expect(filter).not.toContain("/api/");
  });

  it("answers the SAME 422 envelope the Guid binder gives on a bodyless route", async () => {
    const filter = await file("Api/MalformedPathIdFilter.cs");
    expect(filter).toContain('Title = "Validation failed"');
    expect(filter).toContain("Status = 422");
    expect(filter).toContain('Detail = "One or more fields are invalid."');
    expect(filter).toContain('["pointer"] = "/id"');
    // MVC's own ModelBindingMessageProvider wording, verbatim.
    expect(filter).toContain(`["message"] = $"The value '{text}' is not valid."`);
  });

  it("is registered FIRST, ahead of the domain exception filter", async () => {
    const program = await file("Program.cs");
    const guardAt = program.indexOf("opts.Filters.Add<MalformedPathIdFilter>();");
    const domainAt = program.indexOf("opts.Filters.Add<DomainExceptionFilter>();");
    expect(guardAt).toBeGreaterThan(-1);
    expect(domainAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(domainAt);
  });

  it("a route constraint is NOT how this is done — it would 404 instead of 422", async () => {
    // The rejected alternative, pinned next to the chosen one. `{id:guid}` makes
    // the route not match, which turns the declared 422 into a framework 404 and
    // breaks `malformed-path-id-status.test.ts`.
    const controller = await file("Api/OrdersController.cs");
    expect(controller).not.toContain("{id:guid}");
  });
});

describe("the narrowing is a RUNTIME check, not an emit-time gate", () => {
  // An aggregate's identity is always a guid today — `lower.ts` stamps
  // `idValueType` as the literal "guid" and there is no `ids` clause — so an
  // emit-time gate on it would be an always-true branch nothing could exercise,
  // and a test for its false arm could not be written without a fixture the
  // grammar rejects. The narrowing that matters therefore lives INSIDE the
  // filter and is checked per action at request time, which keeps it correct if
  // the identity axis ever opens up.
  it("the filter is emitted unconditionally and narrows itself", async () => {
    const filter = await file("Api/MalformedPathIdFilter.cs");
    expect(filter).toContain("if (!takesGuidId) return;");
    // …and it declines just as quietly when the route carries no `id` at all,
    // which is every collection-level route in the project.
    expect(filter).toContain(
      'if (!context.RouteData.Values.TryGetValue("id", out var raw)) return;',
    );
  });

  it("a well-formed id falls straight through", async () => {
    const filter = await file("Api/MalformedPathIdFilter.cs");
    expect(filter).toContain("if (text is null || Guid.TryParse(text, out _)) return;");
  });
});
