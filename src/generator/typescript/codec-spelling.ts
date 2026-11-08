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
  envelopeInstantWire,
  idColumn,
  instantWire,
  integerWire,
  lineageUsesWire,
  moneyIntegerDigits,
  scalarCodec,
  scalarCodecOf,
} from "../../ir/enrich/codec.js";
import type { TypeIR } from "../../ir/types/loom-ir.js";
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
export function drizzleIdColumn(colName: string): string {
  return drizzleColumn(idColumn(), colName);
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
 *  string — a divergence kept byte-identical here, to be fixed in the adapter. */
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

/** A value as it is written into a provenance lineage: a scalar in its wire
 *  encoding (`lineageUsesWire` — the fact's `RULINGS` and #3527).  Two node
 *  values do not serialize to it on their own: a decimal.js money, which
 *  `JSON.stringify` writes unscaled (`"1050.105"`), and a `Date`, which it
 *  writes with `toISOString()`'s `.000Z` on a whole second.  Every other
 *  scalar's in-memory value already IS its wire form (a `decimal` is a JS
 *  number, a `date` its `YYYY-MM-DD` string).  A non-scalar is recorded as the
 *  domain value it is. */
export function tsLineageValue(expr: string, type: TypeIR | undefined): string {
  if (!type || !lineageUsesWire(type)) return expr;
  const form = scalarCodecOf(type)?.wire.form;
  const encoded =
    form === "fixed-scale-decimal"
      ? numericEncode(TS_NUMERIC, "money", "dto-map", expr)
      : form === "instant"
        ? tsInstantWire(expr)
        : undefined;
  // Guarded even for a non-optional type: an optional FIELD is a plain
  // primitive type with `FieldIR.optional` set, which this type cannot see.
  return encoded === undefined ? expr : `(${expr} == null ? null : ${encoded})`;
}

/** A `Date` expression as it is written inside a channel (CloudEvents)
 *  envelope — the RS-38 wire instant (the fact's `envelopeInstantWire`). */
export function tsEnvelopeInstant(dateExpr: string): string {
  // The fact rules the envelope instant to BE the wire instant; a fact that
  // ever split them would need a spelling of its own here.
  if (JSON.stringify(envelopeInstantWire()) !== JSON.stringify(instantWire()))
    throw new Error("codec-spelling: the envelope instant is no longer the wire instant");
  return tsInstantWire(dateExpr);
}

/** The served-spec shape of a `File` field: the named `FileRef` component every
 *  backend publishes (dotnet / java / python reference it too), never an
 *  anonymous inline object. */
export const FILE_REF_ZOD =
  'z.object({ url: z.string(), key: z.string(), contentType: z.string(), size: z.number().int() }).openapi("FileRef")';
