// The type of a query-time projection's AGGREGATE select — M-T5.24 /
// `D-LONG-AVG-DEFAULTS` (`docs/decisions.md`).
//
// Two halves of one rule, and the second is what makes the first load-bearing:
//
//   1. `avg` over a MONEY column is typed `money`, not `decimal`.  The mean of
//      exact money is money; typed `decimal` it crossed the wire as a float64
//      JSON number (RS-24) while the IN-MEMORY `avg` of the same field types
//      `money?` and ships the RS-12 fixed-scale string — one word, two
//      semantics.
//   2. The DECLARED row field must carry the aggregation's own result type.
//      Measured on `main` @ `09427a5` before this change: the declaration was
//      unchecked, and it is what every backend's coercion dispatches on
//      (`aggregateCoercion` reads the declared row, deliberately — see
//      `AggregateSelect.type`).  So `revenue: decimal = sum(o.total)` validated
//      clean and shipped `Number(row?.revenue ?? 0)`: money summed exactly in
//      SQL, then narrowed to a float on the way out.  Without this gate the
//      retype above is INERT — an author could keep declaring `decimal` and
//      keep the lossy float.
//
// The lowering arm and the gate arm are asserted separately, because they fail
// independently: a retype with no gate is unenforced, a gate with no retype
// refuses the correct declaration.

import { describe, expect, it } from "vitest";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/index.js";
import { toLoomModel } from "../_helpers/ir.js";

const SYSTEM = (projection: string) => `system AggTypes {
  subdomain Sales { context Orders {
    aggregate Order with crudish {
      code:      string
      total:     money
      lineCount: int
      sold:      long
      weight:    decimal
    }
    repository Orders for Order { }
${projection}
  } }
  api SalesApi from Sales
  storage pg { type: postgres }
  resource oState { for: Orders, kind: state, use: pg }
  deployable api { platform: node contexts: [Orders] dataSources: [oState] serves: SalesApi port: 8080 }
}`;

/** Phase ⑦ diagnostics for one projection body. */
async function diagnose(projection: string): Promise<string[]> {
  const { model: ast } = await parseString(SYSTEM(projection));
  return validateLoomModel(toLoomModel(ast))
    .filter((d) => d.severity === "error")
    .map((d) => `${d.code}: ${d.message}`);
}

/** The lowered result type of the named aggregate `select`. */
async function selectType(projection: string, field: string): Promise<string> {
  const { model: ast } = await parseString(SYSTEM(projection));
  const model = lowerModel(ast);
  const proj = model.systems[0].subdomains[0].contexts[0].projections.find(
    (p) => p.name === "Stats",
  );
  const sel = proj?.query?.selects?.find((s) => s.field === field);
  if (!sel) throw new Error(`no select '${field}' — the fixture did not lower as expected`);
  const t = sel.type.kind === "optional" ? sel.type.inner : sel.type;
  return t.kind === "primitive" ? t.name : t.kind;
}

const PROJ = (fields: string, selects: string) => `    projection Stats {
${fields}
      from Order as o
      select ${selects}
    }`;

