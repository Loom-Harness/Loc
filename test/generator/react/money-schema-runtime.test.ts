// Behavioural test for the emitted `moneySchema` — the money primitive's
// zod schema accepts BOTH of its real inbound shapes:
//
//   - wire JSON: a decimal-formatted string, parsed to a Decimal;
//   - form state: an already-constructed Decimal instance, passed
//     through unchanged.  The money input control converts on change
//     (`field.onChange(new Decimal(...))`), so the zodResolver sees the
//     instance — under the previous `z.string()`-only schema every
//     money-primitive form failed validation on submit with
//     "Expected string, received object".
//
// The template string is transpiled and EXECUTED here (same harness as
// frontend-acl-emit.test.ts) so the fix is pinned by semantics, not text.

import ts from "typescript";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { REACT_LIB_SCHEMAS_MONEY_TS } from "../../../src/generator/react/emit-templates.js";
import { SVELTE_LIB_SCHEMAS_MONEY } from "../../../src/generator/svelte/emit-templates.js";

/** Stand-in for decimal.js (not a dependency of the toolchain repo).  It
 *  reproduces the two behaviours the schema depends on: `toString` NORMALISES
 *  trailing zeros away (decimal.js prints `new Decimal("98.7600")` as
 *  "98.76"), and `toFixed(n)` pads to exactly n fraction digits. */
class FakeDecimal {
  readonly value: string;
  constructor(s: string) {
    if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`bad decimal ${s}`);
    this.value = s;
  }
  toString(): string {
    return this.value.includes(".") ? this.value.replace(/\.?0+$/, "") : this.value;
  }
  toJSON(): string {
    return this.toString();
  }
  toFixed(n: number): string {
    // Like decimal.js, formats from the digits, never through `toString`.
    const [int, frac = ""] = this.value.split(".");
    return n === 0 ? int! : `${int}.${frac.padEnd(n, "0").slice(0, n)}`;
  }
}

type MoneySchema = z.ZodType<FakeDecimal, unknown>;

/** Strip the template's imports, transpile, and evaluate with the repo's
 *  zod + the Decimal stand-in injected. */
function loadMoneySchema(src: string): MoneySchema {
  const trimmed = src
    .replace(/import Decimal from "decimal\.js";\s*\n/, "")
    .replace(/import \{ z \} from "zod";\s*\n/, "");
  const js = ts.transpileModule(trimmed, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const factory = new Function(
    "exports",
    "module",
    "z",
    "Decimal",
    `${js}\nreturn exports.moneySchema;`,
  );
  const mod = { exports: {} as Record<string, unknown> };
  return factory(mod.exports, mod, z, FakeDecimal) as MoneySchema;
}

for (const [label, template] of [
  ["react", REACT_LIB_SCHEMAS_MONEY_TS],
  ["svelte", SVELTE_LIB_SCHEMAS_MONEY],
] as const) {
  describe(`moneySchema runtime — ${label} template`, () => {
    const schema = loadMoneySchema(template);

    it("parses a wire decimal string to a Decimal", () => {
      const out = schema.parse("123.4500");
      expect(out).toBeInstanceOf(FakeDecimal);
      expect((out as FakeDecimal).value).toBe("123.4500");
    });

    it("passes an existing Decimal instance through unchanged (form-state shape)", () => {
      const d = new FakeDecimal("42.10");
      expect(schema.parse(d)).toBe(d);
    });

    it("rejects a malformed string with a typed issue, not a throw", () => {
      const r = schema.safeParse("not-a-number");
      expect(r.success).toBe(false);
    });

    // decimal.js drops trailing zeros; the wire's fixed scale (RS-12) keeps
    // them, and the verbatim money display prints whatever the value
    // stringifies to — so the parsed value must stringify to the WIRE digits.
    it("a parsed wire value renders the wire's own digits (scale kept)", () => {
      const out = schema.parse("98.7600");
      expect(String(out)).toBe("98.7600");
      expect(JSON.stringify({ v: out })).toBe('{"v":"98.7600"}');
      expect(String(schema.parse("12"))).toBe("12");
      expect(String(schema.parse("-0.5000"))).toBe("-0.5000");
    });

    it("a form-built Decimal keeps decimal.js's own rendering", () => {
      expect(String(schema.parse(new FakeDecimal("42.10")))).toBe("42.1");
    });

    it("rejects non-string non-Decimal input", () => {
      expect(schema.safeParse(42).success).toBe(false);
      expect(schema.safeParse(null).success).toBe(false);
    });
  });
}
