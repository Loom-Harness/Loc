// The node/TypeScript SPELLING of the IR `Codec` fact (`src/ir/enrich/codec.ts`).
//
// The fact decides how a scalar is written on the wire, stored in a column and
// held in memory; this file only says how TypeScript, drizzle, MikroORM and zod
// write that decision down.  Every node emitter (the Hono builders under
// `src/platform/hono/` and the shared emitters under `src/generator/typescript/`)
// asks here, or `numeric-codec.ts` for the read-boundary numeric leaves, instead
// of choosing an encoding itself — `test/generator/hono/codec-census.test.ts`
// fails on a column factory, a scale, a range bound or an ISO-8601 trim chosen
// anywhere else.

import {
  type CodecPrimitive,
  idColumn,
  instantWire,
  integerWire,
  lineageUsesWire,
  moneyIntegerDigits,
  scalarCodec,
  scalarCodecOf,
} from "../../ir/enrich/codec.js";
import type { IdValueType, TypeIR } from "../../ir/types/loom-ir.js";
import type { ColumnType } from "../../ir/types/migrations-ir.js";
import { numericEncode } from "../_numeric/target.js";
import { TS_NUMERIC } from "./numeric-codec.js";

// ---------------------------------------------------------------------------
// Columns — drizzle and MikroORM
// ---------------------------------------------------------------------------

/** The drizzle column factory call for a scalar column of this codec column
 *  type.  A `bigint` is read in `number` mode (the fact's `long` ceiling is
 *  2^53−1); a `date` in `string` mode, so the column's `YYYY-MM-DD` never
 *  becomes a JS `Date` at the host's local midnight (a server west of UTC would
 *  read the previous day back). */
function drizzleColumn(c: ColumnType, colName: string): string {
  const name = JSON.stringify(colName);
  switch (c.kind) {
    case "int":
      return `integer(${name})`;
    case "bigint":
      return `bigint(${name}, { mode: "number" })`;
    case "decimal":
      return c.precision !== undefined && c.scale !== undefined
        ? `numeric(${name}, { precision: ${c.precision}, scale: ${c.scale} })`
        : `numeric(${name})`;
    case "text":
      return `text(${name})`;
    case "bool":
      return `boolean(${name})`;
    case "date":
      return `date(${name}, { mode: "string" })`;
    case "datetime":
      return `timestamp(${name}, { withTimezone: true })`;
    case "uuid":
      return `uuid(${name})`;
    case "json":
      return `jsonb(${name})`;
    case "bigserial":
    case "array":
      throw new Error(`codec-spelling: '${c.kind}' is not a scalar column`);
  }
}

/** The drizzle column for a declared scalar field. */
export function drizzleScalarColumn(name: CodecPrimitive, colName: string): string {
  return drizzleColumn(scalarCodec(name).column, colName);
}

/** The drizzle column for an id-shaped column (aggregate PK, `X id` reference,
 *  containment / join-table FK, workflow correlation key) — the same Postgres
 *  type the migration builder creates for it. */
export function drizzleIdColumn(valueType: IdValueType, colName: string): string {
  return drizzleColumn(idColumn(valueType), colName);
}

/** MikroORM's property type, the row's TS type, and the explicit `columnType`
 *  where MikroORM's own default would differ from the fact's column. */
export interface MikroScalar {
  mikro: string;
  ts: string;
  columnType?: string;
}

/** The MikroORM mapping for a declared scalar.
 *
 *  A `decimal` pins `columnType` because MikroORM's bare `type: "decimal"`
 *  DEFAULTS to `numeric(10,0)`, which rounds every fractional value to an
 *  integer on store (9.99 → 10).
 *
 *  `File` is a `json` column in the fact, but this adapter maps it to a plain
 *  string; kept as-is (see the census waiver) until the adapter is moved. */
