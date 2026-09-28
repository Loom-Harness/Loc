// Explicit primitive-conversion vocabulary — `<target>(value)`.
//
// Source-level form: `string(age)` (int → string for concat),
// `money(decimalField)` (typed bridge), `decimal(moneyValue)`
// (lossy projection), etc.  Distinct from the `money("…")` LITERAL
// form: this is for converting a TYPED VALUE, not a source-text
// literal.  Both spellings share ONE grammar rule and one AST node —
// the argument's shape is what separates them, after the parse
// (`src/language/money-literal.ts`).
//
// The validator admits only infallible (source, target) pairs:
//   string  ← {int, long, decimal, money, bool, guid, datetime}
//   long    ← int
//   decimal ← {int, long, money}
//   money   ← {int, long, decimal}
// Fallible parses (string → numeric / datetime / bool) and
// narrowing (long → int, decimal → long) are deferred pending a
// `T?`-vs-throw failure-model decision.
//
// `guid` and `datetime` were refused while the diagnostic that refused them
// announced "string ← any primitive" — it stated the rule and broke it in the
// same breath, and the sibling `loom.interp-hole-type` advice ("convert it
// first") named a conversion that did not exist.  Both have ONE canonical text
// form (UUID text, ISO-8601) so the conversion is infallible, and three of the
// five backends already carried the `from === "datetime"` arm behind the gate.
// `json` and `File` stay refused — no canonical scalar form, which is the real
// reason the "any primitive" wording was wrong.  The MATRIX below is the thing
// that keeps the message and the behaviour from drifting apart again.

import { describe, expect, it } from "vitest";
import { allAggregates } from "../../../src/ir/types/loom-ir.js";
import { buildLoomModel } from "../../_helpers/index.js";
import { parseString } from "../../_helpers/parse.js";

describe("conversion vocabulary — admitted pairs validate", () => {
  it("`string(age)` (int → string) — covers string-concat after the strict validator", async () => {
    const { errors } = await parseString(`
      context X {
        aggregate User {
          name: string
          age: int
          derived label: string = "Hello " + string(age)
        }
        repository Users for User { }
      }
    `);
    expect(errors).toEqual([]);
  });

  it("`string(price)` (money → string) uses the precise to-string", async () => {
    const { errors } = await parseString(`
      context X {
        aggregate Invoice {
          price: money
          derived label: string = "price: " + string(price)
        }
        repository Invoices for Invoice { }
      }
    `);
    expect(errors).toEqual([]);
  });

  it("`money(taxRate)` (decimal → money) — typed value bridge", async () => {
    const { errors } = await parseString(`
      context X {
        aggregate Invoice {
          taxRate: decimal
          derived asAmount: money = money(taxRate)
        }
        repository Invoices for Invoice { }
      }
    `);
    expect(errors).toEqual([]);
  });

  it("`decimal(subtotal)` (money → decimal) — explicit lossy projection", async () => {
    const { errors } = await parseString(`
      context X {
        aggregate Invoice {
          subtotal: money
          derived rough: decimal = decimal(subtotal)
        }
        repository Invoices for Invoice { }
      }
    `);
    expect(errors).toEqual([]);
  });

  it("`long(count)` (int → long) — explicit widening", async () => {
    const { errors } = await parseString(`
      context X {
        aggregate Foo {
          count: int
          derived big: long = long(count)
        }
        repository Foos for Foo { }
      }
    `);
    expect(errors).toEqual([]);
  });

  it("`string(flag)` (bool → string)", async () => {
    const { errors } = await parseString(`
      context X {
        aggregate Foo {
          flag: bool
          derived label: string = string(flag)
        }
        repository Foos for Foo { }
      }
    `);
    expect(errors).toEqual([]);
  });
});

describe("conversion vocabulary — non-admitted pairs error", () => {
  it("`int(price)` (money → int — narrowing) errors", async () => {
    const { errors } = await parseString(`
      context X {
        aggregate Foo {
          price: money
          derived oops: int = int(price)
        }
        repository Foos for Foo { }
      }
    `);
    // `int(...)` isn't an admitted grammar form yet — the parser
    // can't recognise `int` as a PrimitiveConversion target so the
    // call parses as something else and the surrounding context
    // surfaces a type / parse error.
    expect(errors.join("\n")).not.toBe("");
  });

  it("`int(someString)` (fallible parse) errors", async () => {
    const { errors } = await parseString(`
      context X {
        aggregate Foo {
          name: string
          derived oops: int = int(name)
        }
        repository Foos for Foo { }
      }
    `);
    expect(errors.join("\n")).not.toBe("");
  });

  it("`decimal(someString)` (fallible parse) errors with a specific message", async () => {
    // `decimal` IS an admitted PrimitiveConversion target; the
    // string-source rejection comes from `checkPrimitiveConversions`
    // and names the supported source set.
    const { errors } = await parseString(`
      context X {
        aggregate Foo {
          name: string
          derived oops: decimal = decimal(name)
        }
        repository Foos for Foo { }
      }
    `);
    expect(errors.join("\n")).toMatch(/Cannot convert 'string' to 'decimal'/);
    expect(errors.join("\n")).toMatch(/Fallible parses/);
  });

  it("`long(price)` (money → long — narrowing) errors", async () => {
    const { errors } = await parseString(`
      context X {
        aggregate Foo {
          price: money
          derived oops: long = long(price)
        }
        repository Foos for Foo { }
      }
    `);
    expect(errors.join("\n")).toMatch(/Cannot convert 'money' to 'long'/);
  });
});

