import type { InvariantIR } from "../../ir/types/loom-ir.js";
import type { SingleFieldPattern } from "../../ir/validate/invariant-classify.js";
import { takeSingleFieldChain } from "../zod-refine.js";

// ---------------------------------------------------------------------------
// Feliz client-side invariant validation (M-T1.16).
//
// The four static-bundle frontends fold an aggregate's wire-translatable
// `invariant`s into per-field rules — React/Vue/Svelte through the zod schema
// (`_frontend/zod-schemas.ts` + `zod-refine.ts`), Angular through
// `Validators.*` (`angular/form-validators.ts`).  Feliz had NEITHER: its
// `Validation` module only ever answered "is this cell empty" / "does this
// numeric cell's text parse", so `quantity: int  invariant positive { quantity
// >= 1 }` let `0` through to a server 422 while every other frontend caught it
// in the browser.  This module is the F# twin of `angularValidatorMap`.
//
// FIDELITY BY REUSE, not re-implementation: admission goes through the shared
// `takeSingleFieldChain` gate — the exact one the zod emitter and the Angular
// validator map use — so Feliz admits a constraint iff the other five
// frontends do.  Money / `now()` / conversions / cross-field rules never pass
// that gate and stay server-only here too.
//
// WHERE THE VALUES COME FROM.  Every Feliz form cell is a `string` (the input
// binding), and the encoder lifts it with F#'s `int` / `int64` / `decimal`
// conversions at submit time.  So a NUMERIC rule has to parse first, and does
// it with the same blank-tolerant `TryParse` shape `wire.ts`'s numeric guard
// already uses: an unparseable cell is the numeric guard's business (it has its
// own message), and a blank cell is the required guard's, so a rule that cannot
// read a number says nothing rather than shadowing a better message.  A LENGTH
// rule counts CODE POINTS, not UTF-16 units — the definition the server's JSON
// Schema `minLength`/`maxLength` publish and the one every other emitter uses
// (`_expr/code-point.ts`), so `"😀😀😀"` is 3 here as it is everywhere else.
// ---------------------------------------------------------------------------

/** One emitted rule: the F# predicate that means "this cell is WRONG", plus the
 *  message to show.  Kept as a pair (rather than a rendered `if`) so the caller
 *  can fold rules into both the whole-form `&&` guard and the per-field
 *  `string option` error function without re-deriving either. */
export interface FelizFieldRule {
  /** F# boolean expression, true when the cell VIOLATES the rule.  Reads the
   *  form cell through the `access` handed to {@link felizFieldRules}. */
  violated: string;
  /** The inline message — rule-specific, not the flat "Required" this
   *  frontend used to be limited to. */
  message: string;
}

/** F# code-point length of a string expression.  `Seq.length` over an F#
 *  `string` enumerates CHARS (UTF-16 units) under Fable, so surrogate pairs
 *  would count twice; `System.Globalization.StringInfo` is not in Fable's
 *  surface either.  The JS `[...s].length` spread IS the code-point count and
 *  is what `tsCodePointLength` emits for the JS frontends — reached here
 *  through the same `[<Emit>]` escape hatch `store-persist.ts` and `realtime.ts`
 *  use, so no new package reference. */
export const CODE_POINT_LEN_HELPER = [
  "  /// Code-point length (NOT UTF-16 units) — the definition the server's",
  "  /// JSON Schema minLength/maxLength publish, so a surrogate pair counts",
  "  /// once on both sides.",
  '  [<Fable.Core.Emit("[...$0].length")>]',
  "  let private cpLength (s: string) : int = jsNative",
  "",
];

/** The blank-tolerant numeric read a numeric rule guards on — mirrors
 *  `wire.ts`'s `isWholeText` / `isNumberText`, which answer the "does it
 *  parse" question this rule deliberately does not re-answer. */
function numericGuard(access: string, cmp: string, bound: number): string {
  // `match … with | true, v when <cmp> -> true | _ -> false` reads the cell as
  // a decimal regardless of integral/fractional: an `int` cell's text parses as
  // a decimal too, and the integral-ness is already the numeric guard's own
  // check, so one spelling covers both without a second helper.
  return `(match System.Decimal.TryParse ${access} with | true, v -> v ${cmp} ${bound}m | _ -> false)`;
}

/** `n` as an F# decimal literal — a bound is always a plain number here
 *  (`singleFieldShape` only ever yields numeric literals). */
function dec(n: number): string {
  return Number.isInteger(n) ? `${n}` : `${n}`;
}

/** Map one recognised single-field pattern onto its Feliz rule(s) — the direct
 *  twin of `validatorsForPattern` (Angular) and `chainSingleFieldNative` (zod).
 *  A `between` / length range expands to a low+high pair, mirroring the two
 *  chained zod calls. */
