// ---------------------------------------------------------------------------
// M-T9.43 — the EVALUATED value table for the backend expression renderers.
//
// Each backend's `render-expr-kinds.test.ts` pins, per `ExprIR.kind` arm, the
// STRING its leaf table renders — four copies of one arm list, each asserting
// a different spelling of the same meaning.  That covers the shared dispatcher
// (`src/generator/_expr/target.ts`) on SYNTAX and not at all on AGREEMENT: two
// backends can render an arm that compiles on both and evaluates differently,
// and every string test stays green (RS-11 — three backends agreed, all three
// were wrong).
//
// This table is the other half: one list of `(ExprIR, parameters, expected
// VALUE)` rows.  `expr-value.test.ts` renders every row through each backend's
// REAL renderer, runs the rendered expression in that backend's own language,
// and compares the value — so a spelling change that keeps the value is not a
// failure, and a value change that keeps a plausible spelling IS.
//
// The rows are the semantics; the leaf tables are the implementations under
// test.  A LEGITIMATE divergence is a named row (`expectedBy`), never a skipped
// one.  Per-arm and shallow by design: the behavioural tier owns the deep
// cases (M-T9.13).
// ---------------------------------------------------------------------------

import type { ExprIR, TypeIR } from "../../../src/ir/types/loom-ir.js";

/** The scalar/collection parameter types a row can bind. */
export type ValueType = "int" | "decimal" | "money" | "string" | "bool" | "int[]" | "money[]";

/** A canonical value, compared as TEXT after each harness normalises its own
 *  result: integers as base-10 digits, `decimal`/`money` as the shortest exact
 *  decimal (trailing zeros stripped, so `3.50` and `3.5` agree — scale is a
 *  wire concern the goldens own), strings JSON-quoted, bools `true`/`false`,
 *  lists as `[a,b]` of the canonical elements. */
export interface Expected {
  readonly kind: "int" | "decimal" | "money" | "string" | "bool" | "int[]";
  readonly value: string;
}

export interface ValueRow {
  /** Stable id — also the generated function name, so `[a-z0-9_]` only. */
  readonly id: string;
  /** The `ExprIR.kind` arm (or intrinsic) this row exercises. */
  readonly arm: string;
  readonly expr: ExprIR;
  /** Parameter name → (type, canonical input).  Names are single lowercase
   *  words so no backend's casing fold (snake/camel/Pascal) moves them. */
  readonly params: Readonly<Record<string, { type: ValueType; value: string }>>;
  readonly expected: Expected;
  /** Why the row exists — the defect class it would catch. */
  readonly why: string;
  /** A NAMED divergence: the backends whose answer differs from `expected`,
   *  what they answer, and why that is either sanctioned by the contract or
   *  handed off.  The harness asserts the RECORDED value, so the entry
   *  ratchets: a backend that changes its answer (fixed or otherwise) fails
   *  here until the entry is updated or deleted. */
  readonly divergesOn?: Readonly<Partial<Record<ValueBackend, { value: string; reason: string }>>>;
}

/** The backends the harness can evaluate. */
export type ValueBackend = "node" | "python" | "java" | "dotnet";

const T = (name: "int" | "decimal" | "money" | "string" | "bool"): TypeIR => ({
  kind: "primitive",
  name,
});
const INT = T("int");
const DEC = T("decimal");
const MONEY = T("money");
const STR = T("string");
const BOOL = T("bool");
const INT_ARR: TypeIR = { kind: "array", element: INT };
const MONEY_ARR: TypeIR = { kind: "array", element: MONEY };

