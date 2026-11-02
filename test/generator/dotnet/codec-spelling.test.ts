// The C# spelling of the `Codec` fact (src/generator/dotnet/codec-spelling.ts):
// each spelling pinned against the fact row it writes down, including the
// owner rulings on #3527 / #3593 (lineage and channel envelope are wire).

import { describe, expect, it } from "vitest";
import {
  csCalendarDateParseExact,
  csCalendarDateWire,
  csEnvelopeInstant,
  csIdSqlType,
  csInstantFormatterBody,
  csInstantIngressTruncate,
  csInstantWire,
  csInt32Range,
  csJsonSqlType,
  csLineageValue,
  csMoneyGrammar,
  csMoneyMaxExclusive,
  csProvWireClass,
  csSqlType,
} from "../../../src/generator/dotnet/codec-spelling.js";
import { moneyWire } from "../../../src/ir/enrich/codec.js";
import type { TypeIR } from "../../../src/ir/types/loom-ir.js";

const CS_PROV_WIRE = "ProvWire";
const prim = (name: string): TypeIR => ({ kind: "primitive", name }) as TypeIR;

describe("columns", () => {
  it("names each scalar's Postgres type from the fact's column", () => {
    expect(csSqlType("int")).toBe("integer");
    expect(csSqlType("long")).toBe("bigint");
    expect(csSqlType("decimal")).toBe("numeric");
    // A cast never names the precision.
    expect(csSqlType("money")).toBe("numeric");
    expect(csSqlType("string")).toBe("text");
    expect(csSqlType("bool")).toBe("boolean");
    expect(csSqlType("date")).toBe("date");
    expect(csSqlType("datetime")).toBe("timestamptz");
    expect(csSqlType("guid")).toBe("uuid");
    expect(csSqlType("json")).toBe("jsonb");
    expect(csSqlType("File")).toBe("jsonb");
    expect(csJsonSqlType()).toBe("jsonb");
    expect(csIdSqlType("guid")).toBe("uuid");
    expect(csIdSqlType("int")).toBe("integer");
    expect(csIdSqlType("long")).toBe("bigint");
    expect(csIdSqlType("string")).toBe("text");
  });
});

describe("wire", () => {
  it("reads the money bound, grammar and int range off the fact", () => {
    expect(csMoneyMaxExclusive()).toBe("1000000000000000");
    expect(csMoneyGrammar()).toBe(moneyWire().grammar);
    expect(csInt32Range()).toEqual({ min: -2147483648, max: 2147483647 });
  });

  it("spells the instant as the fact's three truncated digits, none on a whole second", () => {
    expect(csInstantWire("d")).toBe(
      `d.ToUniversalTime().ToString("yyyy'-'MM'-'dd'T'HH':'mm':'ss'.'fff'Z'", System.Globalization.CultureInfo.InvariantCulture).Replace(".000Z", "Z")`,
    );
    expect(csInstantFormatterBody()).toContain(`.EndsWith(".000Z"`);
    expect(csInstantFormatterBody()).toContain("s.Length - 5");
    expect(csInstantIngressTruncate("x")).toBe(
      "x.AddTicks(-(x.Ticks % TimeSpan.TicksPerMillisecond))",
    );
  });

  it("spells the date as YYYY-MM-DD", () => {
    expect(csCalendarDateWire("d")).toBe(
      `d.ToString("yyyy'-'MM'-'dd", System.Globalization.CultureInfo.InvariantCulture)`,
    );
    expect(csCalendarDateWire("d", "CultureInfo.InvariantCulture")).toContain(
      ", CultureInfo.InvariantCulture)",
    );
    expect(csCalendarDateParseExact("s")).toBe(
      `DateOnly.ParseExact(s, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture)`,
    );
  });
});

describe("lineage — every scalar is its wire encoding", () => {
  it("encodes money, decimal, datetime and date through the helper", () => {
    expect(csLineageValue("x", prim("money"))).toBe(`${CS_PROV_WIRE}.Money(x)`);
    expect(csLineageValue("x", prim("decimal"))).toBe(`${CS_PROV_WIRE}.Decimal(x)`);
    expect(csLineageValue("x", prim("datetime"))).toBe(`${CS_PROV_WIRE}.Instant(x)`);
    expect(csLineageValue("x", prim("date"))).toBe(`${CS_PROV_WIRE}.Date(x)`);
    const opt = { kind: "optional", inner: prim("money") } as TypeIR;
    expect(csLineageValue("x", opt)).toBe(`${CS_PROV_WIRE}.Money(x)`);
  });

  it("leaves a scalar whose C# value already serializes to its wire form", () => {
    for (const n of ["int", "long", "string", "bool", "guid", "json"])
      expect(csLineageValue("x", prim(n))).toBe("x");
  });

  it("records a non-scalar and an unknown type as the domain value", () => {
    expect(csLineageValue("x", undefined)).toBe("x");
    expect(csLineageValue("x", { kind: "array", element: prim("money") } as TypeIR)).toBe("x");
  });

  it("emits the helper from the same wire encoders the DTO mapper uses", () => {
    const cls = csProvWireClass();
    expect(cls).toContain(`public static class ${CS_PROV_WIRE}`);
    expect(cls).toContain(`Money(decimal? v) => v is null ? null : v.Value.ToString("F4"`);
    expect(cls).toContain("Decimal(decimal? v) => v is null ? null : double.Parse(");
    expect(cls).toContain(`Instant(DateTime? v) => v is null ? null : ${csInstantWire("v.Value")}`);
    expect(cls).toContain(`Date(IFormattable? v) => ${csCalendarDateWire("v?")}`);
    // Naming DateOnly would register Dapper's DateOnly handler in every
    // provenanced project.
    expect(cls).not.toMatch(/\bDateOnly\b/);
  });
});

describe("channel envelope", () => {
  it("writes the envelope instant as the wire instant", () => {
    expect(csEnvelopeInstant("DateTime.UtcNow")).toBe(csInstantWire("DateTime.UtcNow"));
  });
});
