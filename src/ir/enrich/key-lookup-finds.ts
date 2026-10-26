// Phase ⑥ — the repository methods behind natural-key reads (D-REPO-KEY-LOOKUP).
//
// `Products.findBy(sku: s)` / `Products.getBy(sku: s)` lowers to a read that
// names a method (`findBySku` / `getBySku`, `keyLookupMethodName`) and carries
// its key (`KeyLookupIR`: the declared `unique (…)` tuple + the `ignoring`
// stance).  The method's existence is a pure function of the reads a context
// makes, so it is derived here rather than declared: one `synthesized` find per
// distinct method, with
//
//   - one parameter per tuple column, typed as the column's field;
//   - a `where` that is the conjunction `this.<col> == <col>` over the tuple;
//   - `T?` for `findBy`, `T` for `getBy` — the declared-find shape every
//     backend already emits (a `T` find answers not-found → 404 on a miss);
//   - the read's `ignoring` stance as `bypassAll` / `bypassCaps`, so the
//     capability query-filters (soft-delete, tenancy) apply exactly as on any
//     other read unless the call widens it.
//
// `synthesized` keeps the method off the HTTP surface (no find route, query
// schema or client hook): it is called from bodies only.  A name a declared
// find already owns is left to the declaration.

import type { RepoOp } from "../../util/repository-contract.js";
import type {
  AggregateIR,
  ExprIR,
  FindIR,
  KeyLookupIR,
  RepositoryIR,
  TypeIR,
} from "../types/loom-ir.js";

/** One natural-key read the context makes. */
export interface KeyLookupRead {
  repoName: string;
  op: Extract<RepoOp, "load-by-key" | "load-by-key-optional">;
  method: string;
  key: KeyLookupIR;
}

const BOOL: TypeIR = { kind: "primitive", name: "bool" };

function eq(entity: TypeIR, col: string, type: TypeIR): ExprIR {
  return {
    kind: "binary",
    op: "==",
    left: {
      kind: "member",
      receiver: { kind: "this" },
      member: col,
      receiverType: entity,
      memberType: type,
    },
    right: { kind: "ref", name: col, refKind: "param", type },
    leftType: type,
    rightType: type,
    resultType: BOOL,
  };
}

function keyFind(read: KeyLookupRead, agg: AggregateIR): FindIR | undefined {
  const entity: TypeIR = { kind: "entity", name: agg.name };
  const params: FindIR["params"] = [];
  let filter: ExprIR | undefined;
  for (const col of read.key.columns) {
    const field = agg.fields.find((f) => f.name === col);
    // A column that names no field is refused in phase ④
    // (`loom.unique-unknown-field` on the tuple, `loom.repo-key-not-unique`
    // on the call); there is no method to derive.
    if (!field) return undefined;
    const type = field.type.kind === "optional" ? field.type.inner : field.type;
    params.push({ name: col, type });
    const term = eq(entity, col, type);
    filter = filter
      ? { kind: "binary", op: "&&", left: filter, right: term, leftType: BOOL, resultType: BOOL }
      : term;
  }
  if (!filter) return undefined;
  return {
    name: read.method,
    params,
    returnType: read.op === "load-by-key" ? entity : { kind: "optional", inner: entity },
    filter,
    ...(read.key.bypassAll ? { bypassAll: true } : {}),
    ...(read.key.bypassCaps?.length ? { bypassCaps: [...read.key.bypassCaps] } : {}),
    synthesized: true,
  };
}

/** Add the method behind every natural-key read in `reads` to its repository,
 *  deduped by method name. */
export function synthesizeKeyLookupFinds(
  repositories: readonly RepositoryIR[],
  aggregates: readonly AggregateIR[],
  reads: readonly KeyLookupRead[],
): RepositoryIR[] {
  if (reads.length === 0) return [...repositories];
  const aggByName = new Map(aggregates.map((a) => [a.name, a] as const));
  return repositories.map((repo) => {
    const mine = reads.filter((r) => r.repoName === repo.name);
    if (mine.length === 0) return repo;
    const agg = aggByName.get(repo.aggregateName);
    if (!agg) return repo;
    const finds = [...repo.finds];
    for (const read of mine) {
      if (finds.some((f) => f.name === read.method)) continue;
      const find = keyFind(read, agg);
      if (find) finds.push(find);
    }
    return { ...repo, finds };
  });
}
