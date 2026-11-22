// Gate for D-ICU-DOMAIN-DROP-WARN (docs/decisions).
// `date.format(pattern)` / `datetime.format(pattern)` take the fixed,
// locale-independent pattern subset (`src/util/format-pattern.ts`) as a string
// LITERAL, checked when the model compiles (ruling 178 on #5438) — one
// `loom.intrinsic-format-pattern` code, one slug per fix.

import { describe, expect, it } from "vitest";
import { parseFormatPattern } from "../../../src/util/format-pattern.js";
import { parseString } from "../../_helpers/parse.js";

const CODE = "loom.intrinsic-format-pattern";
const wrap = (body: string): string => `
  context C {
    aggregate Order {
      placed: date
      at: datetime
      pattern: string
      ${body}
    }
    repository Orders for Order { }
  }
`;
const found = async (body: string) =>
  (await parseString(wrap(body))).diagnostics
    .filter((d) => d.code === CODE)
    .map((d) => String(d.message));

describe("loom.intrinsic-format-pattern", () => {
  it("accepts the token set, quoted literals and a datetime's time fields", async () => {
    expect(
      await found(`
        derived a: string = placed.format("yyyyMMdd")
        derived b: string = placed.format("dd/MM/yyyy")
        derived c: string = placed.format("'Q''s' yyyy")
        derived d: string = at.format("yyyy-MM-dd'T'HH:mm:ss")
      `),
    ).toEqual([]);
  });

  it("refuses a token outside the set, naming it", async () => {
    const [m] = await found(`derived a: string = placed.format("yy-MM-dd")`);
    expect(m).toContain("'yy' is not a pattern token");
  });

  it("refuses an unclosed quote", async () => {
    const [m] = await found(`derived a: string = placed.format("yyyy 'Q")`);
    expect(m).toContain("not closed");
  });

  it("refuses time fields on a date", async () => {
    const [m] = await found(`derived a: string = placed.format("yyyy-MM-dd HH:mm")`);
    expect(m).toContain("a `date` has none");
  });

  it("refuses a pattern that is not a literal", async () => {
    const [m] = await found(`derived a: string = placed.format(pattern)`);
    expect(m).toContain("must be a string literal");
  });
});

describe("parseFormatPattern", () => {
  it("merges literal runs and reads '' as a quote", () => {
    const r = parseFormatPattern("'Q''s' yyyy-MM");
    expect(r).toEqual({
      ok: true,
      tokens: [
        { kind: "literal", text: "Q's " },
        { kind: "field", field: "year", width: 4 },
        { kind: "literal", text: "-" },
        { kind: "field", field: "month", width: 2 },
      ],
    });
  });

  it('refuses `"` and `\\`', () => {
    expect(parseFormatPattern('yyyy"').ok).toBe(false);
    expect(parseFormatPattern("yyyy\\").ok).toBe(false);
  });
});
