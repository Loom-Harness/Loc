// ---------------------------------------------------------------------------
// The implicit filter of a clause-less find.
//
// `find byReference(reference: string): WorkOrder?` declares no `where`, yet it
// is a key lookup, not a scan: each parameter pairs with the aggregate field it
// names, and the find answers only the rows where every paired field equals its
// argument.  The pairing is resolved once in enrichment and stored on
// `FindIR.paramBindings` (`src/ir/enrich/find-param-bindings.ts`); an unpaired
// parameter is refused (`loom.find-param-unbound`).
//
// ONE reading of that binding, because every backend has to agree about it and
// a backend that forgets it is silent: the query validates, compiles and passes
// its unit tests, then a lookup for a missing key answers 200 with some other
// row (or a non-unique-result 500 once two rows exist).  Backends that compose
// SQL from the pairs read `implicitFindMatches`; backends whose find path
// renders an `ExprIR` filter read `effectiveFindFilter`, which spells the same
// pairs as the `this.<field> == <param>` conjunction an author would have
// written.
// ---------------------------------------------------------------------------

import type { AggregateIR, ExprIR, FieldIR, FindIR, ParamIR, TypeIR } from "../types/loom-ir.js";

export interface ImplicitFindMatch {
  param: ParamIR;
  field: FieldIR;
}

/** The (param, field) pairs a clause-less find filters on, in parameter order,
 *  read from the binding enrichment stored on the find.  Meaningful only when
 *  `find.filter` is absent — an explicit `where` replaces the convention
 *  entirely. */
export function implicitFindMatches(
  find: Pick<FindIR, "params" | "paramBindings">,
  agg: Pick<AggregateIR, "fields">,
): ImplicitFindMatch[] {
  const out: ImplicitFindMatch[] = [];
  for (const b of find.paramBindings ?? []) {
    const param = find.params.find((p) => p.name === b.param);
    const field = agg.fields.find((f) => f.name === b.field);
    if (param && field) out.push({ param, field });
  }
  return out;
}

const BOOL: TypeIR = { kind: "primitive", name: "bool" };

/** The predicate a find filters its rows by: the declared `where` when there is
 *  one, otherwise the implicit `this.<field> == <param> && …` conjunction of
 *  its convention pairs.  `undefined` when the find filters nothing (no `where`
 *  and no parameter naming a field — e.g. `find all()`). */
export function effectiveFindFilter(
  find: Pick<FindIR, "params" | "paramBindings" | "filter">,
  agg: Pick<AggregateIR, "fields">,
): ExprIR | undefined {
  if (find.filter) return find.filter;
  let out: ExprIR | undefined;
  for (const { param, field } of implicitFindMatches(find, agg)) {
    const eq: ExprIR = {
      kind: "binary",
      op: "==",
      left: { kind: "ref", name: field.name, refKind: "this-prop", type: field.type },
      right: { kind: "ref", name: param.name, refKind: "param", type: param.type },
      leftType: field.type,
      rightType: param.type,
      resultType: BOOL,
    };
    out = out
      ? {
          kind: "binary",
          op: "&&",
          left: out,
          right: eq,
          leftType: BOOL,
          rightType: BOOL,
          resultType: BOOL,
        }
      : eq;
  }
  return out;
}
