// Phase ⑥ representation fact — `Codec`: how a value of a declared type is
// written on the wire, stored in a column, held in memory and recorded in a
// provenance lineage.
//
// Every backend has to answer the same four questions for every scalar:
//
//   1. WIRE   — which JSON type carries it, and in which spelling (`money` is a
//               fixed-scale-4 decimal STRING, `decimal` a float64 NUMBER, a
//               `datetime` ISO-8601 UTC at millisecond precision, …);
//   2. COLUMN — the neutral column type the shared migrations create
//               (`NUMERIC(19,4)` for money, `timestamptz` for a datetime, …);
//   3. MEMORY — what the in-memory value must hold exactly, and whether its
//               arithmetic must be exact decimal;
//   4. LINEAGE — how the value is written into a provenance lineage's
//               `inputs[].value` / `computedValue` (provenance.md).
//
// Those answers are the cross-backend contract (RS-4, RS-12, RS-24, RS-37,
// RS-38, RS-42 in docs/conformance-semantics.md, plus the owner ruling on #3527
// that money in a lineage is the money wire string).  They are NOT a backend's
// choice, so they live here once and backends supply only the spelling — the
// drizzle column factory, the `.toFixed(4)`, the `isoformat(...)`.
//
// The fact is DERIVED, never stamped (CLAUDE.md "Derive, don't stamp"): the
// scalar table below is a closed function of the primitive name, and
// `codecOf` is a pure function of a `TypeIR` (plus a value-object lookup), so
// it is computed on demand and cannot go stale against the IR it reads.
//
// What this table does NOT rule is listed in `UNRULED` — places the backends
// disagree and no golden or RS-rule pins the answer.  Each is an owner
// question; until it is answered no backend may be moved onto a value for it.

import {
  INT32_MAX,
  INT32_MIN,
  INTEGER_RANGE_MESSAGE,
  LONG_SAFE_MAX,
  LONG_SAFE_MIN,
} from "../../util/numeric-range.js";
import type { IdValueType, PrimitiveName, TypeIR, ValueObjectIR } from "../types/loom-ir.js";
import type { ColumnType } from "../types/migrations-ir.js";

// ---------------------------------------------------------------------------
// Money's fixed shape — the one place the scale and precision are chosen
// ---------------------------------------------------------------------------

/** Fractional digits a `money` value carries on the wire and in its column
 *  (RS-12).  `src/generator/money-scale.ts` re-exports it for the emitters. */
export const MONEY_SCALE = 4;

/** Total significant digits of the `money` column — `NUMERIC(19,4)`. */
export const MONEY_PRECISION = 19;

/** The grammar a `money` wire string must match (RS-42): ASCII digits, an
 *  optional leading `-` and an optional fraction — no grouping, exponent,
 *  leading `+` or surrounding whitespace, so `"12,50"` is never 1250. */
export const MONEY_WIRE_GRAMMAR = "^-?[0-9]+(\\.[0-9]+)?$";

// ---------------------------------------------------------------------------
// The scalar codec
// ---------------------------------------------------------------------------

/** The primitives that can be stored and cross the wire.  `duration` is
 *  expression-only (never a field, param or column), so it has no codec. */
export type CodecPrimitive = Exclude<PrimitiveName, "duration">;

/** How a scalar crosses the wire, in both directions.
 *
 *   - `fixed-scale-decimal` — a JSON string `-?d+.dddd` at exactly `scale`
 *     fractional digits on egress; ingress accepts `grammar` (any scale) and
 *     refuses a JSON number (D-NUMERIC-INGRESS-STRICT).
 *   - `float64`             — a JSON number, narrowed to an IEEE-754 double at
 *     the response boundary (RS-24); the request side keeps the wide type.
 *   - `integer`             — a JSON integer inside `[min, max]`; outside it is
 *     refused at the field with `rangeMessage` (RS-42).
 *   - `instant`             — ISO-8601 UTC with a `Z`: exactly
 *     `fractionDigits` fractional digits when the instant has a sub-second
 *     part, none on a whole second; extra input precision is TRUNCATED at
 *     ingress, never rounded (RS-4, RS-38).
 *   - `calendar-date`       — `YYYY-MM-DD`, no zone, no time of day.
 *   - `uuid` / `text` / `boolean` / `json` / `file-ref` — the obvious JSON
 *     form; `file-ref` is the fixed `{ url, key, contentType, size }` object. */
