// ---------------------------------------------------------------------------
// The branch-total form of an `if` statement.
//
// A statement list is in branch-total form for a predicate `needsTail` when
// every `if` that (anywhere in its branches) holds a statement matching
// `needsTail` is the LAST statement of its list.  The rewrite that gets there
// moves the statements that follow such an `if` into each of its branches that
// can complete normally, and recurses:
//
//     if c { return A }          if c {
//     x := 1             ==>       return A
//     return B                   } else {
//                                  x := 1
//                                  return B
//                                }
//
// Two consumers, one rewrite:
//
//   - lowering normalises every domain body for `return` (`normalizeEarlyReturns`),
//     so an early exit reaches every backend as a branch whose `return` is the
//     last statement of its block.  The meaning is unchanged on every target —
//     the statements that followed the `if` ran exactly when the branch did not
//     return — and the five backends render a `return` only in tail position.
//   - the Phoenix operation renderers widen the predicate to every statement
//     whose effect is decided per path (an `emit`, a guard, a provenanced
//     write), and render the resulting tail `if` as one complete body per
//     branch (`src/generator/elixir/vanilla/op-tree.ts`).
//
// A branch that already ends every path in a `return` keeps its statements:
// nothing after the `if` could run there.  An `if` with no `else` grows one
// only when statements follow it.  Statement objects are shared, not copied —
// a continuation absorbed into both branches appears in both by reference.
// ---------------------------------------------------------------------------

import type { StmtIR } from "../types/loom-ir.js";
import { walkStmtChildren } from "./walk.js";

/** Visit `s` and every statement nested in its BRANCHES (`if` then/else,
 *  `variant-match` arms/else), at any depth.  Unlike `walkStmtDeep` it does not
 *  enter lambda blocks: a `return` inside a lambda ends the lambda, not the
 *  body that holds it. */
function walkBranchStmts(s: StmtIR, visit: (s: StmtIR) => void): void {
  visit(s);
  walkStmtChildren(
    s,
    () => {},
    (n) => walkBranchStmts(n, visit),
  );
}

/** True when `s`, or a statement in one of its branches, matches `pred`. */
export function branchesContain(s: StmtIR, pred: (n: StmtIR) => boolean): boolean {
  let found = false;
  walkBranchStmts(s, (n) => {
    if (!found && pred(n)) found = true;
  });
  return found;
}

/** True when running `stmts` always ends in a `return` — its last statement is
 *  a `return`, or an `if` both of whose branches always return. */
function blockAlwaysReturns(stmts: readonly StmtIR[]): boolean {
  const last = stmts[stmts.length - 1];
  if (!last) return false;
  if (last.kind === "return") return true;
  if (last.kind === "if") {
    return (
      blockAlwaysReturns(last.thenBody) &&
      last.elseBody !== undefined &&
      blockAlwaysReturns(last.elseBody)
    );
  }
  return false;
}

/** Rewrite `stmts` into branch-total form for `needsTail` (see the file
 *  header).  Returns `stmts` itself when nothing changes, so a body with no
 *  such `if` keeps its identity. */
export function toBranchTotal(
  stmts: readonly StmtIR[],
  needsTail: (s: StmtIR) => boolean,
): StmtIR[] {
  let changed = false;
  const out: StmtIR[] = [];
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i]!;
    if (s.kind === "if" && branchesContain(s, needsTail)) {
      const rest = stmts.slice(i + 1);
      const extend = (body: readonly StmtIR[]): StmtIR[] =>
        rest.length === 0 || blockAlwaysReturns(body)
          ? toBranchTotal(body, needsTail)
          : toBranchTotal([...body, ...rest], needsTail);
      const thenBody = extend(s.thenBody);
      const elseSrc = s.elseBody ?? [];
      const elseBody = s.elseBody !== undefined || rest.length > 0 ? extend(elseSrc) : undefined;
      if (
        rest.length > 0 ||
        thenBody !== s.thenBody ||
        (elseBody !== undefined && elseBody !== s.elseBody)
      ) {
        changed = true;
        out.push({
          kind: "if",
          cond: s.cond,
          thenBody,
          ...(elseBody !== undefined ? { elseBody } : {}),
          ...(s.origin ? { origin: s.origin } : {}),
        });
      } else {
        out.push(s);
      }
      // Everything after the `if` now lives inside it.
      if (rest.length > 0) break;
      continue;
    }
    if (s.kind === "variant-match" && branchesContain(s, needsTail)) {
      // A statement `match` keeps its own placement rules; only the blocks it
      // carries are normalised.
      const arms = s.arms.map((a) => {
        const body = toBranchTotal(a.body, needsTail);
        return body === a.body ? a : { ...a, body };
      });
      const elseBody = s.elseBody ? toBranchTotal(s.elseBody, needsTail) : undefined;
      if (arms.some((a, k) => a !== s.arms[k]) || elseBody !== s.elseBody) {
        changed = true;
        out.push({ ...s, arms, ...(elseBody ? { elseBody } : {}) });
        continue;
      }
    }
    out.push(s);
  }
  return changed ? out : (stmts as StmtIR[]);
}

/** The lowering-time normalisation every backend consumes: an `if` holding a
 *  `return` takes the statements after it into its branches, so every
 *  `return` reaches a renderer as the last statement of its block. */
export function normalizeEarlyReturns(stmts: readonly StmtIR[]): StmtIR[] {
  return toBranchTotal(stmts, (n) => n.kind === "return");
}
