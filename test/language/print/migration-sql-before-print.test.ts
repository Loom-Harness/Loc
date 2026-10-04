import { describe, expect, it } from "vitest";
import type { Migration, Model, SqlStep } from "../../../src/language/generated/ast.js";
import { printStructural } from "../../../src/language/print/index.js";
import { parseRawResult } from "../../_helpers/index.js";

// B-20: the opt-in `before` modifier on a raw migration step parses, prints,
// and round-trips; a plain `sql "…"` keeps printing without it, and `before`
// stays a soft keyword (a field may still be named `before`).

const SRC = `migration "v2" {
  sql before "UPDATE banking.accounts SET number = number || 'x' WHERE false"
  sql "UPDATE banking.accounts SET holder = holder"
}
`;

describe("migration `sql before` — parse + print round-trip", () => {
  it("parses the modifier onto SqlStep.before", () => {
    const r = parseRawResult(SRC);
    expect(r.parserErrors).toEqual([]);
    const steps = ((r.value as Model).members[0] as Migration).steps as SqlStep[];
    expect(steps.map((s) => s.before)).toEqual([true, false]);
  });

  it("prints `sql before` and re-parses to the same steps", () => {
    const r = parseRawResult(SRC);
    const printed = printStructural((r.value as Model).members[0]!);
    expect(printed).toContain(`sql before "UPDATE banking.accounts`);
    expect(printed).toContain(`sql "UPDATE banking.accounts SET holder`);
    const re = parseRawResult(printed);
    expect(re.parserErrors).toEqual([]);
    const steps = ((re.value as Model).members[0] as Migration).steps as SqlStep[];
    expect(steps.map((s) => [s.before, s.sql])).toEqual([
      [true, "UPDATE banking.accounts SET number = number || 'x' WHERE false"],
      [false, "UPDATE banking.accounts SET holder = holder"],
    ]);
  });

  it("`before` stays usable as a field name", () => {
    const r = parseRawResult(`system S { subdomain D { context C {
      aggregate A { before: datetime }
    } } }`);
    expect(r.parserErrors).toEqual([]);
  });
});
