// The C# / EF Core / Dapper SPELLING of the IR `Codec` fact
// (`src/ir/enrich/codec.ts`).
//
// The fact decides how a scalar is written on the wire, stored in a column,
// recorded in a provenance lineage and carried inside a channel envelope; this
// file only says how C#, EF Core and Dapper write that decision down.  Every
// .NET emitter asks here, or `numeric-codec.ts` for the read-boundary numeric
// leaves, instead of choosing an encoding itself —
// `test/generator/dotnet/codec-census.test.ts` fails on a column type, a
// scale, a range bound or a date / datetime format chosen anywhere else.

import {
  envelopeInstantWire,
  idColumn,
  instantWire,
  integerWire,
  lineageUsesWire,
  moneyIntegerDigits,
  moneyWire,
  scalarCodec,
  scalarCodecOf,
} from "../../ir/enrich/codec.js";
import type { IdValueType, PrimitiveName, TypeIR } from "../../ir/types/loom-ir.js";
import type { ColumnType } from "../../ir/types/migrations-ir.js";
import { numericEncode } from "../_numeric/target.js";
import { CS_NUMERIC, csDecimalToWireDouble } from "./numeric-codec.js";

// ---------------------------------------------------------------------------
// Columns — Postgres type names as Dapper's casts and EF's `HasColumnType`
// ---------------------------------------------------------------------------

/** The Postgres type NAME of a codec column, as a cast or a Dapper column type
 *  spells it.  A `decimal` is the bare `numeric` even for money: a cast never
 *  names the column's precision, because `::numeric(19,4)` would round (and
 *  refuse an overflow in) a value the column's own constraint is the gate for. */
function csSqlTypeName(c: ColumnType): string {
  switch (c.kind) {
    case "int":
      return "integer";
    case "bigint":
      return "bigint";
    case "decimal":
      return "numeric";
    case "text":
      return "text";
    case "bool":
      return "boolean";
    case "date":
      return "date";
    case "datetime":
      return "timestamptz";
    case "uuid":
      return "uuid";
    case "json":
      return "jsonb";
    case "bigserial":
    case "array":
      throw new Error(`codec-spelling: '${c.kind}' is not a scalar column`);
  }
}

/** The Postgres type name of a declared primitive's column. */
export function csSqlType(name: PrimitiveName): string {
  return name === "duration"
    ? csSqlTypeName(scalarCodec("string").column)
    : csSqlTypeName(scalarCodec(name).column);
}

/** The Postgres type name of an `X id` / primary key of this value type. */
export function csIdSqlType(valueType: IdValueType): string {
  return csSqlTypeName(idColumn(valueType));
}

/** The Postgres type name of a JSON column (a `json` / `File` field, a value
 *  object or collection stored as one value, a framework table's payload). */
export function csJsonSqlType(): string {
  return csSqlTypeName(scalarCodec("json").column);
}

// ---------------------------------------------------------------------------
// Wire — money, integers, datetime, date
// ---------------------------------------------------------------------------

/** Integer digits a money wire string may carry before the field refuses it,
 *  as the exclusive `decimal` literal bound (`|value| < 1e15`). */
export function csMoneyMaxExclusive(): string {
  return `1${"0".repeat(moneyIntegerDigits())}`;
}

/** The money ingress grammar, for the doc comment above the emitted hand loop
 *  that implements it (`WireFormatException.IsMoneyGrammar`).  A loop rather
 *  than a regex, so it cannot say anything but this exact grammar — a fact
 *  that changed the grammar would need a new loop, so it throws. */
export function csMoneyGrammar(): string {
  const g = moneyWire().grammar;
  if (g !== "^-?[0-9]+(\\.[0-9]+)?$")
    throw new Error("codec-spelling: the money grammar is no longer the one IsMoneyGrammar spells");
  return g;
}

/** The inclusive range of `int`: the CLR `int`'s own, which `GetInt32` and
 *  `TryGetInt32` enforce.  A fact asking for any other bound could not be
 *  spelled with them, so it throws. */
