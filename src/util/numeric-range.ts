// The EXACT RANGE of Loom's two integral primitives — one statement of the
// contract, consumed from BOTH sides of the pipeline (M-T5.23 /
// `D-LONG-AVG-DEFAULTS`).
//
// It lives in `src/util/` for the layering reason CLAUDE.md states: a helper
// consumed across layers belongs at the layer its consumers live at.  The
// AST validator (`src/language/validators/numeric-literals.ts`, phase ④) and
// the read-boundary emitters (`src/generator/_numeric/**` and the five
// backends) both need the same numbers, and `language → generator` is the
// wrong direction for an import.
//
// `int` persists as Postgres `integer` and publishes `format: int32` on every
// backend, so int32 is its range by construction — the same bound the node
// route layer declares on an inbound `int` (`INT32_RANGE`) and python's `Int32`
// annotation carries (`Field(ge=…, le=…)`).
//
// `long` is the RULED one.  It persists as `bigint`, and .NET/java/elixir carry
// int64 exactly — but node stores it as a JS `number`
// (`bigint(col, { mode: "number" })`), so it cannot represent anything past
// 2^53−1.  `D-LONG-AVG-DEFAULTS` took option (a): DECLARE the safe-integer
// ceiling and enforce it, rather than upgrade the representation (BigInt /
// string wire) for a bound nobody has hit.  Hence ONE ceiling here, the way
// `MONEY_WIRE_SCALE` governs both the money column and its wire form.

/** Inclusive bounds of a declared `int` — Postgres `integer` / `format: int32`. */
export const INT32_MIN = -2147483648;
export const INT32_MAX = 2147483647;

/** The declared ceiling of `long`: 2^53−1, the largest integer a JS `number`
 *  holds exactly (`Number.MAX_SAFE_INTEGER`).  Spelled as a literal rather than
 *  read off `Number` so the value that governs EMITTED source and the validator
 *  is a stated contract, not the generator host's runtime. */
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

/** Whether an integer is inside the declared `long` ceiling — the one predicate
 *  the literal gate and the wire guards share. */
export function isExactInteger(value: number): boolean {
  return Number.isInteger(value) && value >= LONG_SAFE_MIN && value <= LONG_SAFE_MAX;
}
