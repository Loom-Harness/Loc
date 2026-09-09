// Match-expression structural checks + test-matcher arity + the
// `string.matches(regex)` literal-pattern gate.

import { AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import { intrinsicMatcherSig } from "../../util/intrinsic-matchers.js";
import {
  type CallSuffix,
  type ExpectStmt,
  type Expression,
  isCallSuffix,
  isExpectStmt,
  isIntLit,
  isLetStmt,
  isMemberSuffix,
  isNameRef,
  isParenExpr,
  isPostfixChain,
  isTestE2E,
  type MatchExpr,
  type MemberSuffix,
  type Model,
  type StringLit,
} from "../generated/ast.js";

export function checkMatchExpressions(model: Model, accept: ValidationAcceptor): void {
  for (const node of AstUtils.streamAllContents(model)) {
    if (node.$type !== "MatchExpr") continue;
    const m = node as MatchExpr;
    const isVariant = !!m.subject;
    // Empty match (no arms, no else) is structurally meaningless —
    // grammar permits it, validator rejects.  The variant form counts
    // `varArms`; the boolean form counts `arms`.
    const armCount = isVariant ? m.varArms.length : m.arms.length;
    if (armCount === 0 && !m.elseExpr) {
      accept("error", `Empty 'match { }' — must declare at least one arm or an 'else' branch.`, {
        node: m,
      });
      continue;
    }
    if (isVariant) {
      // v1 constraint (variant-match.md): the scrutinee must be a simple
      // ref / let-bound name read — not a side-effecting call — so every
      // arm can read it once without double-evaluation.  A call subject is
      // a PostfixChain carrying a CallSuffix or a calling MemberSuffix.
      if (subjectIsCall(m.subject!)) {
        accept("error", diagMessage("loom.match-subject-not-simple"), {
          node: m,
          property: "subject",
          code: "loom.match-subject-not-simple",
        });
      }
      // Variant exhaustiveness / unknown-variant / duplicate-variant are
      // checked in the IR validator, where the scrutinee's resolved union
      // variant set is available (src/ir/validate/checks/structural-checks.ts).
      continue;
    }
    // Warn on non-exhaustive boolean matches (no `else`).  An expression
    // without `else` returns undefined when no arm matches, which
    // is rarely intentional — for state-machine page bodies it
    // means "render nothing" which is usually a bug.  Promoted
    // from error to warning to keep the surface friendly while
    // the user iterates.
    if (!m.elseExpr) {
      accept(
        "warning",
        `'match' expression has no 'else' arm — when no arm matches, the expression is undefined.  Add 'else => …' for exhaustive coverage.`,
        { node: m },
      );
    }
  }
}

/** True when a variant-match subject expression contains a call — a
 *  `CallSuffix` (`f(...)`) or a calling `MemberSuffix` (`x.verb(...)`) in its
 *  postfix chain.  A bare `NameRef` or a pure member read is "simple". */
function subjectIsCall(subject: Expression): boolean {
  if (!isPostfixChain(subject)) return false;
  return subject.suffixes.some(
    (s: CallSuffix | MemberSuffix) => isCallSuffix(s) || (isMemberSuffix(s) && s.call),
  );
}

/** The compiler knows the intrinsic test-matcher surface, so it can
 *  enforce it: each matcher takes a fixed number of positional args.
 *  Walks every MemberSuffix in the model (post-grammar-flatten, calls
 *  on a receiver are MemberSuffix nodes with `call: true`). */
export function checkMatcherArity(model: Model, accept: ValidationAcceptor): void {
  for (const node of AstUtils.streamAllContents(model)) {
    if (!isMemberSuffix(node)) continue;
    const ms = node as MemberSuffix;
    if (!ms.call) continue;
    const sig = intrinsicMatcherSig(ms.member);
    if (!sig) continue;
    // `toThrow` has variable arity (0 = any throw, 1 = pinned HTTP status);
    // `checkExpectMatcher` enforces its argument rules.
    if (ms.member === "toThrow") continue;
    if (ms.args.length !== sig.arity) {
      accept(
        "error",
        `matcher '${ms.member}' takes ${sig.arity} argument(s), got ${ms.args.length}.`,
        { node: ms, property: "args" },
      );
    }
  }
}

/** If `expr` is a method-matcher call (`expect(<actual>).toBe(<x>)`, possibly
 *  with a `.not.` before it), return its trailing matcher suffix.  This is how
 *  the validator distinguishes a method-based assertion from a bare-boolean
 *  `expect <x>` / `expect(<x>)`. */
function trailingMatcher(expr: Expression): MemberSuffix | undefined {
  if (!isPostfixChain(expr)) return undefined;
  const last = expr.suffixes.at(-1);
  if (last && isMemberSuffix(last) && last.call && intrinsicMatcherSig(last.member)) return last;
  return undefined;
}

/** Assertions are method-based: every `expect(...)` must end in an intrinsic
 *  matcher.  Reject the bare-boolean form, and enforce the `toThrow` argument
 *  rules — at most one argument, which (when present) pins an HTTP status and
 *  is therefore valid only in a `test e2e` block and must be an integer
 *  literal so the e2e renderer can translate it into a `/→ N\b/` matcher. */
export function checkExpectMatcher(model: Model, accept: ValidationAcceptor): void {
  for (const node of AstUtils.streamAllContents(model)) {
    if (!isExpectStmt(node)) continue;
    const stmt = node as ExpectStmt;
    const matcher = trailingMatcher(stmt.expr);
    if (!matcher) {
      accept(
        "error",
        `'expect' requires a matcher — write 'expect(<actual>).toBe(<expected>)' (or .toThrow(), .toHaveText(…), …), not a bare expression.`,
        { node: stmt, property: "expr" },
      );
      continue;
    }
    // A LOCATOR matcher (`toHaveText` / `toHaveCount` / `toBeVisible`) asserts
    // against a live DOM node, so its argument has to be something the ui e2e
    // renderer can turn into a Playwright `Locator`: a field read on a page
    // the test has on screen.  Everything else used to reach
    // `renderExpectStmt`'s compiler-invariant throw and kill `generate system`
    // with a stack trace (audit 2026-09-03 F6) — the input validated clean and
    // then crashed the compiler, which is the one outcome that is never
    // acceptable.  Reject it here, where the source span is.
    const locatorSig = intrinsicMatcherSig(matcher.member);
    if (locatorSig?.on === "locator") {
      const asserted = assertedExpr(stmt);
      if (asserted && !isPageFieldRead(asserted, stmt)) {
        accept(
          "error",
          diagMessage("loom.locator-matcher-receiver", {
            matcher: matcher.member,
            actual: asserted.$cstNode?.text ?? "the asserted expression",
          }),
          { node: stmt, property: "expr", code: "loom.locator-matcher-receiver" },
        );
      }
      continue;
    }
    // `toBeSameInstant` forgives wire timestamp FORMAT — a concept that only
    // exists once a value has crossed the HTTP boundary.  In a domain unit test
    // (in-memory values) there is nothing to forgive, so restrict it to e2e.
    if (matcher.member === "toBeSameInstant") {
      if (!isTestE2E(stmt.$container)) {
        accept(
          "error",
          `'toBeSameInstant' compares wire timestamps and is only valid in a 'test e2e' block; compare in-memory values with 'toBe' in an in-process test.`,
          { node: matcher, property: "member" },
        );
      }
      continue;
    }
    if (matcher.member !== "toThrow") continue;
    if (matcher.args.length > 1) {
      accept(
        "error",
        `'toThrow' takes at most one argument (an HTTP status), got ${matcher.args.length}.`,
        { node: matcher, property: "args" },
      );
    } else if (matcher.args.length === 1) {
      if (!isTestE2E(stmt.$container)) {
        accept(
          "error",
          `'toThrow(<status>)' pins an HTTP status and is only valid in a 'test e2e' block; use a bare 'toThrow()' in an in-process test.`,
          { node: matcher, property: "args" },
        );
      } else if (!isIntLit(matcher.args[0]!.value)) {
        accept(
          "error",
          `'toThrow(<status>)' requires an integer HTTP status literal, e.g. toThrow(404).`,
          { node: matcher, property: "args" },
        );
      }
    }
  }
}

/** The expression under assertion.  `expect` is a KEYWORD, not a call — the
 *  statement's `expr` is the parenthesised actual with the matcher hanging off
 *  it as postfix suffixes (`.not` optionally in between), so the asserted
 *  expression is the chain's parenthesised head. */
function assertedExpr(stmt: ExpectStmt): Expression | undefined {
  if (!isPostfixChain(stmt.expr)) return undefined;
  const head = stmt.expr.head;
  return isParenExpr(head) ? head.inner : head;
}

/** `<local>.<field>` where `<local>` is bound in the same `test e2e` body to a
 *  `ui.<aggregate>.getById(…)` or `ui.<aggregate>.create(…)` — the two calls
 *  that put a row on screen.  `<field>` must be a real field: `id` is the page
 *  object's own property, not a rendered cell. */
function isPageFieldRead(e: Expression, stmt: ExpectStmt): boolean {
  if (!isPostfixChain(e)) return false;
  if (e.suffixes.length !== 1) return false;
  const suffix = e.suffixes[0];
  if (!suffix || !isMemberSuffix(suffix) || suffix.call || suffix.member === "id") return false;
  const head = e.head;
  if (!isNameRef(head)) return false;
  return pageLocals(stmt).has(head.name);
}

/** Names `let`-bound to a `ui.<aggregate>.getById(…)` / `.create(…)` in the
 *  enclosing `test e2e` body. */
function pageLocals(stmt: ExpectStmt): Set<string> {
  const out = new Set<string>();
  const block = AstUtils.getContainerOfType(stmt, isTestE2E);
  if (!block) return out;
  for (const s of block.body) {
    if (!isLetStmt(s) || !isUiRowCall(s.expr)) continue;
    out.add(s.name);
  }
  return out;
}

/** `ui.<slug>.getById(…)` / `ui.<slug>.create(…)`. */
function isUiRowCall(e: Expression): boolean {
  if (!isPostfixChain(e)) return false;
  const head = e.head;
  if (!isNameRef(head) || head.name !== "ui") return false;
  if (e.suffixes.length !== 2) return false;
  const [slug, method] = e.suffixes;
  if (!slug || !isMemberSuffix(slug) || slug.call) return false;
  if (!method || !isMemberSuffix(method) || !method.call) return false;
  return method.member === "getById" || method.member === "create";
}

export function checkMatchesCalls(model: Model, accept: ValidationAcceptor): void {
  for (const node of AstUtils.streamAllContents(model)) {
    if (!isMemberSuffix(node)) continue;
    const ms = node as MemberSuffix;
    if (ms.member !== "matches" || !ms.call) continue;
    // `matches` always takes exactly one string-literal argument.
    if (ms.args.length !== 1) {
      accept("error", `'matches' takes exactly one argument (a string-literal regex pattern).`, {
        node: ms,
        property: "args",
      });
      continue;
    }
    const argWrap = ms.args[0]!;
    const arg = argWrap.value;
    if (argWrap.name) {
      accept(
        "error",
        `'matches' takes a single positional argument; named arguments are not supported.`,
        { node: argWrap, property: "name" },
      );
      continue;
    }
    if (arg.$type !== "StringLit") {
      accept(
        "error",
        `'matches' argument must be a string literal — patterns must be known at codegen time.`,
        { node: ms, property: "args" },
      );
      continue;
    }
    // Langium's STRING terminal strips the surrounding quotes, so `raw` IS
    // the pattern text as written (a leading `"` is a literal regex char, not
    // a delimiter — no JSON.parse: it would throw on `matches("[A-Z])` and
    // silently unescape `\"a\"` into the WRONG pattern).
    const pattern = (arg as StringLit).value as string;
    try {
      new RegExp(pattern);
    } catch (err) {
      accept(
        "error",
        `'matches' pattern is not a valid regular expression: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { node: ms, property: "args" },
      );
    }
  }
}
