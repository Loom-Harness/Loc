// The tenancy registry's `organizationContext.ancestors` walk — ONE SQL text
// every backend sends (D-TENANCY-FLAT item 4).
//
// The operating org and every org above it, read off the registry's `parent`
// self-reference with a recursive CTE.  `UNION` (not `UNION ALL`) is the cycle
// guard: an author-written `parent := to` can close a loop, and set semantics
// stop the recursion the first time a `(id, parent)` row repeats, so the walk
// terminates on any registry the model can produce.  The walk deliberately
// applies no read scope: it is the tree's structure, computed for the request's
// own operating org, which the switch gate has already admitted.
//
// Each backend's auth middleware runs it once per request and memoizes the
// result on the principal (`operatingAncestors`).

import { aggregateTableName } from "../../ir/enrich/storage-names.js";
import type { BoundedContextIR, SystemIR } from "../../ir/types/loom-ir.js";
import { registryContextName } from "../../ir/util/org-context.js";
import { resolveContextSchema } from "../../ir/util/resolve-datasource.js";

/** The registry's id and self-reference columns.  The registry is a plain
 *  aggregate (`id` key) and `tenantRegistry` provides `parent: Self id?`, whose
 *  column is the field name in snake case. */
const ID_COLUMN = "id";
const PARENT_COLUMN = "parent";

/** The quoted, schema-qualified table the registry's rows live in, or
 *  `undefined` when the system declares no registry context. */
export function registryTableSql(sys: SystemIR): string | undefined {
  const ctxName = registryContextName(sys);
  if (!ctxName) return undefined;
  const ctx: BoundedContextIR | undefined = sys.subdomains
    .flatMap((s) => s.contexts)
    .find((c) => c.name === ctxName);
  const registry = ctx?.aggregates.find((a) => a.name === sys.tenancy?.registryName);
  if (!ctx || !registry) return undefined;
  const table = `"${aggregateTableName(registry, ctx.aggregates)}"`;
  const schema = resolveContextSchema(ctx, sys);
  return schema ? `"${schema}".${table}` : table;
}

/** The ancestors walk over `table` (a {@link registryTableSql} result), with
 *  `param` as the operating org's placeholder in the backend's own driver
 *  syntax (`$1`, `?`, `@org`, `:org`).  Selects one `id` column. */
export function registryAncestorsSql(table: string, param: string): string {
  return (
    `WITH RECURSIVE up(${ID_COLUMN}, ${PARENT_COLUMN}) AS (` +
    `SELECT ${ID_COLUMN}, ${PARENT_COLUMN} FROM ${table} WHERE ${ID_COLUMN} = ${param} ` +
    `UNION SELECT o.${ID_COLUMN}, o.${PARENT_COLUMN} FROM ${table} o JOIN up ON o.${ID_COLUMN} = up.${PARENT_COLUMN}` +
    `) SELECT ${ID_COLUMN} FROM up`
  );
}