export type WireEncoding =
  | { form: "fixed-scale-decimal"; json: "string"; scale: number; grammar: string }
  | { form: "float64"; json: "number" }
  | { form: "integer"; json: "number"; min: number; max: number; rangeMessage: string }
  | {
      form: "instant";
      json: "string";
      fractionDigits: number;
      wholeSecond: "no-fraction";
      ingressExcess: "truncate";
    }
  | { form: "calendar-date"; json: "string" }
  | { form: "uuid"; json: "string" }
  | { form: "text"; json: "string" }
  | { form: "boolean"; json: "boolean" }
  | { form: "json"; json: "any" }
  | { form: "file-ref"; json: "object" };

/** What an in-memory value of a scalar must be able to hold exactly.
 *
 *  `holds` is the minimum: a backend may hold more (java's `BigDecimal` for a
 *  `decimal`), never less.  `exactArithmetic` is RS-37 (decimal) and RS-12
 *  (money) — arithmetic in a decimal type, never binary floating point, even
 *  where the held value is a double (node and python narrow ONCE, at the root
 *  of the chain). */
export interface MemoryHint {
  holds:
    | "int32"
    | "int53"
    | "float64"
    | "exact-decimal"
    | "instant-ms"
    | "calendar-date"
    | "uuid"
    | "text"
    | "bool"
    | "json"
    | "file-ref";
  exactArithmetic: boolean;
}

/** How a scalar is written into a provenance lineage (`inputs[].value`,
 *  `computedValue`).
 *
 *   - `wire`    — exactly its wire encoding.  Ruled for `money` (#3527, owner
 *                 2026-10-21: the RS-12 string, on all five backends) and
 *                 pinned for `int` by the `provenance` wire golden.
 *   - `unruled` — no ruling and no golden; see `UNRULED`.  A backend keeps
 *                 what it does today. */
export type LineageEncoding = "wire" | "unruled";

export interface ScalarCodec {
  primitive: CodecPrimitive;
  wire: WireEncoding;
  column: ColumnType;
  memory: MemoryHint;
  lineage: LineageEncoding;
}

const SCALARS: Readonly<Record<CodecPrimitive, ScalarCodec>> = {
  int: {
    primitive: "int",
    wire: {
      form: "integer",
      json: "number",
      min: INT32_MIN,
      max: INT32_MAX,
      rangeMessage: INTEGER_RANGE_MESSAGE,
    },
    column: { kind: "int" },
    memory: { holds: "int32", exactArithmetic: true },
    lineage: "wire",
  },
  long: {
    primitive: "long",
    // D-LONG-AVG-DEFAULTS: the declared ceiling is 2^53−1 (node holds a JS
    // number); the column is still `bigint`.
    wire: {
      form: "integer",
      json: "number",
      min: LONG_SAFE_MIN,
      max: LONG_SAFE_MAX,
      rangeMessage: INTEGER_RANGE_MESSAGE,
    },
    column: { kind: "bigint" },
    memory: { holds: "int53", exactArithmetic: true },
    lineage: "wire",
  },
  decimal: {
    primitive: "decimal",
    wire: { form: "float64", json: "number" },
    // Unbounded: a plain `decimal` has no declared scale.
    column: { kind: "decimal" },
    memory: { holds: "float64", exactArithmetic: true },
    lineage: "unruled",
  },
  money: {
    primitive: "money",
    wire: {
      form: "fixed-scale-decimal",
      json: "string",
      scale: MONEY_SCALE,
      grammar: MONEY_WIRE_GRAMMAR,
    },
    column: { kind: "decimal", precision: MONEY_PRECISION, scale: MONEY_SCALE },
    memory: { holds: "exact-decimal", exactArithmetic: true },
    lineage: "wire",
  },
  string: {
    primitive: "string",
    wire: { form: "text", json: "string" },
    column: { kind: "text" },
    memory: { holds: "text", exactArithmetic: false },
    lineage: "unruled",
  },
  bool: {
    primitive: "bool",
    wire: { form: "boolean", json: "boolean" },
    column: { kind: "bool" },
    memory: { holds: "bool", exactArithmetic: false },
    lineage: "unruled",
  },
  date: {
    primitive: "date",
    wire: { form: "calendar-date", json: "string" },
    // Postgres `date` round-trips `YYYY-MM-DD` exactly — no zone, so a value
    // read west of UTC never shifts a day.
    column: { kind: "date" },
    memory: { holds: "calendar-date", exactArithmetic: false },
    lineage: "unruled",
  },
  datetime: {
    primitive: "datetime",
    wire: {
      form: "instant",
      json: "string",
      fractionDigits: 3,
      wholeSecond: "no-fraction",
      ingressExcess: "truncate",
    },
    column: { kind: "datetime" },
    memory: { holds: "instant-ms", exactArithmetic: false },
    lineage: "unruled",
  },
  guid: {
    primitive: "guid",
    wire: { form: "uuid", json: "string" },
    column: { kind: "uuid" },
    memory: { holds: "uuid", exactArithmetic: false },
    lineage: "unruled",
  },
  json: {
    primitive: "json",
    wire: { form: "json", json: "any" },
    column: { kind: "json" },
    memory: { holds: "json", exactArithmetic: false },
    lineage: "unruled",
  },
  File: {
    primitive: "File",
    // The bytes live in object storage; the column carries the reference.
    wire: { form: "file-ref", json: "object" },
    column: { kind: "json" },
    memory: { holds: "file-ref", exactArithmetic: false },
    lineage: "unruled",
  },
};