describe("conversion vocabulary — IR carries (from, target)", () => {
  it("`string(age)` lowers as { kind: 'convert', target: 'string', from: 'int' }", async () => {
    const loom = await buildLoomModel(`
      context X {
        aggregate User {
          age: int
          derived label: string = string(age)
        }
        repository Users for User { }
      }
    `);
    const u = allAggregates(loom).find((a) => a.name === "User")!;
    const label = u.derived.find((d) => d.name === "label")!;
    expect(label.expr.kind).toBe("convert");
    const conv = label.expr as Extract<typeof label.expr, { kind: "convert" }>;
    expect(conv.target).toBe("string");
    expect(conv.from).toBe("int");
  });

  it("`money(taxRate)` lowers as { kind: 'convert', target: 'money', from: 'decimal' }", async () => {
    const loom = await buildLoomModel(`
      context X {
        aggregate Foo {
          taxRate: decimal
          derived asMoney: money = money(taxRate)
        }
        repository Foos for Foo { }
      }
    `);
    const foo = allAggregates(loom).find((a) => a.name === "Foo")!;
    const asMoney = foo.derived.find((d) => d.name === "asMoney")!;
    const conv = asMoney.expr as Extract<typeof asMoney.expr, { kind: "convert" }>;
    expect(conv.target).toBe("money");
    expect(conv.from).toBe("decimal");
  });
});

describe('conversion vocabulary — disambiguation from `money("…")` literal', () => {
  // `money("10.50")` is the compile-time LITERAL; `money(decimalField)` is the
  // conversion.  There used to be two grammar rules and a documented
  // alternative ORDER settling which won — an ambiguity Chevrotain reported to
  // stderr on every parse that reached it (M-T9.60).  One rule now, split on
  // the argument's shape after the parse; the IR is unchanged, which is what
  // these two cases assert.

  it("`money(\"10.50\")` stays the literal (lowers to lit('money', '10.50'))", async () => {
    const loom = await buildLoomModel(`
      context X {
        aggregate Foo {
          derived total: money = money("10.50")
        }
        repository Foos for Foo { }
      }
    `);
    const foo = allAggregates(loom).find((a) => a.name === "Foo")!;
    const total = foo.derived.find((d) => d.name === "total")!;
    // `toMatchObject` — this literal lowers through the `lowerExpr` wrapper
    // (src/ir/lower/lower-expr.ts), which stamps a real M14 `origin`.
    expect(total.expr).toMatchObject({ kind: "literal", lit: "money", value: "10.50" });
  });

  it("`money(decimalField)` lowers to a conversion, not a literal", async () => {
    const loom = await buildLoomModel(`
      context X {
        aggregate Foo {
          rate: decimal
          derived asMoney: money = money(rate)
        }
        repository Foos for Foo { }
      }
    `);
    const foo = allAggregates(loom).find((a) => a.name === "Foo")!;
    const asMoney = foo.derived.find((d) => d.name === "asMoney")!;
    expect(asMoney.expr.kind).toBe("convert");
  });
});

describe("conversion vocabulary — the string() matrix the diagnostic advertises", () => {
  // One probe per primitive, asserted against the set the `loom.*` message
  // names.  This pair (behaviour + wording) is the regression: the message
  // said "any primitive" while four of nine were refused, so a reader who
  // trusted it wrote code the compiler rejected.  Add a primitive to the
  // language and this table forces the question "is it stringifiable?" to be
  // answered deliberately rather than by fallthrough.
  const STRINGIFIABLE: Record<string, boolean> = {
    int: true,
    long: true,
    decimal: true,
    money: true,
    bool: true,
    guid: true,
    datetime: true,
    // No canonical scalar form — an arbitrary JSON document / an upload handle.
    json: false,
    File: false,
  };

  for (const [prim, admitted] of Object.entries(STRINGIFIABLE)) {
    it(`string(${prim}) is ${admitted ? "admitted" : "refused"}`, async () => {
      const { errors } = await parseString(`
        context X {
          aggregate Probe {
            v: ${prim}
            code: string
            derived asText: string = string(v)
            derived display: string = code
          }
          repository Probes for Probe { }
        }
      `);
      if (admitted) {
        expect(errors).toEqual([]);
      } else {
        expect(errors.join("\n")).toContain(`Cannot convert '${prim}' to 'string'`);
      }
    });
  }

  it("the refusal message names exactly the admitted set, not 'any primitive'", async () => {
    const { errors } = await parseString(`
      context X {
        aggregate Probe {
          v: json
          code: string
          derived asText: string = string(v)
          derived display: string = code
        }
        repository Probes for Probe { }
      }
    `);
    const msg = errors.join("\n");
    // The wording that was false.  A reader following it wrote `string(guid)`
    // (once refused) or `string(json)` (still refused) on the same authority.
    expect(msg).not.toContain("any primitive");
    for (const prim of Object.keys(STRINGIFIABLE).filter((p) => STRINGIFIABLE[p])) {
      expect(msg, `admitted primitive '${prim}' missing from the message`).toContain(prim);
    }
  });
});
