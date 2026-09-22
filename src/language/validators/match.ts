// Match-expression structural checks + test-matcher arity + the
// `string.matches(regex)` literal-pattern gate.

import { AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import type { Platform } from "../../ir/types/loom-ir.js";
import { descriptorFor, parseBuiltinPlatformRef } from "../../platform/metadata.js";
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
  type TestE2E,
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
      accept("error", diagMessage("loom.match-empty"), {
        node: m,
        code: "loom.match-empty",
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
      accept("warning", diagMessage("loom.match-no-else"), { node: m, code: "loom.match-no-else" });
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
    // `toThrow` has variable arity (0 = any throw, 1 = pinned HTTP status or
    // failure rung); `checkExpectMatcher` enforces its argument rules.
    if (ms.member === "toThrow") continue;
    // A throw-KIND word occupies the grammar's `ThrowKind` slot, which is a
    // SIBLING of `args` — so `toBe(invariant)` reads here as zero arguments and
    // would draw a second, misleading "takes 1 argument(s), got 0".  The real
    // complaint is `checkThrowKindPlacement`'s (the word belongs to `toThrow`
    // and nothing else); let that one speak alone.
    if (ms.throwKind) continue;
    if (ms.args.length !== sig.arity) {
      accept(
        "error",
        diagMessage("loom.matcher-arity", {
          matcher: ms.member,
          arity: sig.arity,
          got: ms.args.length,
        }),
        { node: ms, property: "args", code: "loom.matcher-arity" },
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
      accept("error", diagMessage("loom.expect-requires-matcher"), {
        node: stmt,
        property: "expr",
        code: "loom.expect-requires-matcher",
      });
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
        accept("error", diagMessage("loom.matcher-e2e-only#same-instant"), {
          node: matcher,
          property: "member",
          code: "loom.matcher-e2e-only",
        });
      }
      continue;
    }
    if (matcher.member !== "toThrow") continue;
    // `toThrow(<kind>)` — the failure RUNG (`precondition` / `invariant`).
    // UNIT TIER ONLY.  In-process the rung is observable: elixir carries a
    // structural `:kind` on `GuardError`, the other four a stable message
    // prefix.  Over HTTP both rungs are a 422 whose only discriminator is the
    // RFC 7807 `detail` sentence — which an authored `message "..."` on the
    // rule overwrites.  Allowing both tiers would make ONE matcher mean two
    // strengths of claim, which is exactly the defect #2959 fixed on the ui
    // side (`toThrow(422)` silently meaning something weaker there).  The e2e
    // body keeps the wire-level form, `toThrow(<status>)`.
    if (matcher.throwKind) {
      if (isTestE2E(stmt.$container)) {
        accept("error", diagMessage("loom.e2e-throw-kind-invalid", { kind: matcher.throwKind }), {
          node: matcher,
          property: "member",
          code: "loom.e2e-throw-kind-invalid",
        });
      }
      continue;
    }
    if (matcher.args.length > 1) {
      accept("error", diagMessage("loom.tothrow-arity", { got: matcher.args.length }), {
        node: matcher,
        property: "args",
        code: "loom.tothrow-arity",
      });
      continue;
    }
    // A `test e2e` block that lowers to the UI renderer has no HTTP response
    // to assert against, so NEITHER form of `toThrow` is runnable there.  Refuse
    // both at the source span rather than emitting a weaker assertion: the
    // status argument used to be dropped silently by `ui-e2e-render.ts`, and
    // the bare form only ever settles on a Playwright timeout.  (Audit
    // 2026-09-13 F7 / fleet decision D-3.)
    const container = stmt.$container;
    if (isTestE2E(container) && lowersToUiSpec(container)) {
      const arg = matcher.args[0]?.value;
      accept(
        "error",
        arg
          ? diagMessage("loom.e2e-ui-throw-invalid#status", {
              status: arg.$cstNode?.text ?? "<status>",
            })
          : diagMessage("loom.e2e-ui-throw-invalid#bare"),
        { node: matcher, property: "member", code: "loom.e2e-ui-throw-invalid" },
      );
      continue;
    }
    if (matcher.args.length === 1) {
      if (!isTestE2E(container)) {
        accept("error", diagMessage("loom.matcher-e2e-only#throw-status"), {
          node: matcher,
          property: "args",
          code: "loom.matcher-e2e-only",
        });
      } else if (!isIntLit(matcher.args[0]!.value)) {
        accept("error", diagMessage("loom.tothrow-status-not-int"), {
          node: matcher,
          property: "args",
          code: "loom.tothrow-status-not-int",
        });
      }
    }
  }
}

/** The grammar's `ThrowKind` slot is reachable on ANY member call — it had to
 *  be, because `precondition` / `invariant` are hard keywords that no ordinary
 *  argument rule can carry (see `PostfixSuffix` in `ddd.langium`).  The
 *  matcher catalogue is closed and compiler-known, so the reach that the
 *  grammar cannot narrow, the validator does: the two words mean the failure
 *  rung of a `toThrow`, and nothing else.
 *
 *  Without this, `wo.complete(precondition)` — or `expect(x).toBe(invariant)` —
 *  would parse clean and then lower to a call whose argument list silently
 *  DROPPED the word, since `throwKind` is a sibling of `args`, not a member of
 *  it.  That is the "validates clean, then means something else" shape this
 *  repo refuses; name it at the author's own source span instead. */
export function checkThrowKindPlacement(model: Model, accept: ValidationAcceptor): void {
  for (const node of AstUtils.streamAllContents(model)) {
    if (!isMemberSuffix(node)) continue;
    const ms = node as MemberSuffix;
    if (!ms.throwKind || ms.member === "toThrow") continue;
    accept(
      "error",
      diagMessage("loom.throw-kind-outside-tothrow", { kind: ms.throwKind, member: ms.member }),
      { node: ms, property: "member", code: "loom.throw-kind-outside-tothrow" },
    );
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

/** Does this `test e2e` block lower to the Playwright (`.ui.spec.ts`) renderer
 *  rather than the vitest+fetch one?
 *
 *  Mirrors `lowerE2E`'s kind dispatch in `src/ir/lower/lower.ts` — kept in step
 *  by `test/language/validation/e2e-ui-throw-invalid.test.ts`, which drives
 *  both branches:
 *
 *    - a FRONTEND-only platform (react / static / svelte / vue / angular /
 *      feliz / flutter) can only carry a ui body;
 *    - `elixir` (phoenixLiveView) is fullstack and carries EITHER kind, so the
 *      body's own call ROOT decides — a body reaching `ui.…` produces a ui
 *      spec, one reaching only `api.…` does not;
 *    - every other platform lowers to the api renderer, `mountsUi` or not
 *      (`renderUIE2EFile` filters on `kind === "ui"`, which such a block
 *      never has).
 *
 *  Deliberately reads the AST rather than the IR: the whole point is to report
 *  at the author's own source span, before lowering runs. */
function lowersToUiSpec(block: TestE2E): boolean {
  const declared = block.deployable?.ref?.platform;
  if (declared == null) return false;
  // A backend may be written `family@version` (`hono@v5`); frontends and
  // `elixir` are always barewords, so the family alone decides.
  const platform = parseBuiltinPlatformRef(declared)?.family ?? declared;
  let isFrontend: boolean;
  try {
    isFrontend = descriptorFor(platform as Platform).isFrontend;
  } catch {
    // Unknown / typo'd platform — `checkDeployablePlatform` reports that
    // separately; say nothing extra here.
    return false;
  }
  if (isFrontend) return true;
  if (platform !== "elixir") return false;
  // Fullstack: `fullstackE2EKinds` emits a ui spec whenever the body reaches
  // the `ui` root at all (a mixed-root body lowers to BOTH kinds), so follow
  // the root, not the platform.
  return AstUtils.streamAllContents(block).some((n) => isNameRef(n) && n.name === "ui");
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
      accept("error", diagMessage("loom.matches-arity"), {
        node: ms,
        property: "args",
        code: "loom.matches-arity",
      });
      continue;
    }
    const argWrap = ms.args[0]!;
    const arg = argWrap.value;
    if (argWrap.name) {
      accept("error", diagMessage("loom.matches-named-arg"), {
        node: argWrap,
        property: "name",
        code: "loom.matches-named-arg",
      });
      continue;
    }
    if (arg.$type !== "StringLit") {
      accept("error", diagMessage("loom.matches-not-literal"), {
        node: ms,
        property: "args",
        code: "loom.matches-not-literal",
      });
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
        diagMessage("loom.matches-invalid-regex", {
          reason: err instanceof Error ? err.message : String(err),
        }),
        { node: ms, property: "args", code: "loom.matches-invalid-regex" },
      );
    }
  }
}