/** The codec of one storable primitive.  Throws for `duration`, which is
 *  expression-only and never reaches a column, the wire or a lineage. */
export function scalarCodec(name: PrimitiveName): ScalarCodec {
  if (name === "duration") throw new Error("codec: 'duration' is expression-only and has no codec");
  return SCALARS[name];
}

type WireOf<F extends WireEncoding["form"]> = Extract<WireEncoding, { form: F }>;

function wireOf<F extends WireEncoding["form"]>(name: CodecPrimitive, form: F): WireOf<F> {
  const w = SCALARS[name].wire;
  if (w.form !== form) throw new Error(`codec: '${name}' is not a ${form} on the wire`);
  return w as WireOf<F>;
}

/** `money`'s wire encoding — the fixed scale and the ingress grammar. */
export function moneyWire(): WireOf<"fixed-scale-decimal"> {
  return wireOf("money", "fixed-scale-decimal");
}

/** Integer digits the `money` column holds — precision minus scale.  A wire
 *  string with more is refused at the field (`money-range`), not by the
 *  database. */
export function moneyIntegerDigits(): number {
  const c = SCALARS.money.column;
  if (c.kind !== "decimal" || c.precision === undefined || c.scale === undefined)
    throw new Error("codec: the money column is not a bounded decimal");
  return c.precision - c.scale;
}

/** The inclusive wire range of an integral scalar and the sentence a value
 *  outside it is refused with (RS-42). */
export function integerWire(name: "int" | "long"): WireOf<"integer"> {
  return wireOf(name, "integer");
}

/** `datetime`'s wire encoding — fraction digits and the whole-second form. */
export function instantWire(): WireOf<"instant"> {
  return wireOf("datetime", "instant");
}

/** Every storable primitive's codec, in table order — for tests and for an
 *  emitter that builds a per-primitive spelling table. */
export function allScalarCodecs(): readonly ScalarCodec[] {
  return Object.values(SCALARS);
}

/** The scalar an `X id` of this value type is carried as. */
export function idScalar(valueType: IdValueType): CodecPrimitive {
  return valueType === "string" ? "string" : valueType;
}

/** The column an `X id` / primary key of this value type is stored in.  Not
 *  `scalarCodec(idScalar(v)).column`: the two agree today, and are named
 *  separately so a key column can change (a `bigserial`) without touching the
 *  scalar. */
export function idColumn(valueType: IdValueType): ColumnType {
  return scalarCodec(idScalar(valueType)).column;
}

// ---------------------------------------------------------------------------
// Codec of a declared type
// ---------------------------------------------------------------------------

/** How a value object is stored: as one row's flattened `<field>_<member>`
 *  leaf columns (a single relational field), or as one JSON value (an element
 *  of a collection, a member of a `shape: document` aggregate, an event
 *  payload).  Its wire form is the same either way: a JSON object of its
 *  members' codecs, in declaration order. */
export type ValueObjectStorage = "flattened-columns" | "json";

export type Codec =
  | { kind: "scalar"; scalar: ScalarCodec }
  | { kind: "id"; target: string; scalar: ScalarCodec }
  | { kind: "enum"; name: string; scalar: ScalarCodec }
  | {
      kind: "valueobject";
      name: string;
      members: readonly { name: string; codec: Codec; optional: boolean }[];
    }
  | { kind: "array"; element: Codec }
  | { kind: "optional"; inner: Codec }
  /** A type with no codec of its own: an entity part, a union, a generic
   *  carrier, or a value object the lookup could not resolve.  Its encoding
   *  is still each backend's — not yet a fact. */
  | { kind: "opaque"; reason: string };

