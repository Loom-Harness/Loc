// Phase ⑥ storage-name fact — the SQL table and URL route segment of every
// aggregate, part, projection, join table and workflow state row.
//
// No IR node stores a table name: it is a pure function of the declaration's
// name (and, for a TPH concrete, of the `extends` chain that puts its rows in
// its base's table), so it is DERIVED on demand here (CLAUDE.md "Derive, don't
// stamp") and cannot go stale.  What it must not be is derived TWICE: the
// spelling lives in `src/util/storage-names.ts` (`plural(snake(name))`, the
// one the migrations have always used), and these accessors decide only which
// name a node's table is spelled from.  The migrations builder and every
// backend's ORM mapping read the same accessor, so the table a migration
// creates is the table the ORM reads.
//
// Emitters read a table only through these node accessors, never by calling
// the name-keyed `tableNameFor` with a name they picked: the choice of which
// declaration a table is spelled from is exactly the fact a backend must not
// re-derive.  `test/system/storage-names-census.test.ts` enforces both that and
// the ban on spelling a table or a route by hand (`plural(snake(…))`,
// `snake(plural(…))`).

import { workflowStateTableName } from "../../util/naming.js";
import { routeSegmentFor, tableNameFor } from "../../util/storage-names.js";
import type {
  AggregateIR,
  AssociationIR,
  EntityPartIR,
  ProjectionIR,
  SystemIR,
  WorkflowIR,
} from "../types/loom-ir.js";
import { type AggPool, projectionSourceTable, tableOwnerName } from "../util/inheritance.js";
import { hierarchyRegistry } from "../util/tenant-stance.js";

export { routeSegmentFor, tableNameFor };

/** The table an aggregate's rows live in.  A TPH concrete shares its root
 *  base's table (`Car` → `vehicles`); every other aggregate — a TPC concrete,
 *  a TPH base, a standalone aggregate — owns the table spelled from its own
 *  name. */
export function aggregateTableName(agg: AggregateIR, pool: AggPool): string {
  return tableNameFor(tableOwnerName(agg, pool));
}

/** The table the rows of the aggregate named `name` live in, resolved in
 *  `pool` (a seed row or a projection source names its aggregate).  A name
 *  outside `pool` owns the table spelled from itself. */
export function aggregateTableNameOf(name: string, pool: AggPool): string {
  const agg = pool.find((a) => a.name === name);
  return agg ? aggregateTableName(agg, pool) : tableNameFor(name);
}

/** The table a projection's `from <Source>` arm reads: its table owner's (a
 *  TPH concrete's rows live in the root's shared table, scoped by `kind`).  A
 *  source outside `pool` owns the table spelled from its own name. */
export function projectionSourceTableName(source: string, pool: AggPool): string {
  return tableNameFor(projectionSourceTable(source, pool).tableOwner);
}

/** The tenant registry's table, resolved in the context that declares it, or
 *  undefined when the system has no hierarchical registry. */
export function registryTableName(
  sys: Pick<SystemIR, "tenancy" | "subdomains">,
): string | undefined {
  const reg = hierarchyRegistry(sys);
  if (!reg) return undefined;
  for (const mod of sys.subdomains) {
    for (const ctx of mod.contexts) {
      if (ctx.aggregates.includes(reg)) return aggregateTableName(reg, ctx.aggregates);
    }
  }
  return undefined;
}

/** The child table of a contained entity part (`VariantSKU` → `variant_skus`). */
export function partTableName(part: Pick<EntityPartIR, "name">): string {
  return tableNameFor(part.name);
}

/** A folded projection's read-model table (`StockPerSKU` → `stock_per_skus`). */
export function projectionTableName(proj: Pick<ProjectionIR, "name">): string {
  return tableNameFor(proj.name);
}

/** A workflow's persisted correlation-state table. */
export function workflowStateTable(wf: Pick<WorkflowIR, "name">): string {
  return workflowStateTableName(wf.name);
}

/** The join table of an `X id[]` reference collection, and the two tables its
 *  foreign keys reference.  The owner FK points at the table the owner's rows
 *  live in — the base's shared table for a TPH concrete owner. */
export function associationTables(
  assoc: AssociationIR,
  pool: AggPool,
): { joinTable: string; ownerTable: string; targetTable: string } {
  const owner = pool.find((a) => a.name === assoc.ownerAgg);
  return {
    joinTable: assoc.joinTable,
    ownerTable: owner ? aggregateTableName(owner, pool) : tableNameFor(assoc.ownerAgg),
    targetTable: tableNameFor(assoc.targetAgg),
  };
}
