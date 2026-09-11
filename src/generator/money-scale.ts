// Canonical money wire/storage scale — the single source of truth every
// backend's money serialization derives from.
//
// `money` persists as `NUMERIC(19,4)` on every SQL backend (see
// `python/py-columns.ts`, `typescript/emit/schema.ts`, `typescript/emit/
// mikroorm.ts`), so the canonical WIRE representation of a money value is a
// decimal string at exactly `MONEY_WIRE_SCALE` fractional digits.  RS-12
// (`docs/conformance-semantics.md`) fixes this as the cross-backend contract:
// a money field reads back with the SAME scale on every backend's wire, rather
// than each backend's decimal library normalizing (node/decimal.js strips
// trailing zeros) or echoing the as-parsed input scale.  Formatting money to
// this fixed scale at the wire boundary is the one lossless choice that keeps
// the storage precision intact.

/** Fractional-digit count money carries on the wire (and in `NUMERIC(19,4)`). */
export const MONEY_WIRE_SCALE = 4;

/** Total significant digits of the money storage type (`NUMERIC(19,4)`). */
export const MONEY_PRECISION = 19;

/**
 * Integer digits `NUMERIC(19,4)` can hold — `MONEY_PRECISION - MONEY_WIRE_SCALE`.
 *
 * The RANGE half of the money wire contract, and the one nobody had derived.
 * M-T6.48 made a MALFORMED money value answer a typed 4xx on all five backends;
 * it did not make an OUT-OF-RANGE one do so, because a 40-digit decimal string
 * is perfectly well-formed.  decimal.js, `BigDecimal`, `Decimal` and a python
 * `str` passthrough all accept it, so the value sailed through the format guard,
 * reached `NUMERIC(19,4)`, and the DATABASE refused it — a 500 for a client
 * fault, which is exactly the shape M-T6.48 exists to remove, arriving one layer
 * later (M-T6.60 divergence 3).
 *
 * This is deliberately NOT a second format guard: the grammar is already
 * checked, and what is left is a magnitude question the COLUMN answers.  Deriving
 * the bound here means one constant governs the guard and the column, so a
 * future `NUMERIC(p,s)` change moves both together.
 */
export const MONEY_INTEGER_DIGITS = MONEY_PRECISION - MONEY_WIRE_SCALE;

/** The exclusive magnitude bound, as a decimal literal: `|value|` must be
 *  strictly less than this for the value to fit `NUMERIC(19,4)`. */
export const MONEY_MAX_EXCLUSIVE = `1${"0".repeat(MONEY_INTEGER_DIGITS)}`;

/** The refusal message every backend renders for an out-of-range money value.
 *
 *  One text, because the wire-golden differential compares bodies ACROSS
 *  backends — a divergent message is a real divergence.  Shaped like the
 *  format guard's `Invalid decimal: "12,50"` so a client sees one family of
 *  wire refusals rather than two. */
export const MONEY_RANGE_MESSAGE = "Money out of range";

/** Money zero ON THE WIRE — `"0.0000"`, not `"0"`.
 *
 *  A SQL aggregate over an empty table is `NULL`, and a non-optional declared
 *  field means that as zero (see `AggregateCoercion`).  That zero is still a
 *  money value, so it carries the same fixed scale as every other money string
 *  the backend sends; shipping a bare `"0"` there made the empty read disagree
 *  with the populated one on its own backend (#2549). */
export const MONEY_WIRE_ZERO = `0.${"0".repeat(MONEY_WIRE_SCALE)}`;
