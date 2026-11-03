// The Elixir / Ecto spelling of the `Codec` fact
// (src/generator/elixir/vanilla/codec-spelling-ex.ts): each spelling pinned
// against the fact row it writes down, including the owner rulings on #3527 /
// #3593 (lineage and channel envelope are wire).

import { describe, expect, it } from "vitest";
import { numericEncode } from "../../../src/generator/_numeric/target.js";
import {
  exCalendarDateWire,
  exEctoIdJsonType,
  exEctoIdType,
  exEctoJsonType,
  exEctoScalarType,
  exEnvelopeInstant,
  exInstantWire,
  exInt32Range,
  exIntegerRange,
  exLineageValue,
  exMigrationColumnOpts,
  exMigrationColumnType,
  exMigrationKeyType,
  exMigrationRowIdType,
  exMoneyColumnSql,
  exMoneyGrammarRegex,
  exMoneyMaxExclusive,
  exPgInstantType,
  exProvWireModule,
} from "../../../src/generator/elixir/vanilla/codec-spelling-ex.js";
import { renderLoomDatetimeModule } from "../../../src/generator/elixir/vanilla/datetime-type-emit.js";
import { ELIXIR_NUMERIC } from "../../../src/generator/elixir/vanilla/numeric-codec.js";
import { idColumn, scalarCodec } from "../../../src/ir/enrich/codec.js";
import type { TypeIR } from "../../../src/ir/types/loom-ir.js";

const prim = (name: string): TypeIR => ({ kind: "primitive", name }) as TypeIR;

describe("migration columns", () => {
  it("spells each scalar's migration type from the fact's column", () => {
    const col = (n: Parameters<typeof scalarCodec>[0]) => scalarCodec(n).column;
    expect(exMigrationColumnType(col("int"))).toBe(":integer");
    expect(exMigrationColumnType(col("long"))).toBe(":bigint");
    expect(exMigrationColumnType(col("decimal"))).toBe(":decimal");
    expect(exMigrationColumnType(col("money"))).toBe(":decimal");
    expect(exMigrationColumnType(col("string"))).toBe(":text");
    expect(exMigrationColumnType(col("bool"))).toBe(":boolean");
    expect(exMigrationColumnType(col("date"))).toBe(":date");
    expect(exMigrationColumnType(col("datetime"))).toBe(":timestamptz");
    expect(exMigrationColumnType(col("guid"))).toBe(":uuid");
    expect(exMigrationColumnType(col("json"))).toBe(":map");
    expect(exMigrationColumnType(col("File"))).toBe(":map");
    expect(exMigrationColumnType({ kind: "array", inner: col("int") })).toBe("{:array, :integer}");
  });

  it("bounds the money column at the fact's precision and scale, and nothing else", () => {
    expect(exMigrationColumnOpts(scalarCodec("money").column)).toBe(", precision: 19, scale: 4");
    expect(exMigrationColumnOpts(scalarCodec("decimal").column)).toBe("");
    expect(exMoneyColumnSql()).toBe("NUMERIC(19,4)");
  });

  it("keys a text id as Ecto's :string and every other id as its column", () => {
    expect(exMigrationKeyType(idColumn("string"))).toBe(":string");
    expect(exMigrationKeyType(idColumn("guid"))).toBe(":uuid");
    expect(exMigrationKeyType(idColumn("long"))).toBe(":bigint");
    expect(exMigrationRowIdType()).toBe(":uuid");
  });

  it("names the instant column for a SQL cast", () => {
    expect(exPgInstantType()).toBe("timestamptz");
  });
});

describe("schema fields", () => {
  it("types each declared primitive from the fact's column", () => {
    expect(exEctoScalarType("int")).toBe(":integer");
    expect(exEctoScalarType("long")).toBe(":integer");
    expect(exEctoScalarType("decimal")).toBe(":decimal");
    expect(exEctoScalarType("money")).toBe(":decimal");
    expect(exEctoScalarType("string")).toBe(":string");
    expect(exEctoScalarType("bool")).toBe(":boolean");
    expect(exEctoScalarType("date")).toBe(":date");
    // RS-38: the millisecond instant type, never Ecto's second-precision one.
    expect(exEctoScalarType("datetime")).toBe("Loom.Datetime");
    expect(exEctoScalarType("guid")).toBe("Ecto.UUID");
    expect(exEctoScalarType("json")).toBe(":map");
    expect(exEctoScalarType("File")).toBe(":map");
    expect(exEctoScalarType("duration")).toBe(":string");
    expect(exEctoJsonType()).toBe(":map");
  });

  it("types an id by its value type's column", () => {
    expect(exEctoIdType("guid")).toBe(":binary_id");
    expect(exEctoIdType("string")).toBe(":string");
    expect(exEctoIdType("int")).toBe(":integer");
    expect(exEctoIdType("long")).toBe(":integer");
    expect(exEctoIdJsonType("guid")).toBe(":string");
    expect(exEctoIdJsonType("string")).toBe(":string");
    expect(exEctoIdJsonType("int")).toBe(":integer");
  });
});

