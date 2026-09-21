import type { InvariantIR } from "../../ir/types/loom-ir.js";
import type { SingleFieldPattern } from "../../ir/validate/invariant-classify.js";
import { singleFieldMessage, takeSingleFieldChain } from "../zod-refine.js";

// ---------------------------------------------------------------------------
// Flutter form-validator derivation — the Dart twin of
// `src/generator/angular/form-validators.ts`.
//
// Ledger row `M-T1.16-invariant-validation-feliz-flutter` (P2, SILENT): the
// four static-bundle frontends fold an aggregate's wire-translatable
// `invariant`s into per-field client rules — `_frontend/zod-schemas.ts` via
// `zod-refine.ts` on react/vue/svelte, `angular/form-validators.ts` via
// `Validators.*` on Angular.  Flutter had NO equivalent: every
// `TextFormField` on a generated Loom form validated emptiness and
// number-parseability and nothing else, so a `price >= 1` violation reached
// the user only as a 422 from the server, with no `loom.*` code marking the
// divergence.
//
// Fidelity is by REUSE, not re-implementation, on both halves:
//   • WHICH rules translate — `takeSingleFieldChain`, the exact gate the zod
//     and Angular paths call, so Flutter admits a constraint iff they do.
//     Money / `now()` / conversions / cross-field rules never pass it and stay
//     server-only here too.
//   • WHAT the denial SAYS — `singleFieldMessage`, the same sentence builder
//     the zod native chain uses, so "Priority must be at least 1" is one
//     string across five frontends instead of five near-misses.
//
// One deliberate divergence from Angular: when the author wrote `message
// "…"` on the invariant, that text wins over the derived sentence.  On
// react/vue/svelte a messaged single-field rule contributes BOTH the native
// chain (derived text) and a surviving `.refine(…)` carrying the authored text
// — so the authored sentence IS what a JSX user sees.  Angular drops it; using
// it here moves Flutter towards react's user-visible behaviour, not away.
// ---------------------------------------------------------------------------

/** One derived client-side rule, in terms of a Dart expression over a local
 *  already bound to the field's value. */
export interface FlutterFieldRule {
  /** How the value has to be read to run the test. */
  on: "text" | "number";
  /** A Dart boolean expression that is TRUE when the rule is VIOLATED, over
   *  `s` (the trimmed `String`) for `on: "text"` or `n` (the parsed `num`) for
   *  `on: "number"`. */
  violated: string;
  /** The sentence shown when it is. */
  message: string;
}

/** Dart string-literal escaping for a validator message (single-quoted). */
function dartStr(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\$/g, "\\$");
}

/** A Dart `RegExp(...)` construction for a JS-compatible regex source.
 *
 *  Prefers a RAW string (`r'…'`) — backslashes and `$` are literal there, which
 *  is what a regex source wants.  A source containing a `'` uses `r"…"`; one
 *  containing BOTH quote styles, or a newline (raw strings cannot span lines),
 *  falls back to an ordinary escaped literal.  The same
 *  "never emit a literal that swallows the rest of the line" discipline
 *  `asRegexLiteral` applies on the JS side. */
export function dartRegexLiteral(pattern: string): string {
  const hasNewline = /[\n\r]/.test(pattern);
  const hasSingle = pattern.includes("'");
  const hasDouble = pattern.includes('"');
  if (!hasNewline && !hasSingle) return `RegExp(r'${pattern}')`;
  if (!hasNewline && !hasDouble) return `RegExp(r"${pattern}")`;
  return `RegExp('${dartStr(pattern).replace(/\n/g, "\\n").replace(/\r/g, "\\r")}')`;
}

/** The Dart rules one recognised single-field pattern implies. */
function rulesForPattern(
  field: string,
  pattern: SingleFieldPattern,
  authored: string | undefined,
): FlutterFieldRule[] {
  const message = authored ?? singleFieldMessage(field, pattern);
  const num = (violated: string): FlutterFieldRule => ({ on: "number", violated, message });
  // Code POINTS, not UTF-16 code units — `s.length` in Dart counts units, and
  // the `minLength`/`maxLength` this same constraint publishes into the
  // emitted JSON Schema are code points (`_expr/code-point.ts`).  Angular made
  // exactly this correction for the same reason; `s.runes.length` is Dart's
  // code-point count.
  const len = (violated: string): FlutterFieldRule => ({ on: "text", violated, message });
  switch (pattern.kind) {
    case "min":
      return [num(pattern.exclusive ? `n <= ${pattern.n}` : `n < ${pattern.n}`)];
    case "max":
      return [num(pattern.exclusive ? `n >= ${pattern.n}` : `n > ${pattern.n}`)];
    case "between":
      return [num(`n < ${pattern.lo} || n > ${pattern.hi}`)];
    case "len-min":
      return [len(`s.runes.length < ${pattern.n}`)];
    case "len-max":
      return [len(`s.runes.length > ${pattern.n}`)];
    case "len-eq":
      return [len(`s.runes.length != ${pattern.n}`)];
    case "len-range":
      return [len(`s.runes.length < ${pattern.lo} || s.runes.length > ${pattern.hi}`)];
    case "regex":
      return [len(`!${dartRegexLiteral(pattern.pattern)}.hasMatch(s)`)];
  }
}

/** Build the per-field Dart rule list an aggregate's (or operation's)
 *  invariants imply, over the fields the form actually carries (`available`).
 *  Empty map ⇒ every emitted validator stays byte-identical to the
 *  emptiness/parseability-only form. */
export function flutterValidatorMap(
  invariants: readonly InvariantIR[],
  available: ReadonlySet<string>,
): Map<string, FlutterFieldRule[]> {
  const out = new Map<string, FlutterFieldRule[]>();
  const ctx = { available };
  for (const inv of invariants) {
    const taken = takeSingleFieldChain(inv, ctx);
    if (!taken) continue;
    const rules = rulesForPattern(taken.field, taken.pattern, inv.message?.text);
    const list = out.get(taken.field) ?? [];
    list.push(...rules);
    out.set(taken.field, list);
  }
  return out;
}

/** The Dart `if (…) return '…';` guard lines for one field's rules, given the
 *  locals the surrounding validator body binds (`s` / `n`).  `kindOn` filters
 *  to the rules the field's input CAN evaluate: a plain text input has no
 *  parsed number, a numeric one has both. */
export function ruleGuards(
  rules: readonly FlutterFieldRule[],
  kinds: readonly ("text" | "number")[],
): string[] {
  return rules
    .filter((r) => kinds.includes(r.on))
    .map((r) => `if (${r.violated}) { return '${dartStr(r.message)}'; }`);
}
