// The natural keys a repository's natural-key reads (`getBy` / `findBy`)
// accept: the `unique (…)` tuples the aggregate declares, plus those it inherits
// from its `extends` chain (a concrete subtype's rows carry the base's keys).
// Shared by the AST validator (`validators/repo-key-lookup.ts`) and the IR
// lowerer (`ir/lower/repo-read.ts`), so the two cannot disagree about which
// tuple a call names.

import { type Aggregate, isUnique } from "./generated/ast.js";

/** Every `unique (…)` tuple of `agg`, inherited ones first, each in its
 *  declared column order. */
export function declaredKeyTuples(agg: Aggregate | undefined): string[][] {
  const out: string[][] = [];
  const seen = new Set<Aggregate>();
  const visit = (a: Aggregate | undefined): void => {
    if (!a || seen.has(a)) return;
    seen.add(a);
    visit(a.superType?.ref);
    for (const m of a.members) if (isUnique(m)) out.push([...m.columns]);
  };
  visit(agg);
  return out;
}
