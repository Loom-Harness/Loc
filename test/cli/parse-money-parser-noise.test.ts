// `ddd parse` must not print parser-generator internals at the user.
//
// It did, on the repo's OWN shipped examples, for every model containing a
// `money("…")` literal:
//
//     $ node bin/cli.js parse examples/showcase.ddd
//     Ambiguous Alternatives Detected: <7, 8> in <OR1> inside <PrimaryExpr> Rule,
//     <money, (, STRING, ), function> may appears as a prefix path in all these
//     alternatives.
//     See: https://chevrotain.io/docs/guide/resolving_grammar_errors.html#…
//     For Further details.
//     0 error(s), 0 warning(s).
//     OK: examples/showcase.ddd
//
// Four lines of grammar advice, addressed to whoever writes `ddd.langium`,
// printed above a clean result for someone who is writing a `.ddd` file
// (audit #2864 § Papercuts / M-T9.60).
//
// The cause was a real grammar ambiguity, not a noisy dependency: `MoneyLit`
// (`'money' '(' STRING ')'`) and `PrimitiveConversion` (`target=(… | 'money')
// '(' Expression ')'`) both matched `money("10.50")`, because a `STRING` is
// also an `Expression`.  Listing `MoneyLit` first settled which alternative
// WON — the parse result was always right — and settled nothing about the
// ambiguity itself, which no finite lookahead can resolve.  The fix deletes the
// alternation: one grammar path for `money(`, with the literal and the
// conversion told apart after the parse by the argument's shape
// (`src/language/money-literal.ts`).
//
// This suite therefore pins BOTH halves, because either alone is a trap:
//   * silence on stderr — which a blanket `Parser.performSelfAnalysis` mute
//     would also buy, at the price of hiding the next REAL ambiguity;
//   * and the two money forms still lowering to what they always lowered to,
//     which is what makes the silence mean "no ambiguity" rather than
//     "no diagnostics".
//
// The noise is reported LAZILY, once per process, on the first input that
// reaches the alternation — so every check here spawns a fresh CLI process
// against a file that actually contains a money literal.  An in-process parse
// would silently pass once some earlier test had already tripped the report.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { allAggregates } from "../../src/ir/types/loom-ir.js";
import { buildLoomModel } from "../_helpers/index.js";
import { parseString } from "../_helpers/parse.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cli = path.join(repoRoot, "bin", "cli.js");

function parse(file: string): { stdout: string; stderr: string; status: number } {
  const r = spawnSync("node", [cli, "parse", file], { encoding: "utf8" });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? 1 };
}

function write(source: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-money-noise-"));
  const file = path.join(dir, "main.ddd");
  fs.writeFileSync(file, source);
  return file;
}

/** Every fingerprint of Chevrotain's grammar-analysis report.  Matching on all
 *  of them, not just the headline, so a reworded upstream message cannot slip
 *  the gate. */
const PARSER_NOISE = [
  "Ambiguous Alternatives Detected",
  "chevrotain.io",
  "may appears as a prefix path",
  "inside <PrimaryExpr",
  "For Further details",
];

function expectNoParserNoise(stream: string, what: string): void {
  for (const fragment of PARSER_NOISE) {
    expect(stream, `${what} must not carry parser-generator output: ${fragment}`).not.toContain(
      fragment,
    );
  }
}

