import { describe, expect, it } from "vitest";
import type { Migration, Model } from "../../../src/language/generated/ast.js";
import { printStructural } from "../../../src/language/print/index.js";
import { parseRawResult } from "../../_helpers/index.js";

// The table step's two forms — `Old -> New` and the qualified move
// `A.Old -> B.New` — print back to themselves, beside a column rename the
// move form shares its `ID '.' ID '->'` prefix with.

const SRC = `migration "evolve" {
  Tracker -> Watcher
  Leases.LeaseLedger -> Ledgers.Ledger
  Order.qty -> quantity
}
`;

describe("migration table step — parse + print round-trip", () => {
  it("prints both forms and re-parses to the same steps", () => {
    const r = parseRawResult(SRC);
    expect(r.parserErrors).toEqual([]);
    const printed = printStructural((r.value as Model).members[0]!);
    expect(printed).toContain("Tracker -> Watcher");
    expect(printed).toContain("Leases.LeaseLedger -> Ledgers.Ledger");
    expect(printed).toContain("Order.qty -> quantity");
    const re = parseRawResult(printed);
    expect(re.parserErrors).toEqual([]);
    const steps = ((re.value as Model).members[0] as Migration).steps;
    expect(
      steps.map((s) =>
        s.$type === "TableRename"
          ? [s.fromContext, s.fromTable, s.toContext, s.to]
          : s.$type === "ColumnStep"
            ? ["column", s.field, s.renamedTo]
            : ["sql"],
      ),
    ).toEqual([
      [undefined, "Tracker", undefined, "Watcher"],
      ["Leases", "LeaseLedger", "Ledgers", "Ledger"],
      ["column", "qty", "quantity"],
    ]);
  });
});
