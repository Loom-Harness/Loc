// Shared AST-walk helpers for `test/` (M-T9.50).
//
// Two shapes recur across the parsing, macro and playground suites, and both
// were compiling only because `test/` went untypechecked:
//
//   - `model.members.flatMap((m) => ("members" in m ? m.members : []))`, chained
//     twice to reach context members through `system → subdomain`.  The `in`
//     narrowing leaves a UNION of five member arrays, so every downstream
//     `.find`/`.filter` sees `unknown`.  Worse, it silently returns the wrong
//     level for a root shape it does not match — `operation-workflow-gate-parse`'s
//     "an ungated workflow has no header gate" searched a `system`-rooted
//     fixture this way, found nothing, and asserted NOTHING for as long as it
//     has existed.
//   - `(n as { name: string }).name` on an `AstNode`, which TS rejects outright
//     as a non-overlapping assertion.
//
// `contextMembersOf` descends all three root shapes explicitly, and `nodeName`
// reads the optional `name` once instead of per call site.

import type { AstNode } from "langium";
import {
  type ContextMember,
  isBoundedContext,
  isSubdomain,
  isSystem,
  type Model,
} from "../../src/language/generated/ast.js";

/** Every context member in a parsed model — all three root shapes a `.ddd` can
 *  take: a bare top-level `context`, `system → context`, and
 *  `system → subdomain → context`. */
export function contextMembersOf(model: Model): ContextMember[] {
  const out: ContextMember[] = [];
  for (const top of model.members) {
    if (isBoundedContext(top)) {
      out.push(...top.members);
      continue;
    }
    if (!isSystem(top)) continue;
    for (const sm of top.members) {
      if (isBoundedContext(sm)) out.push(...sm.members);
      else if (isSubdomain(sm)) for (const c of sm.contexts) out.push(...c.members);
    }
  }
  return out;
}

/** The `name` of an AST node that carries one, else `undefined`.
 *
 *  Langium's generated member UNIONS do not declare `name` even when every arm
 *  has one, and `AstNode` never does — so reading it needs one widening, which
 *  lives here rather than at each of the fifty call sites that wanted it. */
export const nodeName = (n: AstNode): string | undefined => {
  const v = (n as unknown as { name?: unknown }).name;
  return typeof v === "string" ? v : undefined;
};