export function csInt32Range(): { min: number; max: number } {
  const { min, max } = integerWire("int");
  if (min !== -2147483648 || max !== 2147483647)
    throw new Error("codec-spelling: the fact's int range is no longer the CLR int32");
  return { min, max };
}

/** The `fff…` custom format of the wire instant: exactly the fact's fraction
 *  digits, TRUNCATED (a custom specifier never rounds, so `.9996` cannot carry
 *  into the next second). */
function instantFormat(): string {
  const w = instantWire();
  if (w.ingressExcess !== "truncate" || w.wholeSecond !== "no-fraction")
    throw new Error("codec-spelling: .NET spells a truncated, whole-second-trimmed instant");
  return `yyyy'-'MM'-'dd'T'HH':'mm':'ss'.'${"f".repeat(w.fractionDigits)}'Z'`;
}

/** The all-zero fraction + zone group a whole second drops (`.000Z`). */
function instantWholeSecondSuffix(): string {
  return `.${"0".repeat(instantWire().fractionDigits)}Z`;
}

const CULTURE = "System.Globalization.CultureInfo.InvariantCulture";

/** A `DateTime` expression → its RS-4 + RS-38 wire string: ISO-8601 UTC, the
 *  fact's fraction digits when the instant has a sub-second part, none on a
 *  whole second.  Do not trim the 7-digit `"o"` form with a regex: that strips
 *  EVERY trailing zero (`.120` spelled `.12Z`). */
export function csInstantWire(expr: string): string {
  return `${expr}.ToUniversalTime().ToString("${instantFormat()}", ${CULTURE}).Replace("${instantWholeSecondSuffix()}", "Z")`;
}

/** The body of the emitted `CanonicalInstant.Format(DateTime)` helper. */
export function csInstantFormatterBody(): string {
  const suffix = instantWholeSecondSuffix();
  return `        string s = value.ToUniversalTime().ToString("${instantFormat()}", CultureInfo.InvariantCulture);
        return s.EndsWith("${suffix}", StringComparison.Ordinal)
            ? string.Concat(s.AsSpan(0, s.Length - ${suffix.length}), "Z")
            : s;`;
}

/** A sub-fraction `DateTime` parsed at ingress → the value truncated to the
 *  wire fraction, never rounded (RS-38).  `TicksPerMillisecond` is the fact's
 *  three digits; any other count could not be spelled this way. */
export function csInstantIngressTruncate(parsed: string): string {
  if (instantWire().fractionDigits !== 3)
    throw new Error("codec-spelling: .NET truncates an ingress instant to the millisecond");
  return `${parsed}.AddTicks(-(${parsed}.Ticks % TimeSpan.TicksPerMillisecond))`;
}

/** The `date` format: `YYYY-MM-DD`, no zone, no time of day. */
function calendarDateFormat(): string {
  if (scalarCodec("date").wire.form !== "calendar-date")
    throw new Error("codec-spelling: a date is no longer a calendar date on the wire");
  return "yyyy-MM-dd";
}

/** A `DateOnly` expression → its wire text, culture-pinned so a non-Gregorian
 *  host calendar cannot respell it.  `culture` is the receiver's spelling of
 *  `CultureInfo.InvariantCulture` (the file may or may not import it). */
export function csCalendarDateWire(expr: string, culture: string = CULTURE): string {
  return `${expr}.ToString("${calendarDateFormat().replaceAll("-", "'-'")}", ${culture})`;
}

/** `DateOnly.ParseExact` over the wire text — EXACT, so a datetime-shaped value
 *  is refused rather than losing its time of day. */
export function csCalendarDateParseExact(expr: string, culture: string = CULTURE): string {
  return `DateOnly.ParseExact(${expr}, "${calendarDateFormat()}", ${culture})`;
}

