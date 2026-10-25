// Phase ⑥ — bind a clause-less find's parameters to the fields they filter on.
//
// `find byReference(reference: string): WorkOrder?` declares no `where`, yet it
// is a key lookup: each parameter pairs with the aggregate field it names — the
// field of the same name, or the field whose `<field>Id` spelling the parameter
// is (`siteId` → field `site`).  The pairing is resolved here, once, and stored
// on `FindIR.paramBindings`, so no backend matches names and every backend
// filters on the same pairs.  It runs after the inheritance field merge, so a
// parameter naming a base field binds on the concrete.
//
// A parameter that names no field gets no binding and is refused
// (`loom.find-param-unbound`): unrefused, the find would answer every lookup
// with an arbitrary row.

import type {
  AggregateIR,
  FieldIR,
  FindIR,
  FindParamBindingIR,
  RepositoryIR,
} from "../types/loom-ir.js";

/** The field a clause-less find parameter named `param` filters on. */
function fieldForParam(param: string, fields: readonly FieldIR[]): FieldIR | undefined {
  return fields.find((f) => f.name === param || `${f.name.replace(/Id$/, "")}Id` === param);
}

function bindFind(find: FindIR, agg: AggregateIR): FindIR {
  if (find.filter || find.params.length === 0) return find;
  const paramBindings: FindParamBindingIR[] = [];
  for (const p of find.params) {
    const field = fieldForParam(p.name, agg.fields);
    if (field) paramBindings.push({ param: p.name, field: field.name });
  }
  return { ...find, paramBindings };
}

/** Stamp `paramBindings` on every clause-less find of every repository whose
 *  aggregate is in `aggregates`.  Finds with a `where` or no parameters are
 *  returned unchanged. */
export function bindFindParams(
  repositories: readonly RepositoryIR[],
  aggregates: readonly AggregateIR[],
): RepositoryIR[] {
  const byName = new Map(aggregates.map((a) => [a.name, a] as const));
  return repositories.map((repo) => {
    const agg = byName.get(repo.aggregateName);
    if (!agg) return repo;
    return { ...repo, finds: repo.finds.map((f) => bindFind(f, agg)) };
  });
}
