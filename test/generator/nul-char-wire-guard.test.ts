// A declared `string` lands in a Postgres `text` column, which cannot hold
// U+0000 — and NUL is a perfectly legal JSON string character, so nothing
// upstream refused it and the driver's rejection escaped as a **500**.
//
// ── Measured on four booted apps, `POST /api/orders` with a NUL inside `sku` ──
//
//              before   after   pointer   message
//   node        500      422     /sku     "Invalid input"
//   python      500      422     /sku     "Value error, must not contain a NUL character"
//   dotnet      500      422     /sku     "The Sku field must not contain a NUL character."
//   java        500      422     /sku     "must not contain a NUL character"
//
// A valid body still answers 201 on all four. With this closed, no body on the
// create path answers 500 on any backend (schemathesis F20 — recorded as
// dotnet-only, measured as universal).
//
// ── Enforced, deliberately NOT published ──────────────────────────────────
// Every seam below is one the OpenAPI emitter cannot see: a zod `.refine`, a
// pydantic `AfterValidator`, a custom `ValidationAttribute`, a custom Bean
// Validation constraint. The alternative — a `pattern` excluding U+0000 on
// every string in every schema — is a large, noisy contract change for a
// character no real client sends. A server STRICTER than its published
// contract is safe; the reverse (F21, a published `minLength` nothing
// enforced) is not.
//
// Each seam also lands in the 422 envelope its backend already had, so none of
// them needed a new status arm.
//
// ── Narrowness ────────────────────────────────────────────────────────────
// - REQUEST only. A response string came out of the very column that cannot
//   hold a NUL.
// - Null passes on all four, so an OPTIONAL member is not made required by
//   carrying the guard.
// - Plain `string` only where the type is known (node, python, java): `guid`,
//   `datetime` and `money` cross as strings too, but each already has a parse
//   or pattern a NUL cannot pass. .NET's `dtoParam` sees only the C# type, so
//   its guard also lands on those — inert, since their own parse rejects first.
//
// ── The zod-3 ordering trap ───────────────────────────────────────────────
// On node the guard is appended AFTER the invariant chain, not folded into the
// base. Under zod 3 — which the `node@v4` lane still pins — `.refine()` returns
// a `ZodEffects` wrapper that no longer exposes `.regex`/`.min`, so a guard in
// the base would make `z.string().refine(…).regex(/…/)` a type error in every
// generated project on that lane. Same reasoning as `orderSingleFieldPatterns`.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const src = (platform: string): string => `
system S {
  subdomain D {
    context C {
      valueobject Money { amount: decimal  currency: string }
      aggregate Order with crudish {
        sku: string
        note: string?
        placedAt: datetime
        price: Money
        invariant sku.matches("^[A-Z]+$")
      }
      repository Orders for Order { }
    }
  }
  api A from D
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d { platform: ${platform}, contexts: [C], dataSources: [st], serves: A, port: 4000 }
}
`;

async function file(platform: string, suffix: string): Promise<string> {
  const files = await generateSystemFiles(src(platform));
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted for ${platform}`).toBeDefined();
  return files.get(key as string) as string;
}

const REFINE = '.refine((s: string) => !s.includes("\\u0000"))';

describe("node — a zod refine the OpenAPI emitter cannot see", () => {
  it("guards a request string", async () => {
    const routes = await file("node", "http/order.routes.ts");
    const create = routes.split("\n").find((l) => l.trim().startsWith("sku:"));
    expect(create, "the sku field is not emitted").toBeDefined();
    expect(create as string).toContain(REFINE);
  });

  it("appends the guard AFTER a declared regex — the zod-3 ZodEffects trap", async () => {
    const routes = await file("node", "http/order.routes.ts");
    const create = (routes.split("\n").find((l) => l.trim().startsWith("sku:")) ?? "") as string;
    const regexAt = create.indexOf(".regex(");
    const guardAt = create.indexOf(REFINE);
    expect(regexAt, "the declared regex is not emitted").toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(regexAt);
  });

  it("the RESPONSE string is not guarded", async () => {
    const routes = await file("node", "http/order.routes.ts");
    const response = routes.slice(routes.indexOf("const OrderResponse = z.object({"));
    const sku = response.split("\n").find((l) => l.trim().startsWith("sku:"));
    expect(sku, "the response sku is not emitted").toBeDefined();
    expect(sku as string).not.toContain(REFINE);
  });
});

describe("python — a pydantic AfterValidator alias, the twin of UuidStr/Int32", () => {
  it("wire_models.py declares the alias once", async () => {
    const wire = await file("python", "app/http/wire_models.py");
    expect(wire).toContain("def _reject_nul(value: str) -> str:");
    expect(wire).toContain("WireStr = Annotated[str, AfterValidator(_reject_nul)]");
  });

  it("a request string uses it; a response string does not", async () => {
    const routes = await file("python", "app/http/order_routes.py");
    const create = routes.slice(routes.indexOf("class CreateOrderRequest(BaseModel):"));
    expect(create.split("\n\n")[0]).toContain("sku: WireStr");
    const response = routes.slice(routes.indexOf("class OrderResponse(BaseModel):"));
    expect(response.split("\n\n")[0]).toContain("sku: str");
  });
});

describe("dotnet — a custom ValidationAttribute, not [RegularExpression]", () => {
  it("the attribute is emitted and passes null", async () => {
    const attr = await file("dotnet", "Api/NoNulCharAttribute.cs");
    expect(attr).toContain("public sealed class NoNulCharAttribute : ValidationAttribute");
    expect(attr).toContain("value is not string s || !s.Contains('\\0');");
  });

  it("request strings carry it, required and optional alike", async () => {
    const dto = await file("dotnet", "Orders/Requests/OrderRequests.cs");
    expect(dto).toContain("[NoNulChar] [Required(AllowEmptyStrings = true)] string Sku");
    expect(dto).toContain("[NoNulChar] string? Note");
    expect(dto).toContain("using D.Api;");
  });

  it("response strings do not", async () => {
    const dto = await file("dotnet", "Orders/Responses/OrderResponses.cs");
    expect(dto).not.toContain("NoNulChar");
    expect(dto).not.toContain("using D.Api;");
  });
});

describe("java — a custom Bean Validation constraint, not @Pattern", () => {
  it("the constraint is emitted and passes null", async () => {
    const c = await file("java", "api/NoNulChar.java");
    expect(c).toContain("public @interface NoNulChar");
    expect(c).toContain("class Validator implements ConstraintValidator<NoNulChar, String>");
    expect(c).toContain("return value == null || value.indexOf('\\0') < 0;");
    expect(c).toContain("ElementType.RECORD_COMPONENT");
  });

  it("request strings carry it, required and optional alike", async () => {
    const req = await file("java", "orders/CreateOrderRequest.java");
    expect(req).toContain("@NotNull @NoNulChar String sku");
    expect(req).toContain("@NoNulChar String note");
  });

  it("a datetime and a money string do NOT carry it", async () => {
    // Both cross the wire as strings, and both already have a parse a NUL
    // cannot pass — guarding them would be noise, and the narrowness is what
    // keeps the guard describable as "the plain-string rule".
    const req = await file("java", "orders/CreateOrderRequest.java");
    expect(req).toContain("@NotNull String placedAt");
    expect(req).not.toContain("@NoNulChar String placedAt");
  });

  it("a value object's request strings carry it; the response record does not", async () => {
    const money = await file("java", "orders/MoneyRequest.java");
    expect(money).toContain("@NotNull @NoNulChar String currency");
    const resp = await file("java", "orders/OrderResponse.java");
    expect(resp).not.toContain("NoNulChar");
  });
});
