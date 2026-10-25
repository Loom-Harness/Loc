// ---------------------------------------------------------------------------
// Abstract-base polymorphic reader — the shape shared by the repository, the
// context façade and the controller (inheritance.md).
//
// The base owns no read logic of its own: both layouts DELEGATE to the concrete
// repositories (TPH shares one table, but every concrete's `kind` conjunct and
// capability/inline filters live in ITS repository — reading the shared table
// directly would serve soft-deleted and cross-tenant rows).  So the base's
// arity is derived from the concretes it fronts: it threads `current_user` when
// any concrete read needs the actor, and drains a paged concrete's pages.
// ---------------------------------------------------------------------------

import { pagedReturn } from "../../../ir/stdlib/generics.js";
import type { AggregateIR, BoundedContextIR, SystemIR } from "../../../ir/types/loom-ir.js";
import { isTphBase, tpcConcretesOf, tphConcretesOf } from "../../../ir/util/inheritance.js";
import { aggregateUsesPrincipalContextFilter, listUsesPrincipal } from "./capability-filter.js";
import { isVanillaDocAgg } from "./document-emit.js";

export interface BaseReaderConcrete {
  agg: AggregateIR;
  /** `shape: document` concrete — the row carries its fields in `data`. */
  doc: boolean;
  /** The concrete's `list` returns the `paged` envelope (relational only). */
  paged: boolean;
  /** The concrete's `list` takes the actor. */
  listActor: boolean;
  /** The concrete's `find_by_id` takes the actor. */
  findActor: boolean;
}

export interface BaseReaderShape {
  concretes: BaseReaderConcrete[];
  /** Any concrete `list` needs the actor. */
  listActor: boolean;
  /** Any concrete `find_by_id` needs the actor. */
  findActor: boolean;
  /** The base `list`/`find_by_id` carry a `current_user \\ nil` parameter. */
  principal: boolean;
}

export function baseReaderShape(
  base: AggregateIR,
  ctx: BoundedContextIR,
  sys?: SystemIR,
): BaseReaderShape {
  const pool = ctx.aggregates;
  const members = isTphBase(base, pool) ? tphConcretesOf(base, pool) : tpcConcretesOf(base, pool);
  const concretes = members.map((agg): BaseReaderConcrete => {
    const doc = isVanillaDocAgg(agg, ctx, sys);
    const allFind = (ctx.repositories ?? [])
      .find((r) => r.aggregateName === agg.name)
      ?.finds?.find((f) => f.name === "all");
    const findActor = aggregateUsesPrincipalContextFilter(agg);
    return {
      agg,
      doc,
      paged: !doc && !!allFind && !!pagedReturn(allFind.returnType),
      listActor: doc ? findActor : listUsesPrincipal(agg, allFind),
      findActor,
    };
  });
  const listActor = concretes.some((c) => c.listActor);
  const findActor = concretes.some((c) => c.findActor);
  return { concretes, listActor, findActor, principal: listActor || findActor };
}
