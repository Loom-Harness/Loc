import { describe, expect, it } from "vitest";
import type { Migration, Model, SqlStep } from "../../../src/language/generated/ast.js";
import { printStructural } from "../../../src/language/print/index.js";
import { parseRawResult } from "../../_helpers/index.js";

// B-20: the opt-in `before` modifier on a raw migration step parses, prints,
// and round-trips; a plain `sql "…"` keeps printing without it, and `before`
// is NOT a keyword at all (a bare ID the validator pins), so `before`
// stays usable in every name position.

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
    expect(steps.map((s) => s.placement)).toEqual(["before", undefined]);
  });

  it("prints `sql before` and re-parses to the same steps", () => {
    const r = parseRawResult(SRC);
    const printed = printStructural((r.value as Model).members[0]!);
    expect(printed).toContain(`sql before "UPDATE banking.accounts`);
    expect(printed).toContain(`sql "UPDATE banking.accounts SET holder`);
    const re = parseRawResult(printed);
    expect(re.parserErrors).toEqual([]);
    const steps = ((re.value as Model).members[0] as Migration).steps as SqlStep[];
    expect(steps.map((s) => [s.placement, s.sql])).toEqual([
      ["before", "UPDATE banking.accounts SET number = number || 'x' WHERE false"],
      [undefined, "UPDATE banking.accounts SET holder = holder"],
    ]);
  });

  it("`before` is not reserved: still usable as a field, workflow and let name", () => {
    const r = parseRawResult(`system S { subdomain D { context C {
      aggregate A { before: datetime }
      workflow before { create(x: int) { let before = x } }
    } } }`);
    expect(r.parserErrors).toEqual([]);
  });
});