describe("a query-time projection's aggregate select carries the aggregation's own type", () => {
  it("types `avg` over a money column as money, and over other numerics as decimal", async () => {
    const src = PROJ(
      "      avgTotal: money\n      avgLines: decimal\n      avgWeight: decimal",
      "avgTotal = avg(o.total), avgLines = avg(o.lineCount), avgWeight = avg(o.weight)",
    );
    // The retype — money in, money out.  Before M-T5.24 this read "decimal".
    expect(await selectType(src, "avgTotal")).toBe("money");
    // A mean over an integral / decimal column IS a decimal mean; the retype
    // must not swallow the general rule.
    expect(await selectType(src, "avgLines")).toBe("decimal");
    expect(await selectType(src, "avgWeight")).toBe("decimal");
    expect(await diagnose(src)).toEqual([]);
  });

  it("accepts every declaration that matches its aggregation", async () => {
    expect(
      await diagnose(
        PROJ(
          "      rows: int\n      revenue: money\n      biggest: money\n      soldSum: long\n      avgTotal: money",
          "rows = count(), revenue = sum(o.total), biggest = max(o.total), " +
            "soldSum = sum(o.sold), avgTotal = avg(o.total)",
        ),
      ),
    ).toEqual([]);
  });

  it("refuses a money aggregate declared `decimal` — the exact-money-as-float defect", async () => {
    const diags = await diagnose(PROJ("      revenue: decimal", "revenue = sum(o.total)"));
    expect(diags).toHaveLength(1);
    expect(diags[0]).toContain("loom.projection-aggregate-type-mismatch");
    expect(diags[0]).toContain("declared 'decimal' but 'sum(…)' produces 'money'");
    // The hint has to name the wire consequence, or the author "fixes" it by
    // widening the declaration again.
    expect(diags[0]).toContain("fixed-scale string");
  });

  it("refuses `avg` over money declared `decimal` — what the retype makes visible", async () => {
    const diags = await diagnose(PROJ("      avgTotal: decimal", "avgTotal = avg(o.total)"));
    expect(diags).toHaveLength(1);
    expect(diags[0]).toContain("declared 'decimal' but 'avg(…)' produces 'money'");
  });

  it("refuses a money aggregate declared `string` — a response contradicting its own schema", async () => {
    // Measured before the gate: the row mapper emitted `Number(...)` into a
    // field the published zod/OpenAPI schema declares `z.string()`, hidden by
    // the mapper's `as z.infer<…>` cast.
    const diags = await diagnose(PROJ("      biggest: string", "biggest = max(o.total)"));
    expect(diags).toHaveLength(1);
    expect(diags[0]).toContain("declared 'string' but 'max(…)' produces 'money'");
  });

  it("refuses an integral aggregate declared `money` — a row count dressed as a price", async () => {
    const diags = await diagnose(PROJ("      lines: money", "lines = sum(o.lineCount)"));
    expect(diags).toHaveLength(1);
    expect(diags[0]).toContain("declared 'money' but 'sum(…)' produces 'int'");
    // …and it points at the ONE widening that is admitted, which is also how an
    // author opts out of the integral range refusal (M-T5.23).
    expect(diags[0]).toContain("declare it 'long'");
  });

  it("admits int → long, the one lossless widening (SQL's own sum/count is a bigint)", async () => {
    expect(
      await diagnose(
        PROJ("      rows: long\n      lines: long", "rows = count(), lines = sum(o.lineCount)"),
      ),
    ).toEqual([]);
    // Not the reverse: a `long` column's sum declared `int` would be the
    // narrowing this packet refuses at runtime.
    const back = await diagnose(PROJ("      soldSum: int", "soldSum = sum(o.sold)"));
    expect(back).toHaveLength(1);
    expect(back[0]).toContain("declared 'int' but 'sum(…)' produces 'long'");
  });

  it("says nothing about OPTIONALITY, on either side", async () => {
    // A declared `money?` is the author choosing "SQL NULL over an empty table
    // stays null" (`AggregateCoercion.optional`) — their call.  And the RESULT
    // inherits the aggregated COLUMN's nullability, which says nothing about
    // the row field: `max` over an optional column is `decimal?`, and
    // declaring it `decimal` (zero-defaulted) is what the four backends'
    // non-optional arm already emits.
    expect(await diagnose(PROJ("      revenue: money?", "revenue = sum(o.total)"))).toEqual([]);
    const { model: ast } = await parseString(
      SYSTEM(`    projection Stats {
      maxRate: decimal
      from Order as o
      select maxRate = max(o.rate)
    }`).replace("weight:    decimal", "weight:    decimal\n      rate:      decimal?"),
    );
    expect(
      validateLoomModel(toLoomModel(ast))
        .filter((d) => d.severity === "error")
        .map((d) => d.code),
    ).toEqual([]);
  });
});
