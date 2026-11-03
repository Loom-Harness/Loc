// A union-returning operation's `return match { … }` tagged PER ARM.
//
// The returned value of `return match { c => A {…}, else => B {…} }` has no
// single union variant: each arm builds its own.  Lowering records one variant
// per arm (`StmtIR.return.armVariants`), and this module turns that into the
// statement shape every backend already renders correctly — one tagged
// `return` per arm:
//
//     if c { return A {…} } else { return B {…} }          // predicate form
//     match r { X x => { return A {…} } … }                // variant form
//
// So an arm answers its own wire tag, and an `error` variant is the error path
// only when its own arm runs.  The expansion is pure IR → IR; each backend
// renders the result with its ordinary `if` / statement-`match` / tagged
// `return` leaves.

import type { ExprIR, ReturnVariantIR, StmtIR } from "../types/loom-ir.js";

type ReturnStmt = Extract<StmtIR, { kind: "return" }>;

/** One arm of a per-arm tagged return: the tagged `return` it runs, and the
 *  predicate guarding it (absent on the `else` arm of the predicate form). */
export interface UnionReturnBranch {
  cond?: ExprIR;
  ret: ReturnStmt;
}

/** The tagged `return` an arm runs. */
function armReturn(value: ExprIR, v: ReturnVariantIR, origin: ReturnStmt["origin"]): ReturnStmt {
  return {
    kind: "return",
    value,
    variantTag: v.variantTag,
    variantShape: v.variantShape,
    ...(origin ? { origin } : {}),
  };
}

/** The branches of a predicate-form per-arm return, in source order (arms,
 *  then the `else`), or null when `s` is not one.  Elixir renders these as one
 *  `cond`; the statement backends go through `distributeUnionReturn`. */
export function unionReturnBranches(s: ReturnStmt): UnionReturnBranch[] | null {
  const tags = s.armVariants;
  const m = s.value;
  if (!tags || m.kind !== "match" || m.subject) return null;
  const branches: UnionReturnBranch[] = m.arms.map((a, i) => ({
    cond: a.cond,
    ret: armReturn(a.value, tags[i]!, s.origin),
  }));
  if (m.otherwise) {
    branches.push({ ret: armReturn(m.otherwise, tags[m.arms.length]!, s.origin) });
  }
  return branches;
}

/** Expand a per-arm tagged `return` into one tagged `return` per arm: an
 *  `if` / `else` chain for the predicate form, a statement `match` for the
 *  variant form.  Any other statement comes back unchanged. */
export function distributeUnionReturn(s: StmtIR): StmtIR {
  if (s.kind !== "return" || !s.armVariants) return s;
  const tags = s.armVariants;
  const m = s.value;
  if (m.kind !== "match") return s;
  const origin = s.origin ? { origin: s.origin } : {};
  if (m.subject) {
    return {
      kind: "variant-match",
      subject: m.subject,
      ...(m.subjectType ? { subjectType: m.subjectType } : {}),
      ...(m.subjectShape ? { subjectShape: m.subjectShape } : {}),
      arms: m.variantArms.map((a, i) => ({
        varType: a.varType,
        ...(a.binding !== undefined ? { binding: a.binding } : {}),
        body: [armReturn(a.value, tags[i]!, s.origin)],
        ...(a.isError !== undefined ? { isError: a.isError } : {}),
      })),
      ...(m.otherwise
        ? { elseBody: [armReturn(m.otherwise, tags[m.variantArms.length]!, s.origin)] }
        : {}),
      ...origin,
    };
  }
  const branches = unionReturnBranches(s);
  // Lowering stamps `armVariants` only on an exhaustive match, so the last
  // branch is the unguarded `else`.
  const last = branches?.at(-1);
  if (!branches || !last || last.cond) return s;
  // Fold from the `else`: it is the innermost else-body.
  let tail: StmtIR[] = [last.ret];
  for (let i = branches.length - 2; i >= 0; i--) {
    const b = branches[i]!;
    tail = [{ kind: "if", cond: b.cond!, thenBody: [b.ret], elseBody: tail, ...origin }];
  }
  return tail[0]!;
}
