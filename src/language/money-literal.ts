// The `money("10.50")` LITERAL, told apart from the `money(someDecimal)`
// CONVERSION — after the parse, not during it.
//
// Both spellings reach the parser as one `PrimitiveConversion` node
// (`target='money'`), because they have to: a `STRING` is also an
// `Expression`, so a grammar carrying a separate
// `MoneyLit: 'money' '(' STRING ')'` alternative alongside
// `PrimitiveConversion: target=(… | 'money') '(' Expression ')'` is ambiguous
// by construction and no amount of alternative ORDERING fixes it.  Ordering
// settled which alternative WON, which is why the parse result was always
// right; it did not stop Chevrotain's ALL(*) analysis from reporting the
// ambiguity to stderr on the first input that reached the alternation — four
// lines of parser-generator internals above a clean `0 error(s)` on the repo's
// own shipped examples (audit #2864 § Papercuts / M-T9.60).
//
// So the two forms are now separated HERE, by the shape of the argument, and
// this module is the one place that decides.  Three callers, one rule:
//
//   * `checkSinglePrimitiveConversion` (AST validation) — the literal is
//     validated as a decimal string, NOT run through the conversion table
//     (which admits `money ← {int, long, decimal}` and would reject a string).
//   * `typeOf` / `inferExprType` — both forms are `money`, so neither needs a
//     special case; the type is `target`.
//   * `lowerExprInner` — the literal lowers to `lit("money", text)`, the
//     conversion to `{ kind: "convert", target: "money" }`.  Byte-identical to
//     what the two-rule grammar lowered to, so no IR consumer sees the change.

import { type Expression, isPrimitiveConversion, isStringLit } from "./generated/ast.js";

/**
 * The decimal text of a `money("…")` literal, or `undefined` when `expr` is
 * anything else — including `money(x)` for a non-string `x` (that is the
 * conversion form) and `string(…)` / `decimal(…)` / `long(…)`.
 *
 * `STRING` arrives delimiter-stripped from Langium, so the returned text is
 * the raw `10.50`, not `"10.50"`.  A half-typed literal (`money()`, no value)
 * yields `undefined` and is left to the parse error that already covers it.
 */
export function moneyLiteralText(expr: Expression | undefined): string | undefined {
  if (!expr || !isPrimitiveConversion(expr)) return undefined;
  if (expr.target !== "money") return undefined;
  const arg = expr.value;
  if (!arg || !isStringLit(arg)) return undefined;
  return arg.value;
}

/** True when `expr` is the `money("…")` literal form. */
export function isMoneyLiteral(expr: Expression | undefined): boolean {
  return moneyLiteralText(expr) !== undefined;
}

/**
 * Whether a money literal's string argument is a well-formed precise decimal.
 *
 * The value is handed verbatim to each backend's precise-decimal constructor
 * (`new Decimal(...)`, `System.Decimal.Parse`, `Decimal.new/1`,
 * `BigDecimal`, Python's `Decimal`), so a non-numeric string is not a Loom
 * error today — it is a THROW inside generated code, on five backends, at
 * whatever moment the literal is first evaluated.  Optional sign, digits, and
 * an optional fractional part in either order (`.5` and `5.` both parse in
 * every target's decimal type); no exponent, no thousands separators, no
 * currency symbol.
 */
export function isWellFormedMoneyLiteral(text: string): boolean {
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text);
}
