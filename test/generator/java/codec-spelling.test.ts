// The Java spelling of the `Codec` fact (src/generator/java/codec-spelling.ts):
// each spelling pinned against the fact row it writes down, including the
// owner rulings on #3527 / #3593 (lineage and channel envelope are wire).

import { describe, expect, it } from "vitest";
import {
  javaCalendarDateParse,
  javaCalendarDateWire,
  javaEnvelopeInstant,
  javaInstantTruncate,
  javaInstantWire,
  javaIntOutOfRange,
  javaJsonSqlType,
  javaLineageValue,
  javaMoneyColumnLabel,
  javaMoneyGrammarLiteral,
  javaMoneyIntegerDigits,
  javaMoneyWireZero,
  javaProvWireClass,
} from "../../../src/generator/java/codec-spelling.js";
import { moneyWire } from "../../../src/ir/enrich/codec.js";
import type { TypeIR } from "../../../src/ir/types/loom-ir.js";

const prim = (name: string): TypeIR => ({ kind: "primitive", name }) as TypeIR;

describe("columns", () => {
  it("casts a JSON payload to the fact's json column", () => {
    expect(javaJsonSqlType()).toBe("jsonb");
  });
});

describe("money", () => {
  it("reads the scale, zero, column and integer digits off the fact", () => {
    expect(javaMoneyWireZero()).toBe("0.0000");
    expect(javaMoneyColumnLabel()).toBe("NUMERIC(19,4)");
    expect(javaMoneyIntegerDigits()).toBe(15);
  });

  it("spells the fact's ingress grammar as a Java string literal", () => {
    expect(javaMoneyGrammarLiteral()).toBe('"^-?[0-9]+(\\\\.[0-9]+)?$"');
    expect(JSON.parse(javaMoneyGrammarLiteral())).toBe(moneyWire().grammar);
  });
});

describe("integers", () => {
  it("guards the int range with the JVM int's own bounds", () => {
    expect(javaIntOutOfRange("n")).toBe("n < Integer.MIN_VALUE || n > Integer.MAX_VALUE");
  });
});

describe("datetime and date", () => {
  it("spells the instant as the fact's three truncated digits, none on a whole second", () => {
    expect(javaInstantTruncate("x")).toBe("x.truncatedTo(java.time.temporal.ChronoUnit.MILLIS)");
    expect(javaInstantWire("d")).toBe(
      "d.truncatedTo(java.time.temporal.ChronoUnit.MILLIS).toString()",
    );
  });

  it("spells the date as ISO YYYY-MM-DD both ways", () => {
    expect(javaCalendarDateWire("d")).toBe("d.toString()");
    expect(javaCalendarDateParse("s")).toBe("java.time.LocalDate.parse(s)");
  });
});

describe("lineage — every scalar is its wire encoding", () => {
  it("encodes money, decimal, datetime and date through the helper", () => {
    expect(javaLineageValue("x", prim("money"))).toBe("ProvWire.money(x)");
    expect(javaLineageValue("x", prim("decimal"))).toBe("ProvWire.decimal(x)");
    expect(javaLineageValue("x", prim("datetime"))).toBe("ProvWire.instant(x)");
    expect(javaLineageValue("x", prim("date"))).toBe("ProvWire.date(x)");
    const opt = { kind: "optional", inner: prim("money") } as TypeIR;
    expect(javaLineageValue("x", opt)).toBe("ProvWire.money(x)");
  });

  it("leaves a scalar whose Java value already serializes to its wire form", () => {
    for (const n of ["int", "long", "string", "bool", "guid", "json"])
      expect(javaLineageValue("x", prim(n))).toBe("x");
  });

  it("records a non-scalar and an unknown type as the domain value", () => {
    expect(javaLineageValue("x", undefined)).toBe("x");
    expect(javaLineageValue("x", { kind: "array", element: prim("money") } as TypeIR)).toBe("x");
  });

  it("emits the helper from the same wire encoders the DTO mapper uses", () => {
    const cls = javaProvWireClass("com.acme");
    expect(cls).toContain("package com.acme.domain.common;");
    expect(cls).toContain("public final class ProvWire {");
    expect(cls).toContain(
      "return v == null ? null : v.setScale(4, java.math.RoundingMode.HALF_UP).toPlainString();",
    );
    expect(cls).toContain("public static Double decimal(java.math.BigDecimal v) {");
    expect(cls).toContain("return v == null ? null : v.doubleValue();");
    expect(cls).toContain(`return v == null ? null : ${javaInstantWire("v")};`);
    expect(cls).toContain(`return v == null ? null : ${javaCalendarDateWire("v")};`);
  });
});

describe("channel envelope", () => {
  it("writes the envelope instant as the wire instant", () => {
    expect(javaEnvelopeInstant("Instant.now()")).toBe(javaInstantWire("Instant.now()"));
  });
});
