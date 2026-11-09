// The Java / Spring Boot / JPA SPELLING of the IR `Codec` fact
// (`src/ir/enrich/codec.ts`).
//
// The fact decides how a scalar is written on the wire, stored in a column,
// recorded in a provenance lineage and carried inside a channel envelope; this
// file only says how Java, Hibernate and JDBC write that decision down.  Every
// java emitter asks here, or `numeric-codec.ts` for the read-boundary numeric
// leaves, instead of choosing an encoding itself —
// `test/generator/java/codec-census.test.ts` fails on a column type, a scale, a
// range bound, a money grammar or a date / datetime form chosen anywhere else.

import {
  envelopeInstantWire,
  instantWire,
  integerWire,
  lineageUsesWire,
  moneyIntegerDigits,
  moneyWire,
  scalarCodec,
  scalarCodecOf,
} from "../../ir/enrich/codec.js";
import type { TypeIR } from "../../ir/types/loom-ir.js";
import type { ColumnType } from "../../ir/types/migrations-ir.js";
import { numericEncode } from "../_numeric/target.js";
import { JAVA_NUMERIC } from "./numeric-codec.js";

// ---------------------------------------------------------------------------
// Columns — Postgres type names as a JDBC statement's casts spell them
// ---------------------------------------------------------------------------

/** The Postgres type name a JDBC insert casts a JSON payload to
 *  (`?::jsonb`) — an event-store row's `data`, a document's body.  JPA
 *  entities name no column type (Hibernate's `@JdbcTypeCode(SqlTypes.JSON)` is
 *  the ORM's own mapping of the same column); only these inserts cast to it. */
export function javaJsonSqlType(): string {
  const c: ColumnType = scalarCodec("json").column;
  if (c.kind !== "json")
    throw new Error(`codec-spelling: the json scalar is no longer a json column ('${c.kind}')`);
  return "jsonb";
}

// ---------------------------------------------------------------------------
// Money — the scale, the column's integer digits, the ingress grammar
// ---------------------------------------------------------------------------

/** Fractional digits a money wire string carries (RS-12) — the
 *  `setScale(n, HALF_UP)` every egress pins. */
function javaMoneyScale(): number {
  return moneyWire().scale;
}

/** Money zero on the wire, at the fixed scale (`"0.0000"`, never `"0"`). */
export function javaMoneyWireZero(): string {
  return `0.${"0".repeat(javaMoneyScale())}`;
}

/** Integer digits the money column holds; a wire value with more is refused
 *  at the field (`money-range`), never by the database. */
export function javaMoneyIntegerDigits(): number {
  return moneyIntegerDigits();
}

/** The money column as prose names it in an emitted doc comment
 *  (`NUMERIC(19,4)`). */
export function javaMoneyColumnLabel(): string {
  const c = scalarCodec("money").column;
  if (c.kind !== "decimal" || c.precision === undefined || c.scale === undefined)
    throw new Error("codec-spelling: the money column is no longer a bounded decimal");
  return `NUMERIC(${c.precision},${c.scale})`;
}

/** The money ingress grammar (RS-42) as a Java string literal for
 *  `Pattern.compile`.  `java.util.regex` reads the fact's grammar as written:
 *  `[0-9]` is ASCII only, and no flag widens it. */
export function javaMoneyGrammarLiteral(): string {
  return JSON.stringify(moneyWire().grammar);
}

// ---------------------------------------------------------------------------
// Integers
// ---------------------------------------------------------------------------

/** A Java boolean expression: the `long` `n` lies outside the `int` wire range.
 *  The range is the JVM `int`'s own, which Jackson enforces on an `int`
 *  component; a fact asking for any other bound could not be spelled with
 *  `Integer.MIN_VALUE` / `MAX_VALUE`, so it throws. */
export function javaIntOutOfRange(n: string): string {
  const { min, max } = integerWire("int");
  if (min !== -2147483648 || max !== 2147483647)
    throw new Error("codec-spelling: the fact's int range is no longer the JVM int");
  return `${n} < Integer.MIN_VALUE || ${n} > Integer.MAX_VALUE`;
}

// ---------------------------------------------------------------------------
// Datetime and date
// ---------------------------------------------------------------------------

/** The `ChronoUnit` an instant is truncated to: the fact's three fraction
 *  digits, TRUNCATED (`truncatedTo` never rounds, so `.9996` cannot carry into
 *  the next second). */
function instantUnit(): string {
  const w = instantWire();
  if (w.fractionDigits !== 3 || w.ingressExcess !== "truncate")
    throw new Error("codec-spelling: java truncates an instant to the millisecond");
  return "java.time.temporal.ChronoUnit.MILLIS";
}

/** An `Instant` expression cut to the wire precision — an ingress value, a
 *  stored `now`, so the stored value and the wire value agree. */
export function javaInstantTruncate(expr: string): string {
  return `${expr}.truncatedTo(${instantUnit()})`;
}

