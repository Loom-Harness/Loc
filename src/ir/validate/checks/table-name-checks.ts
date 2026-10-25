// -------------------------------------------------------------------------
// Persisted-table name collisions (`loom.persisted-table-collision`).
//
// Every persisted declaration in a context owns a physical table whose name is
// DERIVED from its declared name: an aggregate `Sweep` → `sweeps`, a workflow
// `sweep` → `sweeps`, a part `Line` → `lines`, a materialized projection, a
// `X id[]` join table, a `<VO>[]` child table, the `<ctx>_events` log.  Two of
// them deriving the same name is a valid-looking model that every backend turns
// into broken output — the migration CREATEs the table twice, the Drizzle
// schema exports the same const twice, the ORMs bind two models to one
// relation.  The namespace checks compare DECLARED names (case-sensitively),
// so `workflow sweep` beside `aggregate Sweep` passes them; this check compares
// the derived TABLE names instead.
//
// The derivation mirrors `schemaFromModule` (src/system/migrations-builder.ts)
// table for table; `test/ir/persisted-table-collision.test.ts` pins the two
// against each other over a corpus, so the check cannot drift from the DDL it
// guards.  Scope is one context: every table a context owns lands in that
// context's schema, while sibling contexts get their own schema by default.
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import { plural, snake } from "../../../util/naming.js";
import type { BoundedContextIR } from "../../types/loom-ir.js";
import { isMaterializedProjection } from "../../types/loom-ir.js";
import type { OriginRef } from "../../types/origin.js";
import { isTphBase, isTphConcrete } from "../../util/inheritance.js";
import { valueCollectionsFor } from "../../util/value-collections.js";
import type { LoomDiagnostic } from "./diagnostic.js";

export interface PersistedTable {
  /** The physical table name the migration DDL creates. */
  readonly table: string;
  /** Human-readable owner, e.g. `aggregate 'Sweep'`. */
  readonly owner: string;
  /** The declared name the table derives from (`Sweep`). */
  readonly declaredName: string;
  readonly kind:
    | "aggregate"
    | "part"
    | "join"
    | "value-collection"
    | "workflow"
    | "projection"
    | "event-log";
  /** Source span of the declaration, when lowering captured one. */
  readonly origin?: OriginRef;
}

/** Every table a context's own declarations persist to, in declaration order.
 *  Saving-shape bindings declared on a `resource` can only REMOVE part / join
 *  tables (document / embedded fold them into the root row); the aggregate's
 *  own `savingShape` is honoured here, so a binding-only override can at most
 *  make this list a superset of the DDL. */
export function persistedTablesOf(ctx: BoundedContextIR): PersistedTable[] {
  const out: PersistedTable[] = [];
  const pool = ctx.aggregates;
  let hasEventStream = false;
  for (const agg of pool) {
    if (agg.isAbstract && !isTphBase(agg, pool)) continue;
    if (isTphConcrete(agg, pool)) {
      for (const part of agg.parts) {
        out.push({
          table: plural(snake(part.name)),
          owner: `entity '${part.name}' of aggregate '${agg.name}'`,
          declaredName: part.name,
          kind: "part",
          origin: agg.origin,
        });
      }
      continue;
    }
    if (agg.persistedAs === "eventLog") {
      hasEventStream = true;
      continue;
    }
    out.push({
      table: plural(snake(agg.name)),
      owner: `aggregate '${agg.name}'`,
      declaredName: agg.name,
      kind: "aggregate",
      origin: agg.origin,
    });
    if (isTphBase(agg, pool)) continue;
    const shape = agg.savingShape ?? "relational";
    if (shape !== "relational") continue;
    for (const part of agg.parts) {
      out.push({
        table: plural(snake(part.name)),
        owner: `entity '${part.name}' of aggregate '${agg.name}'`,
        declaredName: part.name,
        kind: "part",
        origin: agg.origin,
      });
    }
    for (const assoc of agg.associations ?? []) {
      out.push({
        table: assoc.joinTable,
        owner: `the join table of '${agg.name}.${assoc.fieldName}'`,
        declaredName: `${agg.name}.${assoc.fieldName}`,
        kind: "join",
        origin: agg.origin,
      });
    }
    for (const owner of [agg, ...agg.parts]) {
      for (const vc of valueCollectionsFor(owner)) {
        out.push({
          table: vc.childTable,
          owner: `the value-collection table of '${owner.name}.${vc.fieldName}'`,
          declaredName: `${owner.name}.${vc.fieldName}`,
          kind: "value-collection",
          origin: agg.origin,
        });
      }
    }
  }
  for (const wf of ctx.workflows) {
    if (wf.eventSourced) {
      hasEventStream = true;
      continue;
    }
    if (!wf.correlationField) continue;
    out.push({
      table: plural(snake(wf.name)),
      owner: `workflow '${wf.name}'`,
      declaredName: wf.name,
      kind: "workflow",
      origin: wf.origin,
    });
  }
  for (const proj of ctx.projections) {
    if (!isMaterializedProjection(proj)) continue;
    out.push({
      table: plural(snake(proj.name)),
      owner: `projection '${proj.name}'`,
      declaredName: proj.name,
      kind: "projection",
      origin: proj.origin,
    });
  }
  if (hasEventStream) {
    out.push({
      table: `${snake(ctx.name)}_events`,
      owner: `the event log of context '${ctx.name}'`,
      declaredName: ctx.name,
      kind: "event-log",
    });
  }
  return out;
}

export function validatePersistedTableCollisions(
  ctx: BoundedContextIR,
  diags: LoomDiagnostic[],
): void {
  const byTable = new Map<string, PersistedTable>();
  for (const t of persistedTablesOf(ctx)) {
    const first = byTable.get(t.table);
    if (!first) {
      byTable.set(t.table, t);
      continue;
    }
    // A workflow and an aggregate with the IDENTICAL name are already refused
    // by `loom.workflow-name-collision`; repeating it as a table clash would
    // only double the report.  Every other identical-name pair (an aggregate
    // and a projection, two same-named parts) has no namespace gate, so it is
    // reported here.
    const kinds = new Set([first.kind, t.kind]);
    if (first.declaredName === t.declaredName && kinds.has("workflow") && kinds.has("aggregate")) {
      continue;
    }
    diags.push({
      severity: "error",
      code: "loom.persisted-table-collision",
      message: diagMessage("loom.persisted-table-collision", {
        ctx: ctx.name,
        first: first.owner,
        second: t.owner,
        table: t.table,
      }),
      source: `${ctx.name}/${t.declaredName}`,
      origin: t.origin,
    });
  }
}
