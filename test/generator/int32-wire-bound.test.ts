// A declared `int` is an `int4` COLUMN, and its wire form must say so.
//
// node and python published `{"type": "integer"}` with no bound and enforced
// none, so a value the published contract PERMITS reached the column and
// overflowed it. .NET and java have always published `format: int32` and
// rejected the overflow at the binder — this is the other two catching up to
// them, not a new rule.
//
// ── Measured on four booted apps, `POST /api/orders` with the same body ────
//   `{"sku":"A","qty":9543751572142,"placedAt":"…","price":{…}}`
//
//              published `qty`                    before   after
//   node       {"type":"integer"}                  500      422
//   python     {"type":"integer"}                  500      422
//   dotnet     {"type":"integer","format":"int32"} 400      400   ← already right
//   java       {"type":"integer","format":"int32"} 400      400   ← already right
//
// and after, node and python publish the `int32` format the other two do. A
// valid body still answers 201 on all four; nothing else in the probe set
// moved (schemathesis F11).
//
// ── Why the two fixes are one line each, in the one place each ────────────
// node: the three `*_PRIMITIVE` maps in the hono routes-builder are where a
// wire primitive becomes a zod chain, so the bound and the published format
// ride together — `.min/.max` make the rejection the shared 422 `defaultHook`
// already answers.
//
// python: `Int32` is an `Annotated[int, Field(...), WithJsonSchema(...)]`
// alias in `wire_models.py`, the exact twin of the `UuidStr` alias already
// there for the same reason — `Field` supplies the validation (an ordinary
// pydantic error, so FastAPI's standard 422), `WithJsonSchema` supplies the
// published shape, so the spec reads `format: int32` rather than pydantic's
// own `minimum`/`maximum` pair.
//
// ── `long` deliberately gets no twin ──────────────────────────────────────
// It is a `bigint` column, and the int64 range it would declare is wider than
// a JSON number carries exactly on either runtime. Publishing a bound nothing
// enforces is the F21 mistake, one type over.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

const src = (platform: string): string => `
system S {
  subdomain D {
    context C {
      aggregate Order with crudish {
        qty: int
        big: long
        label: string
      }
      repository Orders for Order {
        find byQty(qty: int): Order[]
      }
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

describe("node — a declared int carries its int4 bound onto the wire", () => {
  it("the request schema bounds AND publishes int32", async () => {
    const routes = await file("node", "http/order.routes.ts");
    expect(routes).toContain(
      `qty: z.number().int().min(${INT32_MIN}).max(${INT32_MAX}).openapi({ format: "int32" })`,
    );
  });

  it("a find's int query parameter carries it too", async () => {
    // The coercing twin: `?qty=` reaches the same column as the body field.
    const routes = await file("node", "http/order.routes.ts");
    expect(routes).toContain(
      `qty: z.coerce.number().int().min(${INT32_MIN}).max(${INT32_MAX}).openapi({ format: "int32" })`,
    );
  });

  it("the PAGING params keep their own, tighter bounds", async () => {
    // Narrowness: `page`/`pageSize` are coerced ints too, but they are not
    // `int` DOMAIN fields — they carry a deliberately much tighter range, and
    // widening them to int32 would be a regression dressed as consistency.
    const routes = await file("node", "http/order.routes.ts");
    expect(routes).toContain("page: z.coerce.number().int().min(1).max(1000000).default(1)");
    expect(routes).toContain("pageSize: z.coerce.number().int().min(1).max(500).default(20)");
  });

  it("`long` stays unbounded — a bigint has no int32 bound to state", async () => {
    const routes = await file("node", "http/order.routes.ts");
    const big = routes.split("\n").find((l) => l.trim().startsWith("big:"));
    expect(big, "the long field is not emitted").toBeDefined();
    expect(big as string).toContain("z.number().int()");
    expect(big as string).not.toContain(`${INT32_MAX}`);
  });
});

describe("python — the Int32 alias carries the bound and the published format", () => {
  it("wire_models.py declares the alias once", async () => {
    const wire = await file("python", "app/http/wire_models.py");
    expect(wire).toContain("Int32 = Annotated[");
    expect(wire).toContain(`Field(ge=${INT32_MIN}, le=${INT32_MAX})`);
    // WithJsonSchema, not pydantic's own bounds, so the spec matches .NET/java.
    expect(wire).toContain('WithJsonSchema({"type": "integer", "format": "int32"})');
  });

  it("an int request field is annotated with it, a long is not", async () => {
    const routes = await file("python", "app/http/order_routes.py");
    expect(routes).toContain("qty: Int32");
    // `long` is a `bigint` column and takes no int4 bound — but it does take the
    // F17 numeric-type guard, so it is `WireInt`, not a bare `int`.  The point
    // this case makes is unchanged: `long` must NOT get `Int32`'s range.
    expect(routes).toContain("big: WireInt");
    expect(routes).not.toContain("big: Int32");
  });

  it("the alias is imported where it is used", async () => {
    // ruff F401 forbids the unused half, so the import is demand-driven and a
    // missing one is a hard failure of the generated project, not a warning.
    const routes = await file("python", "app/http/order_routes.py");
    const imp = routes.split("\n").find((l) => l.startsWith("from app.http.wire_models import"));
    expect(imp, "no wire_models import emitted").toBeDefined();
    expect(imp as string).toContain("Int32");
  });
});

describe("the two backends that were already right are unmoved", () => {
  it("dotnet keeps a plain int — the binder is the enforcement", async () => {
    const dto = await file("dotnet", "Orders/Requests/OrderRequests.cs");
    expect(dto).toContain("int Qty");
    expect(dto).toContain("long Big");
  });

  it("java keeps a plain int", async () => {
    const req = await file("java", "orders/CreateOrderRequest.java");
    expect(req).toContain("int qty");
    expect(req).toContain("long big");
  });
});