const p = (name: string, type: TypeIR): ExprIR => ({ kind: "ref", name, refKind: "param", type });
const litInt = (v: string): ExprIR => ({ kind: "literal", lit: "int", value: v });
const litStr = (v: string): ExprIR => ({ kind: "literal", lit: "string", value: v });
const bin = (
  op: string,
  left: ExprIR,
  right: ExprIR,
  leftType: TypeIR,
  rightType: TypeIR,
  resultType: TypeIR,
): ExprIR => ({ kind: "binary", op, left, right, leftType, rightType, resultType }) as ExprIR;
const call = (receiver: ExprIR, member: string, args: ExprIR[], receiverType: TypeIR): ExprIR =>
  ({ kind: "method-call", receiver, member, args, receiverType, isCollectionOp: false }) as ExprIR;
const coll = (receiver: ExprIR, member: string, args: ExprIR[], receiverType: TypeIR): ExprIR =>
  ({ kind: "method-call", receiver, member, args, receiverType, isCollectionOp: true }) as ExprIR;
const lam = (param: string, body: ExprIR): ExprIR => ({ kind: "lambda", param, body }) as ExprIR;
const lref = (name: string, type: TypeIR): ExprIR =>
  ({ kind: "ref", name, refKind: "lambda", type }) as ExprIR;

const a = p("a", INT);
const b = p("b", INT);
const m = p("m", MONEY);
const n = p("n", MONEY);
const s = p("s", STR);
const t = p("t", STR);
const f = p("f", BOOL);
const xs = p("xs", INT_ARR);
const ms = p("ms", MONEY_ARR);

