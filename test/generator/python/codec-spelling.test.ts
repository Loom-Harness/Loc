// The python spelling of the `Codec` fact (src/generator/python/codec-spelling.ts):
// each spelling pinned against the fact row it writes down, including the
// owner rulings on #3527 / #3593 (lineage and channel envelope are wire).

import { describe, expect, it } from "vitest";
import { pyFrom } from "../../../src/generator/_imports/python.js";
import { ref } from "../../../src/generator/_imports/symbol.js";
import {
  pyCalendarDateWire,
  pyEnvelopeInstant,
  pyIdColumnType,
  pyInstantColumnType,
  pyIntegerRange,
  pyIsoHelperBody,
  pyLineageValue,
  pyMoneyColumnLabel,
  pyMoneyGrammar,
  pyMoneyIntegerDigits,
  pyMoneyQuantum,
  pyScalarColumn,
} from "../../../src/generator/python/codec-spelling.js";
import { moneyWire } from "../../../src/ir/enrich/codec.js";
import type { TypeIR } from "../../../src/ir/types/loom-ir.js";

const prim = (name: string): TypeIR => ({ kind: "primitive", name }) as TypeIR;
const ISO = ref(pyFrom("app.db.wire", "iso"));
const MONEY_STR = ref(pyFrom("app.db.wire", "money_str"));

describe("SQLAlchemy columns", () => {
  it("maps each scalar onto the fact's column", () => {
    expect(pyScalarColumn("int")).toEqual({ pyType: "int", saType: "Integer" });
    expect(pyScalarColumn("long")).toEqual({ pyType: "int", saType: "BigInteger" });
    expect(pyScalarColumn("decimal")).toEqual({ pyType: "Decimal", saType: "Numeric" });
    expect(pyScalarColumn("money")).toEqual({ pyType: "Decimal", saType: "Numeric(19, 4)" });
    expect(pyScalarColumn("string")).toEqual({ pyType: "str", saType: "Text" });
    expect(pyScalarColumn("bool")).toEqual({ pyType: "bool", saType: "Boolean" });
    expect(pyScalarColumn("date")).toEqual({ pyType: "CalendarDate", saType: "Date" });
    expect(pyScalarColumn("datetime")).toEqual({
      pyType: "datetime",
      saType: "DateTime(timezone=True)",
    });
    expect(pyScalarColumn("guid")).toEqual({ pyType: "str", saType: "Uuid(as_uuid=False)" });
    expect(pyScalarColumn("json")).toEqual({ pyType: "object", saType: "JSONB" });
    expect(pyScalarColumn("File")).toEqual({ pyType: "FileRef", saType: "JSONB" });
    expect(pyIdColumnType()).toBe("Uuid(as_uuid=False)");
    expect(pyInstantColumnType()).toBe("DateTime(timezone=True)");
  });
});

describe("wire", () => {
  it("reads the money bounds, quantum, grammar and integer range off the fact", () => {
    expect(pyMoneyIntegerDigits()).toBe(15);
    expect(pyMoneyColumnLabel()).toBe("NUMERIC(19,4)");
    expect(pyMoneyQuantum()).toBe("1e-4");
    expect(pyIntegerRange("int")).toEqual({ min: -2147483648, max: 2147483647 });
  });

  it("spells the money grammar ASCII-only and end-anchored for python's `re`", () => {
    expect(pyMoneyGrammar()).toBe('r"^-?[0-9]+(\\.[0-9]+)?\\Z"');
    // The fact's own grammar, with only the closing anchor re-spelled.
    expect(pyMoneyGrammar().slice(2, -1)).toBe(`${moneyWire().grammar.slice(0, -1)}\\Z`);
  });

  it("spells the iso helper as a truncating millisecond instant (RS-38)", () => {
    const body = pyIsoHelperBody();
    expect(body).toContain('isoformat(timespec="milliseconds")');
    expect(body).toContain("if utc.microsecond < 1000:");
  });

  it("writes a date as its calendar wire form", () => {
    expect(pyCalendarDateWire("d")).toBe("d.isoformat()");
  });
});

describe("lineage values (#3527, rulings 1 and 2)", () => {
  it("writes money at the wire scale, null-guarded", () => {
    expect(pyLineageValue("x", prim("money"))).toBe(`(None if x is None else ${MONEY_STR}(x))`);
  });

  it("writes a datetime as the RS-38 instant and a date as its calendar form", () => {
    expect(pyLineageValue("x", prim("datetime"))).toBe(`(None if x is None else ${ISO}(x))`);
    expect(pyLineageValue("x", { kind: "optional", inner: prim("datetime") } as TypeIR)).toBe(
      `(None if x is None else ${ISO}(x))`,
    );
    expect(pyLineageValue("x", prim("date"))).toBe("(None if x is None else x.isoformat())");
  });

  it("leaves a value whose python form is already its wire form as it is", () => {
    // Ruling 1: a python `decimal` is a float — the RS-24 wire number.
    expect(pyLineageValue("x", prim("decimal"))).toBe("x");
    expect(pyLineageValue("x", prim("int"))).toBe("x");
    expect(pyLineageValue("x", prim("guid"))).toBe("x");
    expect(pyLineageValue("x", { kind: "array", element: prim("money") } as TypeIR)).toBe("x");
    expect(pyLineageValue("x", undefined)).toBe("x");
  });
});

describe("channel envelope (ruling 4)", () => {
  it("spells an envelope datetime as the RS-38 instant", () => {
    expect(pyEnvelopeInstant("datetime.now(UTC)")).toBe(`${ISO}(datetime.now(UTC))`);
  });
});
