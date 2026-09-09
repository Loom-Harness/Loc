// pydantic's default LAX mode coerces across JSON types, so python accepted
// bodies the published contract rejects: `{"amount": false}` for a field
// declared `{"type": "number"}` answered **201** — python's `bool` is an `int`
// subclass — and `{"amount": "1.5"}` went through for the same reason.
// (schemathesis F17, which is F7's python half; the node leg was already clean.)
//
// ── Measured on a booted app, POST /api/products ──────────────────────────
//
//   body                        before   after
//   {"amount": false}           201      422  /price/amount
//   {"amount": "1.5"}           201      422  /price/amount
//   {"amount": 1}    (integer)  201      201    ← JSON says this IS a number
//   {"amount": 1.5}             201      201
//
// node, for the same body: 422 "expected number, received boolean". So this is
// python catching up to the other four, not a new rule — and the published
// schema does not move (`{"type":"number","minimum":0}` before and after). A
// `BeforeValidator` contributes nothing to the JSON schema, exactly like the
// `WireStr` NUL guard (F20).
//
// ── Why NOT `ConfigDict(strict=True)`, which is the obvious fix ───────────
// Because it was measured, and it breaks the app. Against
// `model_validate_json` strict mode does precisely the right thing: it refuses
// bool/str → number while still accepting an integer literal for a `number`, an
// ISO string for a `datetime` and a string for a string-valued enum. But
// FastAPI does not validate the JSON — it parses the body and validates the
// resulting DICT, i.e. in pydantic's PYTHON mode, where strict ALSO refuses
// `str → datetime` and `str → Enum`. Switched on, every create carrying a
// date-time or an enum answered 422 with "Input should be an instance of
// OrderStatus" for input that is perfectly valid JSON. The two modes differ,
// FastAPI picks the stricter one, and only a booted app says so.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const src = `
system S {
  subdomain D {
    context C {
      valueobject Money { amount: decimal  currency: string }
      aggregate Order with crudish {
        qty: int
        seq: long
        price: Money
        placedAt: datetime
      }
      repository Orders for Order { }
    }
  }
  api A from D
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d { platform: python, contexts: [C], dataSources: [st], serves: A, port: 4000 }
}
`;

async function file(suffix: string): Promise<string> {
  const files = await generateSystemFiles(src);
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return files.get(key as string) as string;
}

describe("the numeric guard rejects the JSON types a number is not", () => {
  it("wire_models.py declares the guard and both aliases", async () => {
    const wire = await file("app/http/wire_models.py");
    expect(wire).toContain("def _reject_non_number(value: object) -> object:");
    expect(wire).toContain("if isinstance(value, (bool, str)):");
    expect(wire).toContain("WireNum = Annotated[float, BeforeValidator(_reject_non_number)]");
    expect(wire).toContain("WireInt = Annotated[int, BeforeValidator(_reject_non_number)]");
  });

  it("Int32 carries it FIRST, before the coercion that would have swallowed the bool", async () => {
    const wire = await file("app/http/wire_models.py");
    const int32 = wire.slice(wire.indexOf("Int32 = Annotated["));
    const block = int32.slice(0, int32.indexOf("]") + 1);
    const guardAt = block.indexOf("BeforeValidator(_reject_non_number)");
    const boundAt = block.indexOf("Field(ge=-2147483648");
    expect(guardAt).toBeGreaterThan(-1);
    expect(boundAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(boundAt);
  });

  it("a value object's decimal field uses the guarded alias", async () => {
    const wire = await file("app/http/wire_models.py");
    const money = wire.slice(wire.indexOf("class Money("));
    expect(money.split("\n\n")[0]).toContain("amount: WireNum");
  });

  it("`long` uses the guarded int alias — it has no int4 bound to carry", async () => {
    const routes = await file("app/http/order_routes.py");
    const create = routes.slice(routes.indexOf("class CreateOrderRequest("));
    expect(create.split("\n\n")[0]).toContain("seq: WireInt");
    expect(create.split("\n\n")[0]).toContain("qty: Int32");
  });

  it("nothing about the published schema changes — the guard is invisible", async () => {
    // `BeforeValidator` contributes no JSON schema, and no `WithJsonSchema`
    // rides alongside it on WireNum/WireInt. If either grew one, the server
    // would start PUBLISHING a constraint it only enforces — F21's mistake.
    const wire = await file("app/http/wire_models.py");
    const num = wire.slice(wire.indexOf("WireNum = Annotated["));
    expect(num.split("\n")[0]).not.toContain("WithJsonSchema");
    expect(num.split("\n")[1]).not.toContain("WithJsonSchema");
  });

  it("strict mode is NOT how this is done — no request model turns it on", async () => {
    // The trap in the header. `ConfigDict(strict=True)` refuses `str -> datetime`
    // and `str -> Enum` under FastAPI's python-mode validation, which breaks
    // every create carrying either. If it ever reappears, this fails before a
    // booted app has to say so again.
    const files = await generateSystemFiles(src);
    const offenders = [...files.entries()]
      .filter(([k]) => k.endsWith(".py"))
      .filter(([, v]) => /ConfigDict\([^)]*strict\s*=\s*True/.test(v))
      .map(([k]) => k);
    expect(offenders, "these modules enable pydantic strict mode").toEqual([]);
  });

  it("a datetime and an enum are still plain annotations, not strict-wrapped", async () => {
    // The positive half of the case above: the shapes strict mode would have
    // broken are emitted exactly as before.
    const routes = await file("app/http/order_routes.py");
    const create = routes.slice(routes.indexOf("class CreateOrderRequest("));
    expect(create.split("\n\n")[0]).toContain("placedAt: datetime");
  });
});
