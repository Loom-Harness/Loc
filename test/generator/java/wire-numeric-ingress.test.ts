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

  it("makes numeric request fields strict — no float→int truncation, no stringified numbers", async () => {
    const files = await generateSystemFiles(SRC);
    const cfg = [...files.entries()].find(([p]) =>
      p.endsWith("config/WireNumberStrictness.java"),
    )?.[1] as string;
    expect(cfg).toBeDefined();
    // MEASURED on the generated project before this existed, with the app's own
    // mapper: `{"qty": 1.5}` deserialized to `qty=1` (silent truncation) and
    // `{"qty": "7"}` to `7`. Both now refuse; a real `7` still parses.
    expect(cfg).toContain("builder.disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT);");
    expect(cfg).toContain("cfg.setCoercion(CoercionInputShape.String, CoercionAction.Fail)");
    expect(cfg).toContain("LogicalType.Integer,");
  });

  // ------------------------------------------------------------------------
  // The OTHER coercion direction, found 2026-09-13 by the java Schemathesis
  // leg (audit finding F21 / waiver W34, wave C2 packet 2d) and diagnosed on a
  // BOOTED Spring Boot app against a real Postgres — the rule's own recorded
  // reason had guessed at an unenforced `minLength`, which the measurement
  // disproved.
  //
  // WHAT THE FUZZER ACTUALLY FOUND: `POST /api/customers` with
  // `{"name": "", "email": 0}` and `{"name": "", "email": false}` answered
  // **201**, for a body the API's OWN published schema declares as
  // `type: string`.  Jackson's default coercion turns a JSON number or boolean
  // into the Strings `"0"` / `"false"`, so a schema-violating body was accepted
  // and a row created with an email nobody sent.  The same coercion reaches
  // EVERY string-typed wire field, which on java includes `money` (it rides the
  // wire as a decimal STRING), so `{"price": 12.5}` was accepted too — the one
  // `numeric-ingress-parity`'s header table records java as REFUSING.
  //
  // MEASURED FROM OUTSIDE BOTH EMITTERS (rule 12): the same fuzzer, the same
  // fixture, the same check on the NODE leg reports nothing on that route —
  // `z.string()` refuses a number — so this was java alone, not the contract.
  // ------------------------------------------------------------------------
  it("refuses a JSON number / boolean where the schema declares a string", async () => {
    const files = await generateSystemFiles(SRC);
    const cfg = [...files.entries()].find(([p]) =>
      p.endsWith("config/WireNumberStrictness.java"),
    )?.[1] as string;
    expect(cfg).toBeDefined();
    expect(cfg).toContain("LogicalType.Textual,");
    for (const shape of ["Integer", "Float", "Boolean"]) {
      expect(cfg, `CoercionInputShape.${shape} must not coerce into a string wire field`).toContain(
        `cfg.setCoercion(CoercionInputShape.${shape}, CoercionAction.Fail);`,
      );
    }
    // THE CONTROL, so this never becomes "refuse every coercion": a String IS
    // what a string field expects, and the Integer arm above still has to keep
    // its own String→Integer refusal.
    expect(cfg).not.toContain(
      "cfg.setCoercion(CoercionInputShape.String, CoercionAction.Fail);\n                    ",
    );
    expect(cfg).toContain("LogicalType.Integer,");
  });

  it("leaves non-money conversions alone — `int` and `string` are the control", async () => {
    const { service } = await filesFor();
    // `qty` is an int: a JSON number already, so it needs no wire parse and
    // must not have acquired one.
    expect(service).not.toContain("WireFormatException.money(request.qty()");
    expect(service).not.toContain("WireFormatException.money(request.name()");
  });
});
