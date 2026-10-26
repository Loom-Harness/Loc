// The `Codec` fact (src/ir/enrich/codec.ts): each row pinned against the
// RS-rule or ruling it encodes, the `codecOf` resolution over declared types,
// and the `UNRULED` list kept in step with the table.

import { describe, expect, it } from "vitest";
import {
  allScalarCodecs,
  codecOf,
  idColumn,
  instantWire,
  integerWire,
  lineageUsesWire,
  MONEY_PRECISION,
  MONEY_SCALE,
  moneyIntegerDigits,
  moneyWire,
  scalarCodec,
  scalarCodecOf,
  UNRULED,
  valueObjectStorage,
} from "../../src/ir/enrich/codec.js";
import type { TypeIR, ValueObjectIR } from "../../src/ir/types/loom-ir.js";

const prim = (name: string): TypeIR => ({ kind: "primitive", name }) as TypeIR;

describe("scalar codecs — the cross-backend contract", () => {
  it("money: a fixed-scale-4 string over NUMERIC(19,4), exact in memory (RS-12, RS-42)", () => {
    const c = scalarCodec("money");
    expect(c.wire).toEqual({
      form: "fixed-scale-decimal",
      json: "string",
      scale: 4,
      grammar: "^-?[0-9]+(\\.[0-9]+)?$",
    });
    expect(c.column).toEqual({ kind: "decimal", precision: 19, scale: 4 });
    expect(c.memory).toEqual({ holds: "exact-decimal", exactArithmetic: true });
    expect([MONEY_SCALE, MONEY_PRECISION, moneyIntegerDigits()]).toEqual([4, 19, 15]);
  });

  it("money's grammar refuses grouping, exponents, a leading + and whitespace (RS-42)", () => {
    const re = new RegExp(moneyWire().grammar);
    for (const ok of ["12", "-12.5", "0.0001", "12.50"]) expect(re.test(ok), ok).toBe(true);
    for (const bad of ["12,50", "1e3", "+1", " 1", "1.", ".5", "1.2.3", "twelve"])
      expect(re.test(bad), bad).toBe(false);
  });

  it("decimal: a float64 JSON number over an unbounded column, exact arithmetic (RS-24, RS-37)", () => {
    const c = scalarCodec("decimal");
    expect(c.wire).toEqual({ form: "float64", json: "number" });
    expect(c.column).toEqual({ kind: "decimal" });
    expect(c.memory).toEqual({ holds: "float64", exactArithmetic: true });
  });

  it("int is int32 and long the 2^53−1 ceiling, both refused with one sentence (RS-42, D-LONG-AVG-DEFAULTS)", () => {
    expect(integerWire("int")).toMatchObject({ min: -2147483648, max: 2147483647 });
    expect(integerWire("long")).toMatchObject({
      min: -9007199254740991,
      max: 9007199254740991,
    });
    expect(integerWire("int").rangeMessage).toBe("Integer out of range");
    expect(scalarCodec("int").column).toEqual({ kind: "int" });
    expect(scalarCodec("long").column).toEqual({ kind: "bigint" });
  });

  it("datetime: ms ISO-8601 UTC, no fraction on a whole second, truncated at ingress (RS-4, RS-38)", () => {
    expect(instantWire()).toEqual({
      form: "instant",
      json: "string",
      fractionDigits: 3,
      wholeSecond: "no-fraction",
      ingressExcess: "truncate",
    });
    expect(scalarCodec("datetime").column).toEqual({ kind: "datetime" });
  });

  it("date: a calendar date, Postgres `date`", () => {
    expect(scalarCodec("date").wire.form).toBe("calendar-date");
    expect(scalarCodec("date").column).toEqual({ kind: "date" });
  });

  it("File is a JSONB reference column with the fixed object on the wire", () => {
    expect(scalarCodec("File").wire).toEqual({ form: "file-ref", json: "object" });
    expect(scalarCodec("File").column).toEqual({ kind: "json" });
  });

  it("each wire JSON type agrees with the wirePolicy ingress table", async () => {
    const { ingressFor } = await import("../../src/ir/enrich/wire-policy.js");
    for (const c of allScalarCodecs())
      expect(ingressFor(c.primitive).json, c.primitive).toBe(c.wire.json);
  });

  it("covers every storable primitive and refuses the expression-only `duration`", () => {
    expect(
      allScalarCodecs()
        .map((c) => c.primitive)
        .sort(),
    ).toEqual(
      [
        "File",
        "bool",
        "date",
        "datetime",
        "decimal",
        "guid",
        "int",
        "json",
        "long",
        "money",
        "string",
      ].sort(),
    );
    expect(() => scalarCodec("duration" as never)).toThrow(/expression-only/);
  });

  it("an id column follows its value type", () => {
    expect(idColumn("guid")).toEqual({ kind: "uuid" });
    expect(idColumn("int")).toEqual({ kind: "int" });
    expect(idColumn("long")).toEqual({ kind: "bigint" });
    expect(idColumn("string")).toEqual({ kind: "text" });
  });
});