export function mikroScalar(name: CodecPrimitive): MikroScalar {
  if (name === "string" || name === "File") return { mikro: "string", ts: "string" };
  const c = scalarCodec(name).column;
  switch (c.kind) {
    case "int":
      return { mikro: "integer", ts: "number" };
    case "bigint":
      return { mikro: "bigint", ts: "number" };
    case "decimal":
      return {
        mikro: "decimal",
        ts: "string",
        columnType:
          c.precision !== undefined && c.scale !== undefined
            ? `numeric(${c.precision},${c.scale})`
            : "numeric",
      };
    case "bool":
      return { mikro: "boolean", ts: "boolean" };
    case "date":
      // MikroORM's `date` type hydrates the column as its `YYYY-MM-DD` text.
      return { mikro: "date", ts: "string" };
    case "datetime":
      return { mikro: "datetime", ts: "Date" };
    case "uuid":
      return { mikro: "uuid", ts: "string" };
    case "json":
      return { mikro: "json", ts: "unknown" };
    default:
      return { mikro: "string", ts: "string" };
  }
}

// ---------------------------------------------------------------------------
// Wire — datetime, date, money ingress, integer ranges
// ---------------------------------------------------------------------------

/** A `Date` expression → the canonical `datetime` wire string (RS-4 + RS-38).
 *
 *  `Date.toISOString()` emits exactly three fractional digits, and a JS `Date`
 *  is millisecond-resolution by construction, so the only rewrite the fact's
 *  "no fraction on a whole second" leaves is the all-zero group.  A fact that
 *  asked for any other digit count could not be spelled this way, so it
 *  throws rather than emit the wrong form. */
export function tsInstantWire(dateExpr: string): string {
  const w = instantWire();
  if (w.fractionDigits !== 3)
    throw new Error("codec-spelling: a JS Date carries exactly three fraction digits");
  return `${dateExpr}.toISOString().replace(/\\.${"0".repeat(w.fractionDigits)}Z$/, "Z")`;
}

/** Today's UTC calendar date as its `YYYY-MM-DD` wire string. */
export function tsTodayCalendarDate(): string {
  return "new Date().toISOString().slice(0, 10)";
}

/** The money ingress grammar as a JS regex literal.  `\d` is ASCII-only in a
 *  JS regex without the `u`/`v` flag, so this is the fact's
 *  `^-?[0-9]+(\.[0-9]+)?$` (pinned by `codec-spelling.test.ts`). */
export const TS_MONEY_GRAMMAR = "/^-?\\d+(\\.\\d+)?$/";

/** Integer digits a money wire string may carry before the field refuses it. */
export function tsMoneyIntegerDigits(): number {
  return moneyIntegerDigits();
}

/** The money column's SQL type, `NUMERIC(19,4)`, for prose in emitted code. */
export function tsMoneyColumnLabel(): string {
  const c = scalarCodec("money").column;
  return c.kind === "decimal" ? `NUMERIC(${c.precision},${c.scale})` : "NUMERIC";
}

/** The inclusive range of an integral scalar, for a zod bound or a read guard. */
export function tsIntegerRange(name: "int" | "long"): { min: number; max: number } {
  const { min, max } = integerWire(name);
  return { min, max };
}

// ---------------------------------------------------------------------------
// Lineage — a provenance lineage's `inputs[].value` / `computedValue`
// ---------------------------------------------------------------------------

/** A value as it is written into a provenance lineage.  Where the fact rules
 *  the lineage encoding to be the wire encoding (`lineageUsesWire` — `money`'s
 *  RS-12 string, #3527), the value goes through the same encoder the wire
 *  does.  Every other type is recorded as the domain value it is.  Without
 *  this, `JSON.stringify` writes a decimal.js money as an unscaled
 *  `"1050.105"`. */
export function tsLineageValue(expr: string, type: TypeIR | undefined): string {
  if (!type || !lineageUsesWire(type)) return expr;
  if (scalarCodecOf(type)?.wire.form !== "fixed-scale-decimal") return expr;
  // Guarded even for a non-optional type: an optional FIELD is a plain
  // primitive type with `FieldIR.optional` set, which this type cannot see.
  return `(${expr} == null ? null : ${numericEncode(TS_NUMERIC, "money", "dto-map", expr)})`;
}
