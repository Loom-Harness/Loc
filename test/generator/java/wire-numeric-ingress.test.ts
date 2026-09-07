import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// M-T6.48, java arm — a malformed money string is a 422 with a pointer, not a 500.
//
// `wireToDomain` converted a money request field with a bare
// `new BigDecimal(expr)`, so `{"price": "12,50"}` threw NumberFormatException
// out of the service, fell past the 4xx branch of `onUnhandled`, and answered
// **500** — the fourth instance of the recurring bug `api.ts` documents three
// others of: a CLIENT fault reported as a server fault.
//
// The pointer is a REQUIRED argument of `wireToDomain`, not an optional one:
// that is what stops a new call site reintroducing a bare, un-pointed parse by
// simply forgetting it. The .NET arm took the same decision for the same reason.
// ---------------------------------------------------------------------------

const SRC = `
system S {
  subdomain D {
    context C {
      valueobject Offer { price: money  note: string? }
      aggregate Product with crudish {
        name:  string
        price: money
        qty:   int
        best:  Offer
        operation reprice(newPrice: money) { price := newPrice }
      }
      repository Products for Product { }
    }
  }
  api A from D
  storage db { type: postgres }
  resource st { for: C, kind: state, use: db }
  deployable api1 { platform: java contexts: [C] dataSources: [st] serves: A port: 8080 }
}
`;

const filesFor = async () => {
  const files = await generateSystemFiles(SRC);
  const get = (suffix: string) =>
    [...files.entries()].find(([p]) => p.endsWith(suffix))?.[1] as string;
  return {
    ex: get("domain/common/WireFormatException.java"),
    service: get("features/products/ProductService.java"),
    advice: get("ApiExceptionAdvice.java"),
  };
};

describe("java money ingress (M-T6.48)", () => {
  it("parses money through the guarded helper, never a bare BigDecimal", async () => {
    const { service } = await filesFor();
    expect(service).toContain('WireFormatException.money(request.price(), "/price")');
    // The defect, stated so a regression reads as itself.
    expect(service).not.toContain("new BigDecimal(request.price())");
  });

  it("carries the field's own pointer — including the operation param and the VO", async () => {
    const { service } = await filesFor();
    expect(service).toContain('WireFormatException.money(request.newPrice(), "/newPrice")');
    // The value-object mapper converts its own fields, so a nested money field
    // reports its own name rather than the document root.
    expect(service).toMatch(
      /new Offer\(WireFormatException\.money\(request\.price\(\), "\/price"\)/,
    );
  });

  it("declares node's grammar and node's message, character for character", async () => {
    const { ex } = await filesFor();
    // Compiled and RUN standalone against JDK 21: all 11 shared cases agree
    // with node, .NET and python on accept/reject AND on the message text.
    expect(ex).toContain('Pattern.compile("^-?\\\\d+(\\\\.\\\\d+)?$")');
    expect(ex).toContain(
      'throw new WireFormatException(pointer, "Invalid decimal: " + quote(value));',
    );
  });

  it("renders the 422 with the errors[] pointer entry the other backends send", async () => {
    const { advice } = await filesFor();
    expect(advice).toContain("@ExceptionHandler(WireFormatException.class)");
    expect(advice).toContain('entry.put("pointer", e.getPointer());');
    expect(advice).toContain('problem.setProperty("errors", java.util.List.of(entry));');
  });

  it("leaves non-money conversions alone — `int` and `string` are the control", async () => {
    const { service } = await filesFor();
    // `qty` is an int: a JSON number already, so it needs no wire parse and
    // must not have acquired one.
    expect(service).not.toContain("WireFormatException.money(request.qty()");
    expect(service).not.toContain("WireFormatException.money(request.name()");
  });
});
