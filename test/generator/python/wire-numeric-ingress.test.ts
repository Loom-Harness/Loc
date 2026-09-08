import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// M-T6.48, python arm — a malformed money string is a 422, not a 500.
//
// `money` crosses the wire as a STRING and the route re-parses it with
// `Decimal(...)` (`pyWireToDomain`).  That parse was bare, so `{"price":
// "12,50"}` raised `decimal.InvalidOperation` out of the handler and FastAPI
// answered **500** — a client error reported as a server fault.  node answers a
// typed 4xx and .NET (whose arm landed first, W1b) answers 422 with
// `{pointer, message}`.
//
// The guard is a constrained request-side alias (`MoneyStr`) rather than a
// try/except at the parse: pydantic already builds that exact envelope, and a
// field-level validator's error carries the field's own `loc`, so the pointer
// is `/price` — and `/best/offer` for a value-object field — with no pointer
// plumbing at the raise site.  Sibling of
// `test/generator/dotnet/wire-numeric-ingress.test.ts`.
// ---------------------------------------------------------------------------

const SRC = `
system S {
  subdomain D {
    context C {
      valueobject Offer { price: money  note: string? }
      aggregate Product with crudish {
        name:  string
        price: money
        rate:  decimal
        best:  Offer
        operation reprice(newPrice: money) { price := newPrice }
      }
      repository Products for Product { }
    }
  }
  api A from D
  storage db { type: postgres }
  resource st { for: C, kind: state, use: db }
  deployable api1 { platform: python contexts: [C] dataSources: [st] serves: A port: 8000 }
}
`;

const filesFor = async () => {
  const files = await generateSystemFiles(SRC);
  const get = (suffix: string) =>
    [...files.entries()].find(([p]) => p.endsWith(suffix))?.[1] as string;
  return { wire: get("app/http/wire_models.py"), routes: get("app/http/product_routes.py") };
};

describe("python money ingress (M-T6.48)", () => {
  it("declares the money grammar once, with node's regex character for character", async () => {
    const { wire } = await filesFor();
    expect(wire).toContain('_MONEY_RE = re.compile(r"^-?\\d+(\\.\\d+)?$")');
    expect(wire).toContain("MoneyStr = Annotated[");
    expect(wire).toContain("AfterValidator(_money_str),");
  });

  it("refuses with the SAME message the other backends send", async () => {
    const { wire } = await filesFor();
    // node's `moneySchema` and .NET's `WireFormatException` both say
    // `Invalid decimal: "12,50"`. The wire-golden differential compares bodies
    // across backends, so a divergent message is itself a divergence.
    expect(wire).toContain(
      '"money_format", "Invalid decimal: {value}", {"value": json.dumps(value)}',
    );
    // A bare `ValueError` would prefix the text with "Value error, ".
    expect(wire).not.toContain("raise ValueError");
  });

  it("constrains every REQUEST money field — create, update, operation param and VO", async () => {
    const { wire, routes } = await filesFor();
    // The value object, so a nested field reports `/best/offer`.
    expect(wire).toMatch(/class Offer\(BaseModel\):\n\s+price: MoneyStr/);
    // Create + update bodies and the operation parameter.
    expect([...routes.matchAll(/price: MoneyStr/g)].length).toBeGreaterThanOrEqual(2);
    expect(routes).toContain("newPrice: MoneyStr");
    expect(routes).toContain("from app.http.wire_models import");
    expect(routes).toContain("MoneyStr");
  });

  it("leaves the RESPONSE side a bare str, and `decimal` a float, untouched", async () => {
    const { routes } = await filesFor();
    // Our own digits going out — the constraint could never fire, and
    // narrowing it would publish a needless restriction to clients.
    expect(routes).toMatch(/price: str/);
    // `decimal` is the control: a JSON number (RS-24), not a string, so it is
    // not this guard's business and must not have moved.
    expect(routes).toMatch(/rate: float/);
    expect(routes).not.toContain("rate: MoneyStr");
  });
});