describe("ddd parse — a money literal prints no parser-generator output", () => {
  // The alignment fixture for the `money` primitive.  Its header has always
  // claimed to exercise "every shape money should appear in" and listed the
  // `money("…")` constructor literal FIRST — and it carried one nowhere
  // outside a comment, which is exactly why the noise went unnoticed for as
  // long as it did.  It carries both forms now, so this is a real witness.
  const FIXTURE = path.join(repoRoot, "examples", "money-primitive.ddd");

  it("examples/money-primitive.ddd parses clean, with an empty-of-noise stderr", () => {
    // Guard the witness: if the fixture ever stops containing a money literal,
    // this suite would pass by never reaching the alternation at all.
    expect(fs.readFileSync(FIXTURE, "utf8")).toMatch(/money\("[\d.]+"\)/);

    const { stdout, stderr, status } = parse(FIXTURE);
    expect(status).toBe(0);
    expect(stdout).toContain("OK:");
    expectNoParserNoise(stderr, "ddd parse stderr");
    expectNoParserNoise(stdout, "ddd parse stdout");
  });

  it("examples/showcase.ddd — the shipped example the audit reproduced on", () => {
    const showcase = path.join(repoRoot, "examples", "showcase.ddd");
    expect(fs.readFileSync(showcase, "utf8")).toContain('money("');
    const { stdout, stderr } = parse(showcase);
    // This one is not diagnostic-free (it carries real warnings) — the point
    // is that none of them come from the parser generator.
    expectNoParserNoise(stderr, "showcase stderr");
    expectNoParserNoise(stdout, "showcase stdout");
  });

  it("both money forms in one file leave stderr free of grammar advice", () => {
    const file = write(`
      context X {
        aggregate Invoice {
          subtotal: money
          rate: decimal
          derived floor: money = money("0.00")
          derived scaled: money = money(rate)
          operation bump() { subtotal := subtotal + money("1.25") }
        }
        repository Invoices for Invoice { }
      }
    `);
    const { stderr, status } = parse(file);
    expect(status).toBe(0);
    expectNoParserNoise(stderr, "mixed-form stderr");
  });
});

describe("ddd parse — both `money(` forms still parse and lower", () => {
  // The silence above is only worth having if the parse it silences is the
  // same parse as before.  One grammar rule serves both spellings now, so
  // these are the assertions that say which one you get.

  it('`money("10.50")` lowers to the compile-time literal `lit("money", "10.50")`', async () => {
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
    expect(total.expr).toMatchObject({ kind: "literal", lit: "money", value: "10.50" });
  });

  it("`money(someDecimal)` lowers to a decimal→money conversion", async () => {
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
    expect(asMoney.expr).toMatchObject({ kind: "convert", target: "money", from: "decimal" });
  });

  it("a money literal in statement position lowers to the literal too", async () => {
    const loom = await buildLoomModel(`
      context X {
        aggregate Foo {
          subtotal: money
          operation bump() { subtotal := subtotal + money("1.25") }
        }
        repository Foos for Foo { }
      }
    `);
    const foo = allAggregates(loom).find((a) => a.name === "Foo")!;
    const bump = foo.operations.find((o) => o.name === "bump")!;
    const assign = bump.statements[0] as Extract<
      (typeof bump.statements)[number],
      { kind: "assign" }
    >;
    const sum = assign.value as Extract<typeof assign.value, { kind: "binary" }>;
    expect(sum.right).toMatchObject({ kind: "literal", lit: "money", value: "1.25" });
  });

  it("`money` still works as an ordinary field name (it is a soft keyword)", async () => {
    // Every position `money` can occupy, in one file: the field NAME, the
    // primitive TYPE, a bare NameRef READ of the field, the literal, the
    // conversion, and an assignment target.  `money(` is the only spelling the
    // grammar claims; nothing else about the word changed.
    const { errors } = await parseString(`
      context X {
        aggregate Foo {
          money: string
          amount: money
          rate: decimal
          derived label: string = "m=" + money
          derived floor: money = money("0.00")
          derived conv: money = money(rate)
          operation setIt(m: string) { money := m }
        }
        repository Foos for Foo { }
      }
    `);
    expect(errors).toEqual([]);
  });

  // The one behaviour the fold ADDS.  `money("ten bucks")` used to reach the
  // IR as `lit("money", "ten bucks")` and become a throw inside five backends'
  // precise-decimal constructors; the literal is checked at the source now.
  it("rejects a money literal whose string is not a decimal", async () => {
    const { errors } = await parseString(`
      context X {
        aggregate Foo {
          derived floor: money = money("ten bucks")
        }
        repository Foos for Foo { }
      }
    `);
    expect(errors.some((e) => e.includes("is not a decimal amount"))).toBe(true);
  });

  it("still admits the decimal spellings a money literal may take", async () => {
    const { errors } = await parseString(`
      context X {
        aggregate Foo {
          derived a: money = money("0")
          derived b: money = money("-3.25")
          derived c: money = money("+10.5000")
          derived d: money = money(".5")
        }
        repository Foos for Foo { }
      }
    `);
    expect(errors).toEqual([]);
  });
});