describe("lineage encoding (#3527)", () => {
  it("money and the integers are written in their wire encoding", () => {
    expect(lineageUsesWire(prim("money"))).toBe(true);
    expect(lineageUsesWire({ kind: "optional", inner: prim("money") } as TypeIR)).toBe(true);
    expect(lineageUsesWire(prim("int"))).toBe(true);
    expect(lineageUsesWire(prim("long"))).toBe(true);
  });

  it("the unruled scalars keep each backend's encoding", () => {
    for (const p of ["decimal", "datetime", "date", "string", "bool", "guid", "json", "File"])
      expect(lineageUsesWire(prim(p)), p).toBe(false);
    expect(lineageUsesWire({ kind: "array", element: prim("money") } as TypeIR)).toBe(false);
  });
});

describe("codecOf — a declared type", () => {
  const money: ValueObjectIR = {
    name: "Price",
    fields: [
      { name: "amount", type: prim("money"), optional: false },
      { name: "note", type: prim("string"), optional: true },
    ],
    derived: [],
    invariants: [],
    functions: [],
    tests: [],
  } as unknown as ValueObjectIR;
  const lookup = (n: string) => (n === "Price" ? money : undefined);

  it("resolves a value object's members through the lookup", () => {
    const c = codecOf({ kind: "valueobject", name: "Price" } as TypeIR, lookup);
    expect(c.kind).toBe("valueobject");
    if (c.kind !== "valueobject") return;
    expect(c.members.map((m) => [m.name, m.optional])).toEqual([
      ["amount", false],
      ["note", true],
    ]);
    const amount = c.members[0]!.codec;
    expect(amount.kind === "scalar" && amount.scalar.primitive).toBe("money");
  });

  it("is opaque for an unresolvable value object and for a union", () => {
    expect(codecOf({ kind: "valueobject", name: "Nope" } as TypeIR, lookup).kind).toBe("opaque");
    expect(codecOf({ kind: "union", variants: [] } as unknown as TypeIR, undefined).kind).toBe(
      "opaque",
    );
  });

  it("wraps collections, optionals, ids and enums", () => {
    expect(codecOf({ kind: "array", element: prim("int") } as TypeIR, undefined)).toEqual({
      kind: "array",
      element: { kind: "scalar", scalar: scalarCodec("int") },
    });
    expect(codecOf({ kind: "optional", inner: prim("date") } as TypeIR, undefined).kind).toBe(
      "optional",
    );
    const id = codecOf({ kind: "id", targetName: "Order", valueType: "long" } as TypeIR, undefined);
    expect(id.kind === "id" && id.scalar.primitive).toBe("long");
    const en = codecOf({ kind: "enum", name: "Status" } as TypeIR, undefined);
    expect(en.kind === "enum" && en.scalar.wire.form).toBe("text");
  });

  it("scalarCodecOf peels one optional and stops at a non-scalar", () => {
    expect(scalarCodecOf({ kind: "optional", inner: prim("money") } as TypeIR)?.primitive).toBe(
      "money",
    );
    expect(scalarCodecOf({ kind: "enum", name: "S" } as TypeIR)).toBeUndefined();
  });

  it("stores a value object as flattened columns in a field, JSON elsewhere", () => {
    expect(valueObjectStorage("field")).toBe("flattened-columns");
    expect(valueObjectStorage("element")).toBe("json");
    expect(valueObjectStorage("document")).toBe("json");
  });
});

describe("UNRULED — the owner questions", () => {
  it("names a lineage scalar only while its lineage is still unruled", () => {
    for (const u of UNRULED) {
      const m = /^lineage: (\w+)$/.exec(u.surface);
      if (m) expect(scalarCodec(m[1] as never).lineage, u.surface).toBe("unruled");
    }
  });

  it("each entry asks a question", () => {
    for (const u of UNRULED) expect(u.question.endsWith("?"), u.surface).toBe(true);
  });
});
