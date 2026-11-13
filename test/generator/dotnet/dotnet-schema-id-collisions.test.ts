// .NET OpenAPI schema-id collisions (schemathesis finding F14).
//
// The emitter writes one wire-DTO namespace PER AGGREGATE, so a value object
// used by two aggregates emits two CLR types with the same SHORT name
// (`Api.Application.Products.Requests.MoneyRequest` /
// `…Orders.Requests.MoneyRequest`).  Swashbuckle's default schemaId selector is
// that short name, and a duplicate throws — taking the WHOLE
// `GET /openapi.json` document down with a 500, so the deployable publishes no
// contract at all (which is why `storefront-system` had to be skipped in the
// dotnet schemathesis leg).
//
// The fix is deliberately narrow: only the genuinely colliding short names are
// qualified, so the component set a collision-free project publishes stays
// SHORT — the shape the four other backends publish and `.loom/wire-spec.json`
// compares.  Both halves are pinned here: the collision is detected and
// qualified, and a collision-free project emits today's exact fallback.

import { describe, expect, it } from "vitest";
import { dotnetSchemaIdOverrides } from "../../../src/generator/dotnet/schema-ids.js";
import { generateBackendFromSource } from "../../_helpers/generate.js";

// One value object, two aggregates carrying it, one deployable.  The DTO
// namespaces are per aggregate, so that is two `MoneyRequest` / `MoneyResponse`
// CLR types in one assembly: the F14 reproduction.  (Two contexts each
// declaring their own `Money` on one deployable is rejected up front by
// `loom.hosted-type-name-collision`, so the shared value object is the shape a
// user can actually reach.)
const SHARED_VO_SRC = `system S {
  subdomain M {
    context Catalog {
      valueobject Money { amount: decimal  currency: string }
      aggregate Product with crudish {
        sku: string
        price: Money
      }
      aggregate Order with crudish {
        reference: string
        total: Money
      }
    }
  }
  storage db { type: postgres }
  resource catalogState { for: Catalog, kind: state, use: db }
  deployable api {
    platform: dotnet
    contexts: [Catalog]
    dataSources: [catalogState]
  }
}`;

// One context, one aggregate using the value object — no short name is emitted
// twice, so nothing may be qualified and Program.cs must stay as it was.
const COLLISION_FREE_SRC = `system S {
  subdomain M {
    context Catalog {
      valueobject Money { amount: decimal  currency: string }
      aggregate Product with crudish {
        sku: string
        price: Money
      }
    }
  }
  storage db { type: postgres }
  resource catalogState { for: Catalog, kind: state, use: db }
  deployable api {
    platform: dotnet
    contexts: [Catalog]
    dataSources: [catalogState]
  }
}`;

// Program.cs's schema-id lambda EXACTLY as it reads with no collisions — the
// byte-identical-output assertion for every single-context / collision-free
// system (i.e. the whole existing corpus).
const UNQUALIFIED_LAMBDA = `    c.CustomSchemaIds(t =>
    {
        if (t.IsGenericType && t.GetGenericTypeDefinition().Name.StartsWith("Paged", StringComparison.Ordinal))
        {
            var inner = t.GetGenericArguments()[0].Name;
            var stem = inner.EndsWith("Response", StringComparison.Ordinal) ? inner.Substring(0, inner.Length - "Response".Length) : inner;
            return stem + "Paged";
        }
        // The documented problem body is published as the RFC 7807
        // \`ProblemDetails\` component every backend names.
        if (t == typeof(global::Api.Api.ProblemResponse)) return "ProblemDetails";
        // A success arm of a union whose error arms answer as problems is
        // published under the success union's name: \`<Union>Success_<Tag>\`.
        if (t.BaseType is { IsAbstract: true } success && success.BaseType is { } union
            && success.Name == union.Name + "Success" && t.Name.StartsWith(union.Name + "_", StringComparison.Ordinal))
            return string.Concat(success.Name, t.Name.AsSpan(union.Name.Length));
        return t.Name;
    });
`;

// The deployable `api` is the project's root namespace `Api`.
const filesFrom = (src: string): Promise<Map<string, string>> =>
  generateBackendFromSource(src, "dotnet");

describe(".NET OpenAPI schema ids (F14)", () => {
  it("detects the colliding DTO short names across the project's namespaces", async () => {
    const files = await filesFrom(SHARED_VO_SRC);

    // Precondition: the two same-named CLR types really are emitted.
    expect(files.get("Application/Products/Requests/ProductRequests.cs")).toContain(
      "public sealed record MoneyRequest(",
    );
    expect(files.get("Application/Orders/Requests/OrderRequests.cs")).toContain(
      "public sealed record MoneyRequest(",
    );

    const overrides = dotnetSchemaIdOverrides(files);
    const byFullName = new Map(overrides.map((o) => [o.clrFullName, o.schemaId]));
    expect(byFullName.get("Api.Application.Products.Requests.MoneyRequest")).toBe(
      "ProductsMoneyRequest",
    );
    expect(byFullName.get("Api.Application.Orders.Requests.MoneyRequest")).toBe(
      "OrdersMoneyRequest",
    );
    expect(byFullName.get("Api.Application.Products.Responses.MoneyResponse")).toBe(
      "ProductsMoneyResponse",
    );
    expect(byFullName.get("Api.Application.Orders.Responses.MoneyResponse")).toBe(
      "OrdersMoneyResponse",
    );

    // NARROW: a DTO whose short name is unique keeps it, so the component set
    // stays comparable with the four other backends.
    const qualifiedNames = overrides.map((o) => o.clrFullName.split(".").pop());
    expect(qualifiedNames).not.toContain("CreateProductRequest");
    expect(qualifiedNames).not.toContain("ProductResponse");
    expect(new Set(qualifiedNames)).toEqual(new Set(["MoneyRequest", "MoneyResponse"]));

    // Every published id is still unique — the point of the exercise.
    expect(new Set(overrides.map((o) => o.schemaId)).size).toBe(overrides.length);
  });

  it("emits a Program.cs lambda naming BOTH qualified ids", async () => {
    const program = (await filesFrom(SHARED_VO_SRC)).get("Program.cs") ?? "";

    expect(program).toContain(
      '["Api.Application.Products.Requests.MoneyRequest"] = "ProductsMoneyRequest",',
    );
    expect(program).toContain(
      '["Api.Application.Orders.Requests.MoneyRequest"] = "OrdersMoneyRequest",',
    );
    // The lookup runs INSIDE CustomSchemaIds, after the Paged<> arm, and the
    // short-name fallback still stands for everything else.
    expect(program).toContain(
      "if (t.FullName is not null && collidingSchemaIds.TryGetValue(t.FullName, out var qualified))",
    );
    expect(program.indexOf("var collidingSchemaIds")).toBeLessThan(
      program.indexOf("c.CustomSchemaIds(t =>"),
    );
    expect(program.indexOf('return stem + "Paged";')).toBeLessThan(
      program.indexOf("collidingSchemaIds.TryGetValue"),
    );
    expect(program).toContain("        return t.Name;");
  });

  it("leaves a collision-free project byte-identical", async () => {
    const files = await filesFrom(COLLISION_FREE_SRC);
    expect(dotnetSchemaIdOverrides(files)).toEqual([]);

    const program = files.get("Program.cs") ?? "";
    expect(program).toContain(UNQUALIFIED_LAMBDA);
    expect(program).not.toContain("collidingSchemaIds");
    expect(program).not.toContain("Dictionary<string, string>");
  });
});