/** `DateOnly.TryParseExact` over the wire text, for the request boundary. */
export function csCalendarDateTryParseExact(expr: string, outVar: string): string {
  return `DateOnly.TryParseExact(${expr}, "${calendarDateFormat()}", CultureInfo.InvariantCulture, DateTimeStyles.None, out var ${outVar})`;
}

// ---------------------------------------------------------------------------
// Lineage — a provenance lineage's `inputs[].value` / `computedValue`
// ---------------------------------------------------------------------------

/** The emitted `ProvWire` helper's name (Domain/Common/ProvLineage.cs). */
const CS_PROV_WIRE = "ProvWire";

/** The helper's method per wire form: the scalars whose C# domain value is NOT
 *  already its wire form.  A `decimal` is a `System.Decimal` (the wire is the
 *  RS-24 double), money a `System.Decimal` (the wire is the RS-12 string), a
 *  datetime a `DateTime` and a date a `DateOnly`.  Every other scalar's domain
 *  value serializes to its wire value. */
const LINEAGE_METHOD = {
  "fixed-scale-decimal": "Money",
  float64: "Decimal",
  instant: "Instant",
  "calendar-date": "Date",
} as const;

/** A value as it is written into a provenance lineage: a scalar in its wire
 *  encoding (`lineageUsesWire` — the fact's `RULINGS` and #3527).  The lineage
 *  is serialized with System.Text.Json, which writes a `System.Decimal` as an
 *  unscaled number and a `DateTime` with 7 fractional digits.  The helper takes
 *  a nullable, so it serves a plain and an optional value alike (an optional
 *  FIELD is a plain primitive type with `FieldIR.optional` set, which this
 *  type cannot see).  A non-scalar is recorded as the domain value it is. */
export function csLineageValue(expr: string, type: TypeIR | undefined): string {
  if (!type || !lineageUsesWire(type)) return expr;
  const form = scalarCodecOf(type)?.wire.form;
  const method = form === undefined ? undefined : (LINEAGE_METHOD as Record<string, string>)[form];
  return method === undefined ? expr : `${CS_PROV_WIRE}.${method}(${expr})`;
}

/** The body of the emitted `ProvWire` class: one method per wire form, each
 *  null-propagating, each spelled through the wire encoders the DTO mapper
 *  uses so the lineage and the wire cannot disagree. */
export function csProvWireClass(): string {
  return [
    "/// <summary>Writes a scalar into a provenance lineage in its WIRE encoding (the",
    "/// <c>Codec</c> fact's lineage rule): money as the fixed-scale string, a decimal as",
    "/// the double, a datetime as the canonical instant, a date as <c>YYYY-MM-DD</c>.",
    "/// Each takes a nullable so one overload serves a required and an optional",
    "/// value.</summary>",
    `public static class ${CS_PROV_WIRE}`,
    "{",
    `    public static string? Money(decimal? v) => v is null ? null : ${numericEncode(CS_NUMERIC, "money", "dto-map", "v.Value")};`,
    `    public static double? Decimal(decimal? v) => v is null ? null : ${csDecimalToWireDouble("v.Value")};`,
    `    public static string? Instant(DateTime? v) => v is null ? null : ${csInstantWire("v.Value")};`,
    `    public static string? Date(DateOnly? v) => v is null ? null : ${csCalendarDateWire("v.Value")};`,
    "}",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Channel envelope — the CloudEvents `time` and the datetimes of `data`
// ---------------------------------------------------------------------------

/** A `DateTime` expression as it is written inside a channel envelope — the
 *  RS-38 wire instant (the fact's `envelopeInstantWire`). */
export function csEnvelopeInstant(expr: string): string {
  // The fact rules the envelope instant to BE the wire instant; a fact that
  // ever split them would need a spelling of its own here.
  if (JSON.stringify(envelopeInstantWire()) !== JSON.stringify(instantWire()))
    throw new Error("codec-spelling: the envelope instant is no longer the wire instant");
  return csInstantWire(expr);
}
