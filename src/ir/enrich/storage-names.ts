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
// `test/system/storage-names-census.test.ts` forbids spelling a table or a
// route by hand (`plural(snake(…))`, `snake(plural(…))`) in the generators,
// the platforms and the migrations builder.

import { workflowStateTableName } from "../../util/naming.js";
import { routeSegmentFor, tableNameFor } from "../../util/storage-names.js";
import type {
  AggregateIR,
  AssociationIR,
  EntityPartIR,
  ProjectionIR,
  WorkflowIR,
} from "../types/loom-ir.js";
import { type AggPool, tableOwnerName } from "../util/inheritance.js";

export { routeSegmentFor, tableNameFor };

/** The table an aggregate's rows live in.  A TPH concrete shares its root
 *  base's table (`Car` → `vehicles`); every other aggregate — a TPC concrete,
 *  a TPH base, a standalone aggregate — owns the table spelled from its own
 *  name. */
export function aggregateTableName(agg: AggregateIR, pool: AggPool): string {
  return tableNameFor(tableOwnerName(agg, pool));
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
