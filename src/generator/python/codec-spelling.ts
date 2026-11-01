// The python/FastAPI SPELLING of the IR `Codec` fact (`src/ir/enrich/codec.ts`).
//
// The fact decides how a scalar is written on the wire, stored in a column,
// recorded in a provenance lineage and carried inside a channel envelope; this
// file only says how Python, SQLAlchemy and pydantic write that decision down.
// Every python emitter asks here, or `numeric-codec.ts` for the read-boundary
// numeric leaves, instead of choosing an encoding itself —
// `test/generator/python/codec-census.test.ts` fails on a column type, a
// scale, a range bound or an ISO-8601 spelling chosen anywhere else.

import {
  type CodecPrimitive,
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
import { pyRef } from "../_imports/python.js";
import { numericEncode } from "../_numeric/target.js";
import { PY_CALENDAR_DATE_NAME } from "./emit/calendar-date.js";
import { PY_NUMERIC } from "./numeric-codec.js";

/** The runtime wire helper every generated project carries (`app/db/wire.py`,
 *  `WIRE_PY` in `index.ts`). */
const ISO = pyRef("app.db.wire", "iso");

// ---------------------------------------------------------------------------
// Columns — SQLAlchemy
// ---------------------------------------------------------------------------

/** The SQLAlchemy column type expression for a codec column type — the same
 *  Postgres type the shared migration creates.  A `uuid` maps with
 *  `as_uuid=False`, so the python side holds the id as a `str`. */
function pySaColumnType(c: ColumnType): string {
  switch (c.kind) {
    case "int":
      return "Integer";
    case "bigint":
      return "BigInteger";
    case "decimal":
      return c.precision !== undefined && c.scale !== undefined
        ? `Numeric(${c.precision}, ${c.scale})`
        : "Numeric";
    case "text":
      return "Text";
    case "bool":
      return "Boolean";
    case "date":
      return "Date";
    case "datetime":
      return "DateTime(timezone=True)";
    case "uuid":
      return "Uuid(as_uuid=False)";
    case "json":
      return "JSONB";
    case "bigserial":
    case "array":
      throw new Error(`codec-spelling: '${c.kind}' is not a scalar column`);
  }
}

/** The row model's python type and SQLAlchemy column for a declared scalar.
 *  A `decimal` column hydrates as a `Decimal` (the domain narrows it to a
 *  float at `repo-read`); a `File` is its `FileRef` dict over the fact's JSON
 *  column. */
export function pyScalarColumn(name: CodecPrimitive): { pyType: string; saType: string } {
  const saType = pySaColumnType(scalarCodec(name).column);
  return { pyType: PY_SCALAR_ROW_TYPE[name], saType };
}

const PY_SCALAR_ROW_TYPE: Readonly<Record<CodecPrimitive, string>> = {
  int: "int",
  long: "int",
  decimal: "Decimal",
  money: "Decimal",
  string: "str",
  bool: "bool",
  date: PY_CALENDAR_DATE_NAME,
  datetime: "datetime",
  guid: "str",
  json: "object",
  File: "FileRef",
};

/** The column of an id-shaped value (aggregate PK, `X id`, part / join FK):
 *  python stores every id as a `guid`'s column. */
export function pyIdColumnType(): string {
  return pySaColumnType(scalarCodec("guid").column);
}

/** The column of a framework `datetime` (an audit or provenance row's `at`). */
export function pyInstantColumnType(): string {
  return pySaColumnType(scalarCodec("datetime").column);
}

/** The column of an `int` (a value-collection row's `ordinal`). */
export function pyIntColumnType(): string {
  return pySaColumnType(scalarCodec("int").column);
}

// ---------------------------------------------------------------------------
// Wire — datetime, date, money, integer ranges
// ---------------------------------------------------------------------------

/** A `datetime` expression → its RS-4 + RS-38 wire string, through the
 *  runtime `iso` helper. */
function pyInstantWire(expr: string): string {
  return `${ISO}(${expr})`;
}

/** A `date` expression → its `YYYY-MM-DD` wire string. */
export function pyCalendarDateWire(expr: string): string {
  if (scalarCodec("date").wire.form !== "calendar-date")
    throw new Error("codec-spelling: a date is no longer a calendar date on the wire");
  return `${expr}.isoformat()`;
}

/** The body of the runtime `iso` helper (`app/db/wire.py`).  A python
 *  `datetime` is microsecond-resolution, so the fact's "three digits, none on a
 *  whole second, truncated" is `timespec="milliseconds"` (which truncates) plus
 *  a whole-second branch below one millisecond.  A fact asking for any other
 *  digit count could not be spelled this way, so it throws. */
export function pyIsoHelperBody(): string {
  const w = instantWire();
  if (w.fractionDigits !== 3 || w.ingressExcess !== "truncate" || w.wholeSecond !== "no-fraction")
    throw new Error("codec-spelling: python's iso() spells a truncated millisecond instant");
  return [
    "    utc = dt.astimezone(UTC)",
    "    if utc.microsecond < 1000:",
    '        return utc.replace(microsecond=0).isoformat().replace("+00:00", "Z")',
    '    return utc.isoformat(timespec="milliseconds").replace("+00:00", "Z")',
  ].join("\n");
}

/** `money_str`'s quantum — `1e-<scale>` — for the runtime helper. */
export function pyMoneyQuantum(): string {
  return `1e-${moneyWire().scale}`;
}

/** The money ingress grammar as a python raw-string regex for `re.match`: the
 *  fact's own `^-?[0-9]+(\.[0-9]+)?$`, with two python-specific spellings.
 *  It keeps `[0-9]`, never `\d`, because a python `str` pattern's `\d` also
 *  matches non-ASCII digits (`"١٢"`), which `Decimal` accepts as 12.  And the
 *  closing `$` becomes `\Z`, because python's `$` also matches before a
 *  trailing newline, so `"12\n"` would pass and `Decimal` would strip it. */
export function pyMoneyGrammar(): string {
  const g = moneyWire().grammar;
  if (!g.endsWith("$")) throw new Error("codec-spelling: the money grammar is not end-anchored");
  return `r"${g.slice(0, -1)}\\Z"`;
}

/** Integer digits a money wire string may carry before the field refuses it. */
export function pyMoneyIntegerDigits(): number {
  return moneyIntegerDigits();
}

/** The money column's SQL type, `NUMERIC(19,4)`, for prose in emitted code. */
export function pyMoneyColumnLabel(): string {
  const c = scalarCodec("money").column;
  return c.kind === "decimal" ? `NUMERIC(${c.precision},${c.scale})` : "NUMERIC";
}

/** The inclusive range of an integral scalar, for a pydantic check. */
export function pyIntegerRange(name: "int" | "long"): { min: number; max: number } {
  const { min, max } = integerWire(name);
  return { min, max };
}

/** A domain scalar → its wire value, for the scalars whose python domain value
 *  is NOT already its wire form: money (a `Decimal`), datetime and date.
 *  Undefined for every other scalar — its domain value is the wire value (a
 *  `decimal` is a `float`, the RS-24 number; a `guid` a `str`). */
function scalarWire(expr: string, name: CodecPrimitive): string | undefined {
  switch (scalarCodec(name).wire.form) {
    case "fixed-scale-decimal":
      return numericEncode(PY_NUMERIC, "money", "dto-map", expr);
    case "instant":
      return pyInstantWire(expr);
    case "calendar-date":
      return pyCalendarDateWire(expr);
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Lineage — a provenance lineage's `inputs[].value` / `computedValue`
// ---------------------------------------------------------------------------

/** A value as it is written into a provenance lineage: a scalar in its wire
 *  encoding (`lineageUsesWire` — the fact's `RULINGS` and #3527).  The lineage
 *  is bound to a JSONB column through `json.dumps`, which refuses a `Decimal`,
 *  a `datetime` and a `date` outright — so without this a provenanced write
 *  of any of them answers 500.  A non-scalar is recorded as the domain value
 *  it is. */
export function pyLineageValue(expr: string, type: TypeIR | undefined): string {
  if (!type || !lineageUsesWire(type)) return expr;
  const codec = scalarCodecOf(type);
  const encoded = codec ? scalarWire(expr, codec.primitive) : undefined;
  // Guarded even for a non-optional type: an optional FIELD is a plain
  // primitive type with `FieldIR.optional` set, which this type cannot see.
  return encoded === undefined ? expr : `(None if ${expr} is None else ${encoded})`;
}

// ---------------------------------------------------------------------------
// Channel envelope — the CloudEvents `time` and the datetimes of `data`
// ---------------------------------------------------------------------------

/** A `datetime` expression as it is written inside a channel envelope or a
 *  realtime frame — the RS-38 wire instant (the fact's `envelopeInstantWire`). */
export function pyEnvelopeInstant(expr: string): string {
  // The fact rules the envelope instant to BE the wire instant; a fact that
  // ever split them would need a spelling of its own here.
  if (JSON.stringify(envelopeInstantWire()) !== JSON.stringify(instantWire()))
    throw new Error("codec-spelling: the envelope instant is no longer the wire instant");
  return pyInstantWire(expr);
}