/** An `Instant` expression → its RS-4 + RS-38 wire string: ISO-8601 UTC, the
 *  fact's fraction digits when the instant has a sub-second part, none on a
 *  whole second.  `Instant.toString()` prints the fraction in groups of three
 *  and omits a zero one, so after the truncation it is exactly that form. */
export function javaInstantWire(expr: string): string {
  if (instantWire().wholeSecond !== "no-fraction")
    throw new Error("codec-spelling: Instant.toString() drops the fraction of a whole second");
  return `${javaInstantTruncate(expr)}.toString()`;
}

function assertCalendarDate(): void {
  if (scalarCodec("date").wire.form !== "calendar-date")
    throw new Error("codec-spelling: a date is no longer a calendar date on the wire");
}

/** A `LocalDate` expression → its wire text.  `LocalDate.toString()` is ISO
 *  `YYYY-MM-DD` for every year a column holds. */
export function javaCalendarDateWire(expr: string): string {
  assertCalendarDate();
  return `${expr}.toString()`;
}

/** The wire text → a `LocalDate`.  `LocalDate.parse` is strict: a
 *  datetime-shaped value is refused rather than losing its time of day. */
export function javaCalendarDateParse(expr: string): string {
  assertCalendarDate();
  return `java.time.LocalDate.parse(${expr})`;
}

// ---------------------------------------------------------------------------
// Lineage — a provenance lineage's `inputs[].value` / `computedValue`
// ---------------------------------------------------------------------------

/** The emitted `ProvWire` helper's name (domain.common). */
const JAVA_PROV_WIRE = "ProvWire";

/** The helper's method per wire form: the scalars whose Java domain value is
 *  NOT already its wire form.  A `decimal` and a `money` are `BigDecimal`s
 *  (Jackson writes either as a JSON number at the value's own scale), a
 *  datetime an `Instant` and a date a `LocalDate` (Hibernate's JSON format
 *  mapper writes them through an `ObjectMapper` whose date settings are not the
 *  wire's).  Every other scalar's domain value serializes to its wire value. */
const LINEAGE_METHOD = {
  "fixed-scale-decimal": "money",
  float64: "decimal",
  instant: "instant",
  "calendar-date": "date",
} as const;

/** A value as it is written into a provenance lineage: a scalar in its wire
 *  encoding (`lineageUsesWire` — the fact's `RULINGS` and #3527).  Each helper
 *  method is null-propagating, so it serves a plain and an optional value
 *  alike.  A non-scalar is recorded as the domain value it is. */
export function javaLineageValue(expr: string, type: TypeIR | undefined): string {
  if (!type || !lineageUsesWire(type)) return expr;
  const form = scalarCodecOf(type)?.wire.form;
  const method = form === undefined ? undefined : (LINEAGE_METHOD as Record<string, string>)[form];
  return method === undefined ? expr : `${JAVA_PROV_WIRE}.${method}(${expr})`;
}

/** The emitted `ProvWire.java`: one method per wire form, each
 *  null-propagating, each spelled through the wire encoders the DTO mapper
 *  uses so the lineage and the wire cannot disagree. */
export function javaProvWireClass(basePkg: string): string {
  return [
    `package ${basePkg}.domain.common;`,
    "",
    "/** Writes a scalar into a provenance lineage in its WIRE encoding (the",
    " *  {@code Codec} fact's lineage rule): money as the fixed-scale string, a",
    " *  decimal as the double, a datetime as the canonical instant, a date as",
    " *  {@code YYYY-MM-DD}.  Each passes a null through, so one method serves a",
    " *  required and an optional value. */",
    `public final class ${JAVA_PROV_WIRE} {`,
    `    private ${JAVA_PROV_WIRE}() {`,
    "    }",
    "",
    "    public static String money(java.math.BigDecimal v) {",
    `        return v == null ? null : ${numericEncode(JAVA_NUMERIC, "money", "dto-map", "v")};`,
    "    }",
    "",
    "    public static Double decimal(java.math.BigDecimal v) {",
    `        return v == null ? null : ${numericEncode(JAVA_NUMERIC, "decimal", "dto-map", "v")};`,
    "    }",
    "",
    "    public static String instant(java.time.Instant v) {",
    `        return v == null ? null : ${javaInstantWire("v")};`,
    "    }",
    "",
    "    public static String date(java.time.LocalDate v) {",
    `        return v == null ? null : ${javaCalendarDateWire("v")};`,
    "    }",
    "}",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Channel envelope — the CloudEvents `time` and the datetimes of `data`
// ---------------------------------------------------------------------------

/** An `Instant` expression as it is written inside a channel envelope — the
 *  RS-38 wire instant (the fact's `envelopeInstantWire`). */
export function javaEnvelopeInstant(expr: string): string {
  // The fact rules the envelope instant to BE the wire instant; a fact that
  // ever split them would need a spelling of its own here.
  if (JSON.stringify(envelopeInstantWire()) !== JSON.stringify(instantWire()))
    throw new Error("codec-spelling: the envelope instant is no longer the wire instant");
  return javaInstantWire(expr);
}