export const VALUE_ROWS: readonly ValueRow[] = [
  // ── integer arithmetic ────────────────────────────────────────────────────
  {
    id: "int_add",
    arm: "binary +",
    expr: bin("+", a, b, INT, INT, INT),
    params: { a: { type: "int", value: "7" }, b: { type: "int", value: "5" } },
    expected: { kind: "int", value: "12" },
    why: "the baseline every other row stands on",
  },
  {
    id: "int_sub_negative",
    arm: "binary -",
    expr: bin("-", a, b, INT, INT, INT),
    params: { a: { type: "int", value: "2" }, b: { type: "int", value: "5" } },
    expected: { kind: "int", value: "-3" },
    why: "a negative result",
  },
  {
    id: "int_mul",
    arm: "binary *",
    expr: bin("*", a, b, INT, INT, INT),
    params: { a: { type: "int", value: "6" }, b: { type: "int", value: "7" } },
    expected: { kind: "int", value: "42" },
    why: "operator table sanity",
  },
  {
    id: "int_div_widens",
    arm: "binary / (int/int → decimal, A1)",
    expr: bin("/", a, b, INT, INT, DEC),
    params: { a: { type: "int", value: "7" }, b: { type: "int", value: "2" } },
    expected: { kind: "decimal", value: "3.5" },
    why: "int/int WIDENS to decimal — a native integer `/` answers 3 and still compiles on four backends",
  },
  {
    id: "int_div_widens_negative",
    arm: "binary / (int/int → decimal, A1)",
    expr: bin("/", a, b, INT, INT, DEC),
    params: { a: { type: "int", value: "-7" }, b: { type: "int", value: "2" } },
    expected: { kind: "decimal", value: "-3.5" },
    why: "the widening on a negative dividend",
  },
  {
    id: "div_trunc_negative",
    arm: "intrinsic int.divTrunc",
    expr: call(a, "divTrunc", [b], INT),
    params: { a: { type: "int", value: "-7" }, b: { type: "int", value: "2" } },
    expected: { kind: "int", value: "-3" },
    why: "TRUNCATING integer division — a FLOORED spelling (python `//`) answers -4, a float one -3.5",
  },
  {
    id: "mod_negative",
    arm: "binary %",
    expr: bin("%", a, b, INT, INT, INT),
    params: { a: { type: "int", value: "-5" }, b: { type: "int", value: "3" } },
    expected: { kind: "int", value: "-2" },
    why: "remainder takes the DIVIDEND's sign on every backend — python's native `%` answers 1",
  },
  {
    id: "int_negate",
    arm: "unary - (int)",
    expr: { kind: "unary", op: "-", operand: a } as ExprIR,
    params: { a: { type: "int", value: "4" } },
    expected: { kind: "int", value: "-4" },
    why: "native negation",
  },
  {
    id: "int_sum",
    arm: "collection sum (int)",
    expr: coll(xs, "sum", [], INT_ARR),
    params: { xs: { type: "int[]", value: "[4,5,6]" } },
    expected: { kind: "int", value: "15" },
    why: "an integral fold",
  },
  // ── comparison + logic ────────────────────────────────────────────────────
  {
    id: "int_le_equal",
    arm: "binary <=",
    expr: bin("<=", a, b, INT, INT, BOOL),
    params: { a: { type: "int", value: "3" }, b: { type: "int", value: "3" } },
    expected: { kind: "bool", value: "true" },
    why: "the inclusive bound — a `<` answers false",
  },
  {
    id: "string_eq_distinct_instances",
    arm: "binary == (string)",
    expr: bin("==", s, bin("+", t, litStr("c"), STR, STR, STR), STR, STR, BOOL),
    params: { s: { type: "string", value: '"abc"' }, t: { type: "string", value: '"ab"' } },
    expected: { kind: "bool", value: "true" },
    why: "string equality is by VALUE — a reference `==` on a freshly concatenated string answers false (java)",
  },
  {
    id: "and_false",
    arm: "binary &&",
    expr: bin(
      "&&",
      bin(">", a, litInt("1"), INT, INT, BOOL),
      bin("<", b, litInt("1"), INT, INT, BOOL),
      BOOL,
      BOOL,
      BOOL,
    ),
    params: { a: { type: "int", value: "2" }, b: { type: "int", value: "5" } },
    expected: { kind: "bool", value: "false" },
    why: "`&&` with one false side — an `||` in the leaf table answers true",
  },
  {
    id: "or_true",
    arm: "binary ||",
    expr: bin(
      "||",
      bin(">", a, litInt("1"), INT, INT, BOOL),
      bin("<", b, litInt("1"), INT, INT, BOOL),
      BOOL,
      BOOL,
      BOOL,
    ),
    params: { a: { type: "int", value: "2" }, b: { type: "int", value: "5" } },
    expected: { kind: "bool", value: "true" },
    why: "the `||` twin",
  },
  {
    id: "not_bool",
    arm: "unary !",
    expr: { kind: "unary", op: "!", operand: f } as ExprIR,
    params: { f: { type: "bool", value: "true" } },
    expected: { kind: "bool", value: "false" },
    why: "negation",
  },
  {
    id: "int_neq",
    arm: "binary !=",
    expr: bin("!=", a, b, INT, INT, BOOL),
    params: { a: { type: "int", value: "3" }, b: { type: "int", value: "3" } },
    expected: { kind: "bool", value: "false" },
    why: "inequality on equal operands",
  },
  // ── money: exact, scale-insensitive equality ──────────────────────────────
  {
    id: "money_add_exact",
    arm: "binary + (money)",
    expr: bin("+", m, n, MONEY, MONEY, MONEY),
    params: { m: { type: "money", value: "0.10" }, n: { type: "money", value: "0.20" } },
    expected: { kind: "money", value: "0.3" },
    why: "money is EXACT — a float `+` answers 0.30000000000000004",
  },
  {
    id: "money_times_int",
    arm: "binary * (money × int)",
    expr: bin("*", m, a, MONEY, INT, MONEY),
    params: { m: { type: "money", value: "19.99" }, a: { type: "int", value: "3" } },
    expected: { kind: "money", value: "59.97" },
    why: "money × int stays exact",
  },
  {
    id: "int_times_money_mirror",
    arm: "binary * (int × money, M-T6.44 mirror arm)",
    expr: bin("*", a, m, INT, MONEY, MONEY),
    params: { a: { type: "int", value: "3" }, m: { type: "money", value: "19.99" } },
    expected: { kind: "money", value: "59.97" },
    why: "money on the RIGHT — the arm that used to fall through to a native `*`",
  },
  {
    id: "money_eq_across_scale",
    arm: "binary == (money)",
    expr: bin("==", m, n, MONEY, MONEY, BOOL),
    params: { m: { type: "money", value: "1.0" }, n: { type: "money", value: "1.00" } },
    expected: { kind: "bool", value: "true" },
    why: "money equality is VALUE equality — `BigDecimal.equals` / a string compare is scale-sensitive and answers false",
  },
  {
    id: "money_sub",
    arm: "binary - (money)",
    expr: bin("-", m, n, MONEY, MONEY, MONEY),
    params: { m: { type: "money", value: "1.00" }, n: { type: "money", value: "0.90" } },
    expected: { kind: "money", value: "0.1" },
    why: "exact subtraction — floats answer 0.09999999999999998",
  },
  {
    id: "money_div_int",
    arm: "binary / (money ÷ non-literal int, A4)",
    expr: bin("/", m, a, MONEY, INT, MONEY),
    params: { m: { type: "money", value: "10.00" }, a: { type: "int", value: "4" } },
    expected: { kind: "money", value: "2.5" },
    why: "money divided by an int PARAMETER — the operand that has no BigDecimal overload unless boxed",
  },
  {
    id: "money_lt_int",
    arm: "binary < (money vs int)",
    expr: bin("<", m, a, MONEY, INT, BOOL),
    params: { m: { type: "money", value: "2.50" }, a: { type: "int", value: "3" } },
    expected: { kind: "bool", value: "true" },
    why: "a mixed money/int comparison",
  },
  {
    id: "money_gte_equal",
    arm: "binary >= (money)",
    expr: bin(">=", m, n, MONEY, MONEY, BOOL),
    params: { m: { type: "money", value: "5.0" }, n: { type: "money", value: "5.00" } },
    expected: { kind: "bool", value: "true" },
    why: "an inclusive bound across scales",
  },
  {
    id: "decimal_mod_negative",
    arm: "binary % (decimal)",
    expr: bin("%", p("d", DEC), p("e", DEC), DEC, DEC, DEC),
    params: { d: { type: "decimal", value: "-5.5" }, e: { type: "decimal", value: "2" } },
    expected: { kind: "decimal", value: "-1.5" },
    why: "a decimal remainder keeps the dividend's sign — a floored `%` answers 0.5",
  },
  {
    id: "money_gt",
    arm: "binary > (money)",
    expr: bin(">", m, n, MONEY, MONEY, BOOL),
    params: { m: { type: "money", value: "10.00" }, n: { type: "money", value: "9.99" } },
    expected: { kind: "bool", value: "true" },
    why: "ordering on money — a lexicographic compare answers false",
  },
  {
    id: "money_negate",
    arm: "unary - (money, A11)",
    expr: { kind: "unary", op: "-", operand: m } as ExprIR,
    params: { m: { type: "money", value: "2.50" } },
    expected: { kind: "money", value: "-2.5" },
    why: "negation on a decimal type",
  },
  // ── strings ───────────────────────────────────────────────────────────────
  {
    id: "string_concat",
    arm: "binary + (string)",
    expr: bin("+", s, t, STR, STR, STR),
    params: { s: { type: "string", value: '"ab"' }, t: { type: "string", value: '"cd"' } },
    expected: { kind: "string", value: '"abcd"' },
    why: "concatenation, not numeric addition",
  },
  {
    id: "string_length_astral",
    arm: "member string.length",
    expr: {
      kind: "member",
      receiver: s,
      member: "length",
      receiverType: STR,
      memberType: INT,
    } as ExprIR,
    params: { s: { type: "string", value: '"a\\ud83d\\ude00"' } },
    expected: { kind: "int", value: "2" },
    why: "length counts CODE POINTS — UTF-16 units answer 3",
  },
  {
    id: "string_trim",
    arm: "intrinsic string.trim",
    expr: call(s, "trim", [], STR),
    params: { s: { type: "string", value: '"  x y  "' } },
    expected: { kind: "string", value: '"x y"' },
    why: "both ends, interior kept",
  },
  {
    id: "string_upper",
    arm: "intrinsic string.toUpper",
    expr: call(s, "toUpper", [], STR),
    params: { s: { type: "string", value: '"abc"' } },
    expected: { kind: "string", value: '"ABC"' },
    why: "case mapping",
  },
  {
    id: "string_lower",
    arm: "intrinsic string.toLower",
    expr: call(s, "toLower", [], STR),
    params: { s: { type: "string", value: '"AbC"' } },
    expected: { kind: "string", value: '"abc"' },
    why: "case mapping, the other direction",
  },
  {
    id: "string_substring_from",
    arm: "intrinsic string.substring (one argument)",
    expr: call(s, "substring", [litInt("2")], STR),
    params: { s: { type: "string", value: '"abcdef"' } },
    expected: { kind: "string", value: '"cdef"' },
    why: "an omitted length runs to the end",
  },
  {
    id: "string_substring_clamps",
    arm: "intrinsic string.substring (clamping)",
    expr: call(s, "substring", [litInt("1"), litInt("10")], STR),
    params: { s: { type: "string", value: '"abc"' } },
    expected: { kind: "string", value: '"bc"' },
    why: "a length past the end TRUNCATES — a raw `Substring(start, len)` throws",
  },
  {
    id: "string_substring_start_past_end",
    arm: "intrinsic string.substring (clamping)",
    expr: call(s, "substring", [litInt("5"), litInt("2")], STR),
    params: { s: { type: "string", value: '"abc"' } },
    expected: { kind: "string", value: '""' },
    why: "an out-of-range start yields the empty string, not an exception",
  },
  {
    id: "string_contains",
    arm: "intrinsic string.contains",
    expr: call(s, "contains", [litStr("ell")], STR),
    params: { s: { type: "string", value: '"hello"' } },
    expected: { kind: "bool", value: "true" },
    why: "substring membership",
  },
  {
    id: "string_of_int",
    arm: "convert string(int)",
    expr: { kind: "convert", target: "string", from: "int", value: a } as ExprIR,
    params: { a: { type: "int", value: "-42" } },
    expected: { kind: "string", value: '"-42"' },
    why: "culture-invariant integer formatting",
  },
  {
    id: "string_substring_astral",
    arm: "intrinsic string.substring",
    expr: call(s, "substring", [litInt("1"), litInt("2")], STR),
    params: { s: { type: "string", value: '"a\\ud83d\\ude00bc"' } },
    expected: { kind: "string", value: '"\\ud83d\\ude00"' },
    why: "the catalogue (`src/util/intrinsics.ts`) pins `substring` to JS `slice` semantics, i.e. UTF-16 units — so the astral character is TWO positions wide",
    divergesOn: {
      python: {
        value: '"\\ud83d\\ude00b"',
        reason:
          "python slices CODE POINTS, so the same call answers one character more.  Every backend's `length` counts code points (row `string_length_astral`), so the catalogue's unit for `substring` disagrees with its own `length` — handed off (wave-c3-3d-promote.md, D10) for a decision on which unit is the contract",
      },
    },
  },
  {
    id: "string_upper_eszett",
    arm: "intrinsic string.toUpper",
    expr: call(s, "toUpper", [], STR),
    params: { s: { type: "string", value: '"stra\\u00dfe"' } },
    expected: { kind: "string", value: '"STRASSE"' },
    why: "full Unicode case mapping — a per-char simple mapping leaves `ß` unchanged",
    divergesOn: {
      dotnet: {
        value: '"STRA\\u00dfE"',
        reason:
          "`ToUpperInvariant()` is a simple (1:1) mapping and keeps `ß`.  The catalogue sanctions 'the platform's default (invariant-leaning) mapping', so this is a NAMED divergence, not a defect — recorded so a change in either direction is seen (D11 asks whether the contract should say so explicitly)",
      },
    },
  },
  // ── rounding ──────────────────────────────────────────────────────────────
  {
    id: "money_round_half_negative",
    arm: "intrinsic money.round",
    expr: call(m, "round", [litInt("1")], MONEY),
    params: { m: { type: "money", value: "-2.25" } },
    expected: { kind: "money", value: "-2.3" },
    why: "HALF-AWAY-FROM-ZERO on a negative midpoint — banker's rounding answers -2.2",
  },
  {
    id: "decimal_round_half_up",
    arm: "intrinsic decimal.round",
    expr: call(p("d", DEC), "round", [litInt("2")], DEC),
    params: { d: { type: "decimal", value: "2.675" } },
    expected: { kind: "decimal", value: "2.68" },
    why: "the catalogue's half-away-from-zero on a value binary floating point cannot hold exactly",
  },
  {
    id: "money_floor_negative",
    arm: "intrinsic money.floor",
    expr: call(m, "floor", [], MONEY),
    params: { m: { type: "money", value: "-2.5" } },
    expected: { kind: "money", value: "-3" },
    why: "floor goes toward −∞ — a truncation answers -2",
  },
  // ── control ───────────────────────────────────────────────────────────────
  {
    id: "ternary_else",
    arm: "ternary",
    expr: {
      kind: "ternary",
      cond: bin(">", a, litInt("0"), INT, INT, BOOL),
      // biome-ignore lint/suspicious/noThenProperty: the ternary IR node's branch field is named `then`
      then: litStr("pos"),
      otherwise: litStr("neg"),
    } as ExprIR,
    params: { a: { type: "int", value: "-1" } },
    expected: { kind: "string", value: '"neg"' },
    why: "the false branch",
  },
  {
    id: "match_second_arm",
    arm: "match (right-folded)",
    expr: {
      kind: "match",
      variantArms: [],
      arms: [
        { cond: bin(">", a, litInt("10"), INT, INT, BOOL), value: litStr("big") },
        { cond: bin(">", a, litInt("0"), INT, INT, BOOL), value: litStr("small") },
      ],
      otherwise: litStr("none"),
    } as ExprIR,
    params: { a: { type: "int", value: "5" } },
    expected: { kind: "string", value: '"small"' },
    why: "arm ORDER — a fold that tries the arms back-to-front answers a different arm on overlapping conditions",
  },
  // ── collections ───────────────────────────────────────────────────────────
  {
    id: "coll_count_where",
    arm: "collection where + count",
    expr: {
      kind: "member",
      receiver: coll(
        xs,
        "where",
        [lam("x", bin(">", lref("x", INT), litInt("1"), INT, INT, BOOL))],
        INT_ARR,
      ),
      member: "count",
      receiverType: INT_ARR,
      memberType: INT,
    } as ExprIR,
    params: { xs: { type: "int[]", value: "[1,2,3]" } },
    expected: { kind: "int", value: "2" },
    why: "filter then count",
  },
  {
    id: "coll_first_where",
    arm: "collection where + first",
    expr: coll(
      coll(xs, "where", [lam("x", bin(">", lref("x", INT), litInt("1"), INT, INT, BOOL))], INT_ARR),
      "first",
      [],
      INT_ARR,
    ),
    params: { xs: { type: "int[]", value: "[1,5,7]" } },
    expected: { kind: "int", value: "5" },
    why: "the FIRST match in source order — not the last, not the smallest",
  },
  {
    id: "coll_sum_money",
    arm: "collection sum (money)",
    expr: coll(ms, "sum", [], MONEY_ARR),
    params: { ms: { type: "money[]", value: "[0.10,0.20,0.30]" } },
    expected: { kind: "money", value: "0.6" },
    why: "a money fold stays exact — a float fold answers 0.6000000000000001",
  },
];
