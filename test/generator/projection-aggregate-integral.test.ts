// An INTEGRAL projection aggregate on all five backends — M-T5.23 /
// `D-LONG-AVG-DEFAULTS`.
//
// `sum(int)` and `count(*)` are BIGINTS in SQL, and a `long` column is a bigint,
// so an integral aggregate's SQL result routinely exceeds the range of the type
// the projection row declares.  Measured on `main` @ `09427a5`, the five
// backends did five different things with that:
//
//   java     ((Number) x).intValue()   WRAPPED — a wrong ANSWER, silently
//   node     Number(x)                 rounded a `long` past 2^53, silently
//   python   float(x)                  lost digits past 2^53, then pydantic's
//                                      lax mode re-narrowed the integral float
//   elixir   x || 0                    shipped a value outside `format: int32`
//   dotnet   (int) on an int-typed sum  already failed the read
//
// The ruling unified them on refusal: a value that does not fit is an ERROR.
// This is the per-PR structural companion to the runtime legs — no docker, no
// boot, no SDK — so a regression in any one backend's coercion fails in the fast
// suite rather than waiting for that backend's behavioural leg.
//
// The bound itself comes from `src/util/numeric-range.ts`, and the assertions
// read it from there rather than re-typing the digits: a test that hardcodes the
// number it is checking cannot notice the seam and the emitter disagreeing.

import { describe, expect, it } from "vitest";
import {
  INT32_MAX,
  INT32_MIN,
  LONG_SAFE_MAX,
  LONG_SAFE_MIN,
} from "../../src/util/numeric-range.js";
import { generateSystemFiles } from "../_helpers/generate.js";

const SYSTEM = (platform: string) => `system IntAgg {
  subdomain Sales { context Orders {
    aggregate Order { code: string  qty: int  sold: long  weight: decimal }
    repository Orders for Order { }

    // Every integral shape in one projection: a row count, a sum over an
    // \`int\` column, a sum over a \`long\` column, and a \`decimal\` mean beside
    // them (the arm that must NOT be range-checked).
    projection Totals {
      rows: int
      qtySum: int
      soldSum: long
      avgQty: decimal
      from Order as o
      select rows = count(), qtySum = sum(o.qty), soldSum = sum(o.sold), avgQty = avg(o.qty)
    }
  } }
  api SalesApi from Sales
  storage pg { type: postgres }
  resource oState { for: Orders, kind: state, use: pg }
  deployable api { platform: ${platform} contexts: [Orders] dataSources: [oState] serves: SalesApi port: 8080 }
}`;

async function build(platform: string): Promise<Map<string, string>> {
  // Through the gated wrapper, which asserts phases ①/④/⑦ — so an assertion
  // below can never read output from a model `ddd generate` would refuse.
  return generateSystemFiles(SYSTEM(platform));
}

function file(files: Map<string, string>, suffix: string): string {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  if (!key) throw new Error(`no generated file ending in ${suffix}`);
  return files.get(key)!;
}

describe("an integral aggregate is range-checked, not silently narrowed (all five backends)", () => {
  it("node checks every integral read against its declared range, and emits the helper", async () => {
    const src = file(await build("node"), "http/query-projections.ts");
    // The pre-fix shape: a bare `Number(...)`, which rounds a bigint past 2^53
    // without a word.
    expect(src).not.toContain("rows: Number(row?.rows ?? 0)");
    expect(src).not.toContain("soldSum: Number(row?.soldSum ?? 0)");
    expect(src).toContain(`rows: __intWire(row?.rows ?? 0, ${INT32_MIN}, ${INT32_MAX}, "rows")`);
    expect(src).toContain(
      `qtySum: __intWire(row?.qtySum ?? 0, ${INT32_MIN}, ${INT32_MAX}, "qtySum")`,
    );
    // The `long` field takes the safe-integer ceiling, not the int32 one — the
    // two bounds must not collapse into one.
    expect(src).toContain(
      `soldSum: __intWire(row?.soldSum ?? 0, ${LONG_SAFE_MIN}, ${LONG_SAFE_MAX}, "soldSum")`,
    );
    // Emitting the call without the definition is a TS2304.
    expect(src).toContain("function __intWire(value: unknown, min: number, max: number");
    // The decimal mean is NOT range-checked — the money/decimal arms are a
    // different contract (RS-24), and swallowing them here would ship an
    // integer where the row declares a float.
    expect(src).toContain("avgQty: Number(row?.avgQty ?? 0)");
  });

  it("python reads integral aggregates through int(), never float()", async () => {
    const src = file(await build("python"), "query_projections_routes.py");
    expect(src).toContain('"rows": int(row[0] or 0)');
    expect(src).toContain('"qtySum": int(row[1] or 0)');
    // The `long` sum is the one that CORRUPTED: `float()` of a bigint past 2^53
    // loses digits, and pydantic's lax mode then accepts the integral float.
    expect(src).toContain('"soldSum": int(row[2] or 0)');
    expect(src).not.toContain('"soldSum": float(');
    // …and the decimal mean still goes through float(), by design.
    expect(src).toContain('"avgQty": float(row[3] or 0)');
  });

  it("java narrows exactly with Math.toIntExact, never intValue()", async () => {
    const src = file(await build("java"), "OrdersQueryProjections.java");
    // `intValue()` on a boxed Long discards the high bits — the one shape that
    // produced a wrong ANSWER instead of a refusal.
    expect(src).not.toMatch(/\(\(Number\) r\[\d\]\)\.intValue\(\)/);
    expect(src).toContain("Math.toIntExact(((Number) r[0]).longValue())");
    expect(src).toContain("Math.toIntExact(((Number) r[1]).longValue())");
    // A declared `long` needs no guard — java carries int64 exactly.
    expect(src).toContain("((Number) r[2]).longValue()");
    expect(src).not.toContain("Math.toIntExact(((Number) r[2]).longValue())");
  });

  it("elixir raises out of range, and the guard travels with the calls", async () => {
    const src = file(await build("elixir"), "query_projections/totals.ex");
    expect(src).toContain(`__int_wire(row.rows || 0, ${INT32_MIN}, ${INT32_MAX}, "rows")`);
    expect(src).toContain(
      `__int_wire(row.soldSum || 0, ${LONG_SAFE_MIN}, ${LONG_SAFE_MAX}, "soldSum")`,
    );
    expect(src).not.toContain("rows: row.rows || 0,");
    // A call to an undefined private fn fails `mix compile --warnings-as-errors`
    // — and so does an UNUSED one, which is why keys are not routed through it.
    expect(src).toContain("defp __int_wire(value, min, max, _field)");
    expect(src).toContain("raise \"projection field '#{field}'");
  });

  it("dotnet types the row field as the declared integral type", async () => {
    // .NET is the backend the ruling unified ON: the row record's component is
    // the declared CLR integral type, so a value that does not fit cannot be
    // carried — it fails at the cast or in the database rather than wrapping.
    const files = await build("dotnet");
    expect(file(files, "TotalsRow.cs")).toMatch(/int Rows/);
    expect(file(files, "TotalsRow.cs")).toMatch(/long SoldSum/);
    const handler = file(files, "TotalsQpHandler.cs");
    expect(handler).toContain("(int)(agg?.QtySum ?? 0)");
    expect(handler).toContain("(long)(agg?.SoldSum ?? 0)");
  });
});