function rulesForPattern(p: SingleFieldPattern, access: string): FelizFieldRule[] {
  switch (p.kind) {
    case "min": {
      // `violated` is the NEGATION of the bound, so an unparseable / blank cell
      // (which `numericGuard` answers `false` for) is never reported here.
      const cmp = p.exclusive ? "<=" : "<";
      const word = p.exclusive ? "greater than" : "at least";
      return [{ violated: numericGuard(access, cmp, p.n), message: `Must be ${word} ${dec(p.n)}` }];
    }
    case "max": {
      const cmp = p.exclusive ? ">=" : ">";
      const word = p.exclusive ? "less than" : "at most";
      return [{ violated: numericGuard(access, cmp, p.n), message: `Must be ${word} ${dec(p.n)}` }];
    }
    case "between":
      return [
        {
          violated: `(${numericGuard(access, "<", p.lo)} || ${numericGuard(access, ">", p.hi)})`,
          message: `Must be between ${dec(p.lo)} and ${dec(p.hi)}`,
        },
      ];
    case "len-min":
      return [
        {
          violated: lengthViolation(access, "<", p.n),
          message: `Must be at least ${p.n} character${p.n === 1 ? "" : "s"}`,
        },
      ];
    case "len-max":
      return [
        {
          violated: lengthViolation(access, ">", p.n),
          message: `Must be at most ${p.n} character${p.n === 1 ? "" : "s"}`,
        },
      ];
    case "len-eq":
      return [
        {
          violated: `(not (System.String.IsNullOrEmpty ${access}) && cpLength ${access} <> ${p.n})`,
          message: `Must be exactly ${p.n} character${p.n === 1 ? "" : "s"}`,
        },
      ];
    case "len-range":
      return [
        {
          violated: `(${lengthViolation(access, "<", p.lo)} || ${lengthViolation(access, ">", p.hi)})`,
          message: `Must be between ${p.lo} and ${p.hi} characters`,
        },
      ];
    case "regex":
      // `System.Text.RegularExpressions.Regex` is Fable-supported and compiles
      // the pattern to a JS RegExp — the same engine the zod `.regex(…)` chain
      // runs, so an author's pattern behaves identically on both frontends.
      // The source is parse-time validated (`new RegExp`) before it reaches
      // here, and F# verbatim strings need no escaping beyond `"` doubling.
      return [
        {
          violated: `(not (System.String.IsNullOrEmpty ${access}) && not (System.Text.RegularExpressions.Regex.IsMatch(${access}, ${fsVerbatim(p.pattern)})))`,
          message: "Does not match the required format",
        },
      ];
  }
}

/** A length bound's violation, skipping the empty cell — emptiness is
 *  `Required`'s message, not a length rule's (the same empty-skip the Angular
 *  inline `ValidatorFn`s and zod's own chains perform). */
function lengthViolation(access: string, cmp: "<" | ">", n: number): string {
  return `(not (System.String.IsNullOrEmpty ${access}) && cpLength ${access} ${cmp} ${n})`;
}

/** An F# VERBATIM string literal (`@"…"`), in which the only escape is a
 *  doubled quote — so a regex source's backslashes survive intact. */
export function fsVerbatim(s: string): string {
  return `@"${s.replace(/"/g, '""')}"`;
}

/** The rules an aggregate's invariants imply for one form cell.  `available`
 *  is the form's own field set, so a constraint on a field the form does not
 *  carry is dropped (the shared gate's `ctx.available` check). */
export function felizFieldRules(
  invariants: readonly InvariantIR[],
  available: ReadonlySet<string>,
  accessFor: (field: string) => string,
): Map<string, FelizFieldRule[]> {
  const out = new Map<string, FelizFieldRule[]>();
  const ctx = { available };
  for (const inv of invariants) {
    const taken = takeSingleFieldChain(inv, ctx);
    if (!taken) continue;
    const rules = rulesForPattern(taken.pattern, accessFor(taken.field));
    if (rules.length === 0) continue;
    out.set(taken.field, [...(out.get(taken.field) ?? []), ...rules]);
  }
  return out;
}

/** True when any emitted rule spells `cpLength` — the gate for splicing
 *  {@link CODE_POINT_LEN_HELPER}, so a form with only numeric rules keeps its
 *  `Validation` module free of an unused binding (F# warns on those). */
export function rulesNeedCodePointLength(
  byField: ReadonlyMap<string, readonly FelizFieldRule[]>,
): boolean {
  for (const rules of byField.values()) {
    if (rules.some((r) => r.violated.includes("cpLength "))) return true;
  }
  return false;
}