/** Resolve a value object by name (the enclosing context's pool). */
export type ValueObjectLookup = (name: string) => ValueObjectIR | undefined;

/** The codec of a declared type.  `lookupVo` resolves value-object members;
 *  without it a value object is `opaque`. */
export function codecOf(t: TypeIR, lookupVo?: ValueObjectLookup): Codec {
  return codecOfAt(t, lookupVo, new Set());
}

function codecOfAt(t: TypeIR, lookupVo: ValueObjectLookup | undefined, seen: Set<string>): Codec {
  switch (t.kind) {
    case "primitive":
      return t.name === "duration"
        ? { kind: "opaque", reason: "duration is expression-only" }
        : { kind: "scalar", scalar: scalarCodec(t.name) };
    case "id":
      return { kind: "id", target: t.targetName, scalar: scalarCodec(idScalar(t.valueType)) };
    case "enum":
      return { kind: "enum", name: t.name, scalar: scalarCodec("string") };
    case "optional":
      return { kind: "optional", inner: codecOfAt(t.inner, lookupVo, seen) };
    case "array":
      return { kind: "array", element: codecOfAt(t.element, lookupVo, seen) };
    case "valueobject": {
      const vo = lookupVo?.(t.name);
      if (!vo || seen.has(t.name))
        return { kind: "opaque", reason: `value object '${t.name}' is not resolvable here` };
      const inner = new Set(seen).add(t.name);
      return {
        kind: "valueobject",
        name: t.name,
        members: vo.fields.map((f) => ({
          name: f.name,
          codec: codecOfAt(f.type, lookupVo, inner),
          optional: f.optional || f.type.kind === "optional",
        })),
      };
    }
    default:
      return { kind: "opaque", reason: `'${t.kind}' has no codec yet` };
  }
}

/** The scalar codec under any number of `optional` wrappers, or undefined when
 *  the type is not a scalar (an id, enum, value object, collection, …). */
export function scalarCodecOf(t: TypeIR): ScalarCodec | undefined {
  const inner = t.kind === "optional" ? t.inner : t;
  return inner.kind === "primitive" && inner.name !== "duration"
    ? scalarCodec(inner.name)
    : undefined;
}

/** How a value object is stored in a given position. */
export function valueObjectStorage(position: "field" | "element" | "document"): ValueObjectStorage {
  return position === "field" ? "flattened-columns" : "json";
}

// ---------------------------------------------------------------------------
// Lineage
// ---------------------------------------------------------------------------

/** Whether a value of this type is written into a provenance lineage in its
 *  WIRE encoding — true only for a scalar whose `lineage` is ruled `wire`.  A
 *  backend applies its wire encoder there; everywhere else it keeps what it
 *  does today (see `UNRULED`). */
export function lineageUsesWire(t: TypeIR): boolean {
  return scalarCodecOf(t)?.lineage === "wire";
}

// ---------------------------------------------------------------------------
// What the fact does not rule
// ---------------------------------------------------------------------------

/** Encodings where the backends disagree and no RS-rule, golden or ruling
 *  pins the answer.  Each is an owner question.  `codec.test.ts` keeps this
 *  list in step with the table: an entry here must name a codec field that is
 *  still `unruled`, or a surface the table does not cover. */
export const UNRULED: readonly { surface: string; question: string }[] = [
  {
    surface: "lineage: datetime",
    question:
      "A datetime in a provenance lineage: node writes `toISOString()` (`.000Z` on a whole second); is it the RS-38 wire form?",
  },
  {
    surface: "lineage: decimal",
    question:
      "A decimal in a provenance lineage: node/java/.NET a JSON number, elixir a Decimal string; is it the RS-24 float64 number?",
  },
  {
    surface: "column: value object in a relational field",
    question:
      "A value-object field: node/.NET/java/python flatten it to `<field>_<member>` columns, elixir regroups the same MigrationsIR columns into one `:map`; which storage is canonical?",
  },
  {
    surface: "channel envelope: datetime",
    question:
      "The broker / realtime envelope spells a datetime per backend (python `isoformat()`, elixir `to_iso8601`, node bare `toISOString()`); does RS-38 extend to it?",
  },
];
