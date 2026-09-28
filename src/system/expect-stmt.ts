import type { ExprIR } from "../ir/types/loom-ir.js";
import { intrinsicMatcherSig } from "../util/intrinsic-matchers.js";

// Shared lowering for `expect(...)` statements in the generated e2e (api)
// and UI specs.
//
// Assertions are written as **explicit, typed matchers** —
// `expect(read.sku).toBe("WIDGET-1")`, `expect(list.length).toBeGreaterThanOrEqual(1)` —
// which the IR resolves into `method-call.isIntrinsicMatcher`. The renderer
// unwraps the asserted expression (and an optional `.not.`) and emits the
// native matcher. There is no bare-boolean fallback: the validator
// (`checkExpectMatcher`) requires every `expect` to carry a matcher, so a
// non-matcher reaching here is a compiler invariant violation, not user input.
//
// The same validator also gates a LOCATOR matcher's receiver
// (`loom.locator-matcher-receiver`), which is what makes the throw below an
// invariant rather than a crash a user can trigger: `expect(<x>).toHaveText(…)`
// on something that is not a page read used to validate clean and then die here
// with a stack trace (audit 2026-09-03 F6).

/** Render one `expect(<x>).<matcher>(…)` to an assertion statement (no
 *  trailing newline). `render` lowers a sub-expression to target source. */
export function renderExpectStmt(expr: ExprIR, render: (e: ExprIR) => string): string {
  const explicit = renderExplicitValueMatcher(expr, render);
  if (explicit) return explicit;
  // Locator matchers are peeled by the caller before this point, and a locator
  // matcher whose receiver is not a page read never gets past
  // `loom.locator-matcher-receiver`.  Reaching here means a bare-boolean
  // `expect`, which the validator also rejects.  Fail loudly rather than
  // silently emitting `.toBe(true)`.
  throw new Error(
    "expect requires a matcher (e.g. expect(x).toBe(y) / expect(call).toThrow()); " +
      "got a bare expression with no matcher.",
  );
}

/** When `expr` is an explicit intrinsic value-matcher (`expect(x).toBe(y)`,
 *  with optional `.not.`), render it directly. Returns null for anything
 *  else — including locator matchers, which are rendered by the backend's
 *  own helper since they need locator-specific receiver lowering. */
function renderExplicitValueMatcher(expr: ExprIR, render: (e: ExprIR) => string): string | null {
  if (expr.kind !== "method-call" || !expr.isIntrinsicMatcher) return null;
  const sig = intrinsicMatcherSig(expr.member);
  if (sig?.on !== "value") return null;

  // The matcher's receiver is the asserted expression — usually wrapped in
  // parens as authored (`expect(<inner>).toBe(…)`), and optionally preceded
  // by `.not` for negation.
  let receiver = expr.receiver;
  let negate = false;
  if (receiver.kind === "member" && receiver.member === "not" && sig.negatable) {
    negate = true;
    receiver = receiver.receiver;
  }
  const inner = receiver.kind === "paren" ? receiver.inner : receiver;
  const prefix = negate ? "not." : "";

  // `toBeSameInstant` is temporal equality: compare the two timestamps as
  // instants (epoch ms) so wire-format differences (`…00.0000000Z` vs `…00Z`)
  // don't fail the assertion, but a real difference in time still does. Lowers
  // to a plain vitest `toBe` on `Date.getTime()` — no custom-matcher runtime.
  if (expr.member === "toBeSameInstant") {
    const actual = `new Date(${render(inner)}).getTime()`;
    const expected = `new Date(${render(expr.args[0]!)}).getTime()`;
    return `expect(${actual}).${prefix}toBe(${expected});`;
  }

  // `toBeAbsent()` — the OTHER wire spelling of absence.  `toBeNull()` asks
  // whether the value is null; this asks whether the KEY IS IN THE BODY AT
  // ALL, which no `expect(<value>)` form can see: `read.estimate` has already
  // evaluated to `undefined` by the time a matcher runs, and `undefined` is
  // what a present-but-null key gives too.  So the assertion is rewritten onto
  // the RECEIVER: `expect("estimate" in read).toBe(false)`.
  //
  // It is allowed to fail honestly.  Every backend currently sends explicit
  // null (RS-35), so this matcher has no passing subject today — that is the
  // point.  A backend that starts omitting a key should turn a test red here
  // rather than slipping past a matcher special-cased into always passing.
  if (expr.member === "toBeAbsent") {
    // The subject is a field read (`<obj>.<key>`) — `checkAbsentReceiver`
    // rejects anything else at the author's source span, so a non-member here
    // is a compiler invariant violation, not user input.
    if (inner.kind !== "member") {
      throw new Error(
        "toBeAbsent() requires a field read (expect(<obj>.<field>).toBeAbsent()); " +
          `got a '${inner.kind}' expression.`,
      );
    }
    const key = JSON.stringify(inner.member);
    // `.not.toBeAbsent()` is "the key IS present" — flip the compared boolean
    // rather than emitting `not.toBe(false)`, which reads as a double negative.
    return `expect(${key} in ${render(inner.receiver)}).toBe(${negate ? "true" : "false"});`;
  }

  // `toBeNull` (arity 0) and `toContain` (arity 1) need no special case: both
  // are native vitest matchers whose names line up 1:1, and vitest's own
  // `toContain` already dispatches on the subject at runtime (membership for
  // an array, substring for a string) — the same two lowerings the unit-tier
  // emitters have to spell out by hand because their assertion libraries do
  // not.  `checkContainReceiver` has already refused every third subject type.
  const args = expr.args.map((a) => render(a)).join(", ");
  return `expect(${render(inner)}).${prefix}${expr.member}(${args});`;
}
