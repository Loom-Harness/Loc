// What a repository read's positional argument names (D-REPO-VERBS).
//
// Two contract verbs are decided by their argument rather than their
// spelling: `find` is the criterion read when its argument is a criterion
// reference and the by-id read otherwise, and `all` runs a criterion or a
// retrieval.  The AST validators, typing and the IR lowerer
// (`ir/lower/repo-read.ts`) all classify through this one function, so they
// cannot disagree about which read a call is.
//
// A reference is a bare `Name` or `Name(args)` whose name is a `criterion` /
// `retrieval` declared in the enclosing context.  Anything else is a value —
// an id for `get` / `find`.  A name declared as both is refused
// (`loom.criterion-retrieval-name-clash`); here the retrieval wins, so an
// erroring model keeps lowering on its retrieval meaning.

import {
  type BoundedContext,
  type Expression,
  isCallSuffix,
  isCriterion,
  isNameRef,
  isPostfixChain,
  isRetrieval,
} from "./generated/ast.js";

/** A bare `Name` / `Name(args)` reference, before it is known to name a query. */
export interface QueryRef {
  name: string;
  args: Expression[];
}

/** The `Name` / `Name(args)` shape of an argument, or `undefined`. */
export function queryRefOf(e: Expression | undefined): QueryRef | undefined {
  if (!e) return undefined;
  if (isNameRef(e)) return { name: e.name, args: [] };
  if (isPostfixChain(e) && isNameRef(e.head) && e.suffixes.length === 1) {
    const s = e.suffixes[0]!;
    if (isCallSuffix(s)) return { name: e.head.name, args: (s.args ?? []).map((a) => a.value) };
  }
  return undefined;
}

export type RepoArgKind = "criterion" | "retrieval" | "value";

/** The query names a context declares. */
export interface QueryNames {
  criteria: ReadonlySet<string>;
  retrievals: ReadonlySet<string>;
}

/** The criteria and retrievals `ctx` declares (none outside a context). */
export function queryNamesOf(ctx: BoundedContext | undefined): QueryNames {
  const criteria = new Set<string>();
  const retrievals = new Set<string>();
  for (const m of ctx?.members ?? []) {
    if (isCriterion(m)) criteria.add(m.name);
    else if (isRetrieval(m)) retrievals.add(m.name);
  }
  return { criteria, retrievals };
}

/** Classify a repository read's positional argument against the declared
 *  query names. */
export function classifyRepoArg(e: Expression | undefined, names: QueryNames): RepoArgKind {
  const ref = queryRefOf(e);
  if (!ref) return "value";
  if (names.retrievals.has(ref.name)) return "retrieval";
  if (names.criteria.has(ref.name)) return "criterion";
  return "value";
}
