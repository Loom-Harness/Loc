import type { PrimitiveName, TypeIR } from "../../ir/types/loom-ir.js";
import { MONEY_WIRE_SCALE } from "../money-scale.js";

// ---------------------------------------------------------------------------
// The numeric wire-codec DECISION TABLE (M-T9.36).
//
// Five PRs in four days (#2545, #2560, #2575 ×3, #2631) fixed the SAME defect
// at five different read paths: the number wire contract is one cross-cutting
// decision, implemented as many scattered per-backend, per-read-path
// coercions (docs/audits/numeric-types-audit-2026-08-23.md).  This module is
// the single statement of that decision — every backend's read-boundary
// emitter asks THIS, once, instead of re-deriving "is this money? then
// format 4dp" locally.
//
// The decision itself (RS-12 / RS-24, docs/conformance-semantics.md):
//   - `money`   → wire STRING at the fixed `MONEY_WIRE_SCALE` (4dp) — exact,
//                 because money can exceed float64's safe integer range.
//   - `decimal` → wire NUMBER (JSON float64) — lossy by design; the whole
//                 point of `money` existing is the case that can't afford
//                 this.
//   - `int` / `long` → wire NUMBER (JSON integer) — exact in every backend's
//                 native integral range.
//
// This is the GENERALIZATION of `aggregateCoercion`
// (src/ir/util/projection-aggregate.ts) — that function answers the same
// question for exactly one boundary (a query-time projection's aggregate
// `select`).  `aggregateCoercion` stays where it is (IR layer — `ir →
// generator` is the wrong direction for this module to depend on); this
// module is the GENERATOR-layer sibling every OTHER boundary consumes, and a
// backend that also touches an aggregate select is free to fold
// `aggregateCoercion`'s `isMoney`/`asString` bits through `numericKindOf` /
// `wireCodecFor` instead of re-deriving them.
// ---------------------------------------------------------------------------

/** The four numeric primitives the wire codec distinguishes.  `guid` is
 *  string-wire too but is not a NUMBER — it has no codec entry here (see
 *  `aggregateCoercion`'s separate `asString` arm, which folds `guid` in
 *  alongside `money` for exactly that reason). */
export type NumericKind = "money" | "decimal" | "int" | "long";

const NUMERIC_KINDS: ReadonlySet<PrimitiveName> = new Set<PrimitiveName>([
  "money",
  "decimal",
  "int",
  "long",
]);

/** Classify a (possibly `optional`-wrapped) `TypeIR` as a numeric codec kind,
 *  or `null` when it isn't one of the four — every other `TypeIR.kind`
 *  (`valueobject`, `array`, `id`, `enum`, …) and every other primitive
 *  (`string`, `bool`, `datetime`, `guid`, `json`, `File`, `duration`) fall
 *  through to `null`: this table only ever answers for the four kinds it
 *  owns. */
export function numericKindOf(t: TypeIR): NumericKind | null {
  const inner = t.kind === "optional" ? t.inner : t;
  if (inner.kind !== "primitive") return null;
  return NUMERIC_KINDS.has(inner.name) ? (inner.name as NumericKind) : null;
}

/** The wire FORM a numeric kind takes, independent of backend syntax. */
export interface WireCodec {
  /** `"string"` for money (RS-12, fixed-scale) — `"number"` for the other
   *  three (RS-24 for decimal; int/long are exact either way). */
  readonly wireForm: "string" | "number";
  /** Fixed fractional-digit count on the wire — money only. */
  readonly scale?: number;
}

/** THE decision table.  One row per `NumericKind`, referenced by every
 *  per-backend `NumericTarget` leaf table (`./target.ts`) and by
 *  `test/generator/_numeric/codec.test.ts`, which pins these exact values
 *  against `docs/conformance-semantics.md` RS-12/RS-24. */
export const NUMERIC_WIRE_CODEC: Readonly<Record<NumericKind, WireCodec>> = {
  money: { wireForm: "string", scale: MONEY_WIRE_SCALE },
  decimal: { wireForm: "number" },
  int: { wireForm: "number" },
  long: { wireForm: "number" },
};

/** The wire codec for one numeric kind — a lookup, not a computation, so a
 *  new numeric kind that forgets a row fails to type-check (`NumericKind` is
 *  a closed union and `NUMERIC_WIRE_CODEC` a total `Record` over it) rather
 *  than falling through silently. */
export function wireCodecFor(kind: NumericKind): WireCodec {
  return NUMERIC_WIRE_CODEC[kind];
}

// ---------------------------------------------------------------------------
// The EXACT RANGE of the two integral kinds (M-T5.23 / `D-LONG-AVG-DEFAULTS`).
//
// `int` persists as Postgres `integer` and publishes `format: int32` on every
// backend, so int32 is its range by construction — the same bound the node
// route layer already declares on an inbound `int` (`INT32_RANGE`) and python's
// `Int32` annotation carries (`Field(ge=…, le=…)`).
//
// `long` is the ruled one.  It persists as `bigint`, and .NET/java/elixir carry
// int64 exactly — but node stores it as a JS `number`
// (`bigint(col, { mode: "number" })`) and so cannot represent anything past
// 2^53−1.  `D-LONG-AVG-DEFAULTS` took option (a): DECLARE the safe-integer
// ceiling and enforce it on the paths that cannot hold more, rather than
// upgrade the representation (BigInt / string wire) for a bound nobody has hit.
// So the ceiling is the ONE number below, in ONE place, consumed by the
// emitters that enforce it — not re-typed per backend, the way
// `MONEY_WIRE_SCALE` governs both the money column and its wire form.
// ---------------------------------------------------------------------------

/** Inclusive bounds of a declared `int` — Postgres `integer` / `format: int32`. */
export const INT32_MIN = -2147483648;
export const INT32_MAX = 2147483647;

/** The declared ceiling of `long`: 2^53−1, the largest integer a JS `number`
 *  holds exactly (`Number.MAX_SAFE_INTEGER`).  Spelled as a literal rather
 *  than read off `Number` so the value that governs EMITTED source is a stated
 *  contract, not the generator host's runtime. */
export const LONG_SAFE_MAX = 9007199254740991;
export const LONG_SAFE_MIN = -9007199254740991;

/** The inclusive range a value of an integral kind must fall in to be carried
 *  exactly by every backend — the bound an integral READ refuses outside of,
 *  rather than silently narrowing (java's `intValue()` wrapped; node's
 *  `Number(...)` rounded). */
export function integralWireRange(kind: "int" | "long"): { min: number; max: number } {
  return kind === "int"
    ? { min: INT32_MIN, max: INT32_MAX }
    : { min: LONG_SAFE_MIN, max: LONG_SAFE_MAX };
}
