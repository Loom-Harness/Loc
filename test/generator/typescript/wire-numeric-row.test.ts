// RS-12 / RS-24 on node's PER-ROW response encoder, executed rather than read.
//
// The rules (docs/conformance-semantics.md):
//   RS-12  `money`   crosses as a fixed-scale decimal STRING — always 4 places.
//   RS-24  `decimal` crosses as a JSON NUMBER; only money is a string.
//
// .NET, Java and Elixir each have a dedicated gate on their per-row encoder
// (decimal-wire-narrowing / java-decimal-wire / vanilla-vo-decimal-wire).  Node
// had none: `.toFixed(4)` was asserted only on the PROJECTION path, nothing
// read the per-row `toWire`, and the numeric boundary census carries no
// decimal->number signature for node because `Number(` is too common in
// TypeScript to be a usable one.  So the backend every other one is diffed
// against had the thinnest static coverage of the rule.
//
// These are runtime-VALUE rules, which is exactly what a text match cannot
// prove — so the emitted `toWire` is transpiled and RUN, and the assertion is
// on what JSON.stringify actually puts on the wire.  It also means the gate
// does not care how the encoder is spelled, only what it produces (the
// optional-money guard is currently doubled; tidying it must not break this).
//
// Six shapes, because each is its own branch in the encoder: required,
// optional (present and absent) and collection, for both money and decimal.

import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SOURCE = `
system WireDemo {
  subdomain Billing { context Billing {
    aggregate Invoice with crudish {
      amount: money
      taxRate: decimal
      note: string
      discount: money?
      surcharge: decimal?
      fees: money[]
      rates: decimal[]
    }
    repository Invoices for Invoice { }
  } }
  api BillingApi from Billing
  storage db { type: postgres }
  resource billingState { for: Billing, kind: state, use: db }
  deployable api { platform: node, contexts: [Billing], dataSources: [billingState], serves: BillingApi, port: 3000 }
}
`;

/** decimal.js stand-in (not a toolchain dependency), limited to what `toWire`
 *  touches.  `toString` mirrors decimal.js — scale is NOT preserved, so
 *  `String(new Decimal("2"))` is `"2"` — which is precisely the regression a
 *  `String(...)` encoder would ship.  `toFixed` is exact and refuses to round:
 *  a value with more places than asked for throws rather than silently
 *  agreeing with the encoder. */
class FakeDecimal {
  constructor(readonly raw: string) {}
  toString(): string {
    return this.raw;
  }
  toFixed(dp: number): string {
    const neg = this.raw.startsWith("-");
    const [int, frac = ""] = (neg ? this.raw.slice(1) : this.raw).split(".");
    if (frac.length > dp) throw new Error(`FakeDecimal would have to round ${this.raw} to ${dp}dp`);
    return `${neg ? "-" : ""}${int}.${frac.padEnd(dp, "0")}`;
  }
}
const D = (s: string) => new FakeDecimal(s);

/** The body of `toWire(root: Invoice): unknown { … }`, brace-balanced.  Fails
 *  loudly if the method moves or is renamed — better than a gate that quietly
 *  stops reaching the thing it names. */
function extractToWire(file: string): string {
  const head = "toWire(root: Invoice): unknown {";
  const at = file.indexOf(head);
  if (at < 0) throw new Error("toWire(root: Invoice) not found in the emitted repository");
  let depth = 0;
  for (let i = at + head.length - 1; i < file.length; i++) {
    if (file[i] === "{") depth++;
    else if (file[i] === "}" && --depth === 0) return file.slice(at + head.length - 1, i + 1);
  }
  throw new Error("unbalanced toWire body");
}

type ToWire = (root: Record<string, unknown>) => unknown;

describe("node per-row wire encoder — RS-12 (money) / RS-24 (decimal)", () => {
  let toWire: ToWire;
  let responseSchema = "";

  beforeAll(async () => {
    const files = await generateSystemFiles(SOURCE);
    const get = (suffix: string) => {
      const key = [...files.keys()].find((k) => k.endsWith(suffix));
      if (!key) throw new Error(`${suffix} not emitted`);
      return files.get(key) as string;
    };
    const body = extractToWire(get("/db/repositories/invoice-repository.ts"));
    const js = ts.transpileModule(`export function toWire(root: any): unknown ${body}`, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports: { toWire?: ToWire } = {};
    new Function("exports", js)(exports);
    if (!exports.toWire) throw new Error("transpiled toWire did not export");
    toWire = exports.toWire;

    const routes = get("/http/invoice.routes.ts");
    const start = routes.indexOf("export const InvoiceResponse = z.object({");
    responseSchema = routes.slice(start, routes.indexOf("})", start));
  });

  /** What the client actually receives: the encoder's output through JSON. */
  const onTheWire = (root: Record<string, unknown>) => JSON.parse(JSON.stringify(toWire(root)));

  const base = {
    id: "inv-1",
    amount: D("12.5"),
    taxRate: 0.0825,
    note: "n",
    fees: [D("2"), D("0.1")],
    rates: [0.1, 2],
    version: 1,
  };

  it("money is a 4-place string and decimal a number — required, optional and collection", () => {
    expect(onTheWire({ ...base, discount: D("1.25"), surcharge: 0.5 })).toEqual({
      id: "inv-1",
      amount: "12.5000", // RS-12: scale pinned, never "12.5"
      taxRate: 0.0825, // RS-24: a number, never "0.0825"
      note: "n",
      discount: "1.2500",
      surcharge: 0.5,
      fees: ["2.0000", "0.1000"], // "2" is exactly what String(decimal) would send
      rates: [0.1, 2],
      version: 1,
    });
  });

  it('an absent optional stays null — not the string "null", not 0', () => {
    const wire = onTheWire({ ...base, discount: null, surcharge: null });
    expect(wire.discount).toBeNull();
    expect(wire.surcharge).toBeNull();
  });

  it("a negative and a zero keep their scale", () => {
    const wire = onTheWire({ ...base, amount: D("-3"), fees: [D("0")] });
    expect(wire.amount).toBe("-3.0000");
    expect(wire.fees).toEqual(["0.0000"]);
  });

  it("the declared response schema states the same split the encoder produces", () => {
    // The contract half: a change that moved BOTH the encoder and the schema to
    // a string decimal would still pass the value tests above — RS-24 says it
    // must not.
    expect(responseSchema).toContain("amount: z.string(),");
    expect(responseSchema).toContain("taxRate: z.number(),");
    expect(responseSchema).toContain("discount: z.string().nullish(),");
    expect(responseSchema).toContain("surcharge: z.number().nullish(),");
    expect(responseSchema).toContain("fees: z.array(z.string()),");
    expect(responseSchema).toContain("rates: z.array(z.number()),");
  });
});