describe("wire", () => {
  it("reads the money bound, grammar, scale and integer ranges off the fact", () => {
    expect(exMoneyMaxExclusive()).toBe('"1000000000000000"');
    expect(exMoneyGrammarRegex()).toBe("~r/^-?\\d+(\\.\\d+)?$/");
    expect(numericEncode(ELIXIR_NUMERIC, "money", "dto-map", "v")).toBe("Decimal.round(v, 4)");
    expect(exInt32Range()).toEqual({ min: -2147483648, max: 2147483647 });
    expect(exIntegerRange("long")).toEqual({ min: -9007199254740991, max: 9007199254740991 });
  });

  it("spells the instant through Loom.Datetime.wire/1, which prints the normalized value", () => {
    expect(exInstantWire("d")).toBe("Loom.Datetime.wire(d)");
    const mod = renderLoomDatetimeModule();
    expect(mod).toContain("def wire(nil), do: nil");
    expect(mod).toContain(
      "def wire(%DateTime{} = dt), do: dt |> normalize() |> DateTime.to_iso8601()",
    );
    // Three digits, none on a whole second, truncated (never rounded).
    expect(mod).toContain("0 -> %{utc | microsecond: {0, 0}}");
    expect(mod).toContain("ms -> %{utc | microsecond: {ms * 1000, 3}}");
  });

  it("spells a date as YYYY-MM-DD", () => {
    expect(exCalendarDateWire("d")).toBe("Date.to_iso8601(d)");
  });
});

describe("lineage (owner rulings on #3527 / #3593)", () => {
  it("writes every scalar in its wire form", () => {
    expect(exLineageValue("x", prim("money"), "App")).toBe("App.Provenance.Wire.money(x)");
    expect(exLineageValue("x", prim("decimal"), "App")).toBe("App.Provenance.Wire.decimal(x)");
    expect(exLineageValue("x", prim("datetime"), "App")).toBe("App.Provenance.Wire.instant(x)");
    expect(exLineageValue("x", prim("date"), "App")).toBe("App.Provenance.Wire.date(x)");
    expect(exLineageValue("x", { kind: "optional", inner: prim("money") } as TypeIR, "App")).toBe(
      "App.Provenance.Wire.money(x)",
    );
  });

  it("leaves a scalar that already encodes to its wire form, and a non-scalar, alone", () => {
    expect(exLineageValue("x", prim("int"), "App")).toBe("x");
    expect(exLineageValue("x", prim("string"), "App")).toBe("x");
    expect(exLineageValue("x", { kind: "array", element: prim("money") } as TypeIR, "App")).toBe(
      "x",
    );
    expect(exLineageValue("x", undefined, "App")).toBe("x");
  });

  it("encodes money at the fixed scale, a decimal as a number, through the wire encoders", () => {
    const mod = exProvWireModule("App");
    expect(mod).toContain("defmodule App.Provenance.Wire do");
    expect(mod).toContain("def money(%Decimal{} = v), do: v |> Decimal.round(4) |> to_string()");
    expect(mod).toContain("def decimal(%Decimal{} = v), do: Decimal.to_float(v)");
    expect(mod).toContain("def instant(v), do: Loom.Datetime.wire(v)");
    expect(mod).toContain("def date(%Date{} = v), do: Date.to_iso8601(v)");
  });
});

describe("channel envelope (owner ruling on #3593)", () => {
  it("writes the envelope instant as the wire instant", () => {
    expect(exEnvelopeInstant("DateTime.utc_now()")).toBe("Loom.Datetime.wire(DateTime.utc_now())");
  });
});
