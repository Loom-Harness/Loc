// The node spelling of the `Codec` fact (src/generator/typescript/codec-spelling.ts):
// each spelling pinned to the exact text the emitters produced before the
// fact existed, so moving them onto it was byte-identical, plus the
// equivalence of the money regex to the fact's grammar.

import { describe, expect, it } from "vitest";
import {
  drizzleIdColumn,
  drizzleScalarColumn,
  mikroScalar,
  TS_MONEY_GRAMMAR,
  tsInstantWire,
  tsIntegerRange,
  tsLineageValue,
  tsMoneyColumnLabel,
  tsMoneyIntegerDigits,
} from "../../../src/generator/typescript/codec-spelling.js";
import { moneyWire } from "../../../src/ir/enrich/codec.js";
import type { TypeIR } from "../../../src/ir/types/loom-ir.js";

describe("drizzle columns", () => {
  it("spells each scalar column as the schema emitter always has", () => {
    expect(drizzleScalarColumn("int", "n")).toBe('integer("n")');
    expect(drizzleScalarColumn("long", "n")).toBe('bigint("n", { mode: "number" })');
    expect(drizzleScalarColumn("decimal", "n")).toBe('numeric("n")');
    expect(drizzleScalarColumn("money", "n")).toBe('numeric("n", { precision: 19, scale: 4 })');
    expect(drizzleScalarColumn("string", "n")).toBe('text("n")');
    expect(drizzleScalarColumn("bool", "n")).toBe('boolean("n")');
    expect(drizzleScalarColumn("date", "n")).toBe('date("n", { mode: "string" })');
    expect(drizzleScalarColumn("datetime", "n")).toBe('timestamp("n", { withTimezone: true })');
    expect(drizzleScalarColumn("guid", "n")).toBe('uuid("n")');
    expect(drizzleScalarColumn("json", "n")).toBe('jsonb("n")');
    expect(drizzleScalarColumn("File", "n")).toBe('jsonb("n")');
  });

  it("spells id columns by value type", () => {
    expect(drizzleIdColumn("guid", "id")).toBe('uuid("id")');
    expect(drizzleIdColumn("int", "id")).toBe('integer("id")');
    expect(drizzleIdColumn("long", "id")).toBe('bigint("id", { mode: "number" })');
    expect(drizzleIdColumn("string", "id")).toBe('text("id")');
  });
});

describe("MikroORM scalars", () => {
  it("maps each scalar as the entity emitter always has", () => {
    expect(mikroScalar("int")).toEqual({ mikro: "integer", ts: "number" });
    expect(mikroScalar("long")).toEqual({ mikro: "bigint", ts: "number" });
    expect(mikroScalar("decimal")).toEqual({
      mikro: "decimal",
      ts: "string",
      columnType: "numeric",
    });
    expect(mikroScalar("money")).toEqual({
      mikro: "decimal",
      ts: "string",
      columnType: "numeric(19,4)",
    });
    expect(mikroScalar("bool")).toEqual({ mikro: "boolean", ts: "boolean" });
    expect(mikroScalar("date")).toEqual({ mikro: "date", ts: "string" });
    expect(mikroScalar("datetime")).toEqual({ mikro: "datetime", ts: "Date" });
    expect(mikroScalar("guid")).toEqual({ mikro: "uuid", ts: "string" });
    expect(mikroScalar("json")).toEqual({ mikro: "json", ts: "unknown" });
    expect(mikroScalar("string")).toEqual({ mikro: "string", ts: "string" });
    expect(mikroScalar("File")).toEqual({ mikro: "string", ts: "string" });
  });
});

describe("wire spellings", () => {
  it("trims only the all-zero millisecond group off a datetime (RS-38)", () => {
    const expr = tsInstantWire("d");
    expect(expr).toBe('d.toISOString().replace(/\\.000Z$/, "Z")');
    const fn = new Function("d", `return ${expr};`) as (d: Date) => string;
    expect(fn(new Date("2024-03-01T10:20:30.000Z"))).toBe("2024-03-01T10:20:30Z");
    expect(fn(new Date("2024-03-01T10:20:30.120Z"))).toBe("2024-03-01T10:20:30.120Z");
  });

  it("the money regex accepts exactly what the fact's grammar does", () => {
    // biome-ignore lint/security/noGlobalEval: evaluating the emitted regex literal is the point
    const ts = eval(TS_MONEY_GRAMMAR) as RegExp;
    const fact = new RegExp(moneyWire().grammar);
    for (const s of [
      "12",
      "-12.5",
      "0.0001",
      "12,50",
      "1e3",
      "+1",
      " 1",
      "1.",
      ".5",
      "١٢",
      "1.2.3",
    ])
      expect(ts.test(s), s).toBe(fact.test(s));
  });

  it("reads the money bounds and integer ranges off the fact", () => {
    expect(tsMoneyIntegerDigits()).toBe(15);
    expect(tsMoneyColumnLabel()).toBe("NUMERIC(19,4)");
    expect(tsIntegerRange("int")).toEqual({ min: -2147483648, max: 2147483647 });
  });
});

describe("lineage values (#3527)", () => {
  const prim = (name: string): TypeIR => ({ kind: "primitive", name }) as TypeIR;

  it("writes money at the wire scale, null-guarded", () => {
    expect(tsLineageValue("x", prim("money"))).toBe("(x == null ? null : x.toFixed(4))");
  });

  it("leaves every other value as the domain value", () => {
    expect(tsLineageValue("x", prim("int"))).toBe("x");
    expect(tsLineageValue("x", prim("decimal"))).toBe("x");
    expect(tsLineageValue("x", prim("datetime"))).toBe("x");
    expect(tsLineageValue("x", undefined)).toBe("x");
  });
});
