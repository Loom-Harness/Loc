// Phase ⑥ — the repository methods behind widened single-row reads.
//
// `Orders.find(ByRef(r)) ignoring softDeletable` / `Orders.findById(id)
// ignoring *` lowers to a read that names a method of its own
// (`bypassReadMethodName`: `findFirstByRefIgnoringSoftDeletable` /
// `findByIdIgnoringAll`) and carries a `BypassReadIR` (the criterion or the
// id, plus the `ignoring` stance).  The plain reads cannot carry the stance:
// `find(C)` runs the criterion's `findAllBy<C>` retrieval and `findById` the
// by-id load, both shared with every other caller, whose filters must stay on.
// So the widened read's method is derived here, one `synthesized` find per
// distinct method, with
//
//   - a criterion source: the criterion's parameters and predicate (already in
//     the find's own scope — parameters as `param` refs, candidate fields as
//     `this`-rooted reads) and its `criterionRef`, exactly the find a paged
//     `queryHandler` over the criterion is given;
//   - an id source: one `id` parameter and `this.id == id`;
//   - `T?` — both reads answer absence; a criterion read is `takeFirst`, as
//     `find(C)` answers the first match of a predicate that may match many;
//   - the stance as `bypassAll` / `bypassCaps`, which every backend's find
//     emitter already honours (the capability query-filters a declared
//     `find … ignoring …` drops).
//
// `synthesized` keeps the method off the HTTP surface: it is called from
// bodies only.  A name a declared find already owns is left to the declaration.

import { bypassReadMethodName } from "../../util/repository-contract.js";
import type {
  AggregateIR,
  BypassReadIR,
  CriterionIR,
  ExprIR,
  FindIR,
  RepositoryIR,
  TypeIR,
} from "../types/loom-ir.js";

/** One widened single-row read a context makes. */
export interface BypassRead {
  repoName: string;
  read: BypassReadIR;
}

const BOOL: TypeIR = { kind: "primitive", name: "bool" };

function stance(read: BypassReadIR): Pick<FindIR, "bypassAll" | "bypassCaps"> {
  if (read.bypassAll) return { bypassAll: true };
  return read.bypassCaps?.length ? { bypassCaps: [...read.bypassCaps] } : {};
}

function bypassFind(
  read: BypassReadIR,
  agg: AggregateIR,
  criteria: readonly CriterionIR[],
): FindIR | undefined {
  const entity: TypeIR = { kind: "entity", name: agg.name };
  const name = bypassReadMethodName(read.source, read);
  const returnType: TypeIR = { kind: "optional", inner: entity };
  if (read.source.kind === "id") {
    const idType: TypeIR = { kind: "id", targetName: agg.name, valueType: agg.idValueType };
    const filter: ExprIR = {
      kind: "binary",
      op: "==",
      left: {
        kind: "member",
        receiver: { kind: "this" },
        member: "id",
        receiverType: entity,
        memberType: idType,
      },
      right: { kind: "ref", name: "id", refKind: "param", type: idType },
      leftType: idType,
      rightType: idType,
      resultType: BOOL,
    };
    return {
      name,
      params: [{ name: "id", type: idType }],
      returnType,
      filter,
      ...stance(read),
      synthesized: true,
    };
  }
  const critName = read.source.name;
  const crit = criteria.find((c) => c.name === critName);
  // A missing criterion, or one over another candidate, is refused in phase ⑦
  // (`loom.findall-unknown-criterion` / `loom.findall-criterion-mismatch`);
  // there is no method to derive.
  const candidate = crit?.targetType.kind === "entity" ? crit.targetType.name : undefined;
  if (!crit || candidate !== agg.name) {
    return undefined;
  }
  return {
    name,
    params: crit.params,
    returnType,
    filter: structuredClone(crit.body),
    criterionRef: {
      name: crit.name,
      args: crit.params.map(
        (p): ExprIR => ({ kind: "ref", name: p.name, refKind: "param", type: p.type }),
      ),
    },
    ...stance(read),
    takeFirst: true,
    synthesized: true,
  };
}

/** Add the method behind every widened single-row read in `reads` to its
 *  repository, deduped by method name. */
export function synthesizeBypassReadFinds(
  repositories: readonly RepositoryIR[],
  aggregates: readonly AggregateIR[],
  criteria: readonly CriterionIR[] | undefined,
  reads: readonly BypassRead[],
): RepositoryIR[] {
  if (reads.length === 0) return [...repositories];
  const aggByName = new Map(aggregates.map((a) => [a.name, a] as const));
  return repositories.map((repo) => {
    const mine = reads.filter((r) => r.repoName === repo.name);
    if (mine.length === 0) return repo;
    const agg = aggByName.get(repo.aggregateName);
    if (!agg) return repo;
    const finds = [...repo.finds];
    for (const { read } of mine) {
      if (finds.some((f) => f.name === bypassReadMethodName(read.source, read))) continue;
      const find = bypassFind(read, agg, criteria ?? []);
      if (find) finds.push(find);
    }
    return { ...repo, finds };
  });
}
