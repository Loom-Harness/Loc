// ---------------------------------------------------------------------------
// Where a collection of references (`X id[]`) or of value objects (`<VO>[]`)
// can live in PERSISTED state (M-T9.82).
//
// The shared schema (`src/system/migrations-builder.ts`) gives these two
// collection kinds a home in exactly two positions:
//
//   - `X id[]`  — an aggregate's OWN, non-optional field → a join table
//                 (`AssociationIR`); a projection / workflow state field →
//                 one jsonb id-array column.
//   - `<VO>[]`  — an aggregate's or entity part's OWN field → an id-less
//                 child table (`ValueCollectionIR`).
//
// Everywhere else the schema has no column for them and every backend
// diverged: drizzle dropped the column, JPA crashed looking for an
// association / value collection that was never derived, MikroORM crashed
// flattening a nested collection, EF and Ecto mapped a column the migration
// never created.  So the positions below are refused before generate rather
// than accepted and silently lost:
//
//   #optional-reference      `X id[]?` — a reference collection is a set, and
//                            the empty set already means "none"; the optional
//                            form fell through to a native-array column only
//                            some backends mapped.
//   #part-reference          `X id[]` on an entity part — no join table is
//                            derived for a part (associations are per
//                            aggregate root), so the ids were never stored.
//   #state-value-collection  `<VO>[]` on a projection / workflow state row —
//                            no child table is created for a state row.
//   #nested-in-value-object  a value object reached from persisted state that
//                            itself holds an `X id[]` / `<VO>[]` — a value
//                            object flattens into scalar `<field>_<sub>`
//                            columns, and a collection has no such column.
// ---------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import type { BoundedContextIR, FieldIR, TypeIR, ValueObjectIR } from "../../types/loom-ir.js";
import { findValueObjectInScope } from "../../util/reachable-types.js";
import type { LoomDiagnostic } from "./diagnostic.js";

type Owner = "aggregate" | "part" | "projection" | "workflow";

function unwrap(t: TypeIR): TypeIR {
  return t.kind === "optional" ? t.inner : t;
}

/** `X id[]` / `<VO>[]` (optionally `?`-wrapped) → which collection kind. */
function collectionKind(t: TypeIR): "reference" | "value" | undefined {
  const a = unwrap(t);
  if (a.kind !== "array") return undefined;
  if (a.element.kind === "id") return "reference";
  if (a.element.kind === "valueobject") return "value";
  return undefined;
}

/** The first `X id[]` / `<VO>[]` field inside value object `voName` (searched
 *  through nested value-object fields and value-collection elements), as a
 *  dotted path below the VO — or undefined when it holds none. */
function nestedCollectionPath(
  ctx: BoundedContextIR,
  voName: string,
  seen: Set<string>,
): string | undefined {
  if (seen.has(voName)) return undefined;
  seen.add(voName);
  const vo: ValueObjectIR | undefined = findValueObjectInScope(ctx, voName);
  if (!vo) return undefined;
  for (const f of vo.fields) {
    if (collectionKind(f.type)) return f.name;
    const inner = unwrap(f.type);
    if (inner.kind === "valueobject") {
      const below = nestedCollectionPath(ctx, inner.name, seen);
      if (below) return `${f.name}.${below}`;
    }
  }
  return undefined;
}

function checkField(
  ctx: BoundedContextIR,
  owner: Owner,
  ownerName: string,
  f: FieldIR,
  diags: LoomDiagnostic[],
): void {
  const p = { owner, ownerName, field: f.name };
  const push = (message: string): void => {
    diags.push({
      severity: "error",
      code: "loom.collection-field-unpersisted",
      message,
      source: `${ctx.name}/${owner} ${ownerName}.${f.name}`,
    });
  };
  const nested = (voName: string): void => {
    const path = nestedCollectionPath(ctx, voName, new Set());
    if (path) {
      push(
        diagMessage("loom.collection-field-unpersisted#nested-in-value-object", {
          ...p,
          voName,
          path,
        }),
      );
    }
  };
  const kind = collectionKind(f.type);
  if (kind === "reference") {
    if (f.type.kind === "optional" || f.optional) {
      push(diagMessage("loom.collection-field-unpersisted#optional-reference", p));
    } else if (owner === "part") {
      push(diagMessage("loom.collection-field-unpersisted#part-reference", p));
    }
    return;
  }
  const inner = unwrap(f.type);
  if (kind === "value") {
    if (owner === "projection" || owner === "workflow") {
      push(diagMessage("loom.collection-field-unpersisted#state-value-collection", p));
    } else if (inner.kind === "array" && inner.element.kind === "valueobject") {
      nested(inner.element.name);
    }
    return;
  }
  if (inner.kind === "valueobject") nested(inner.name);
}

export function validatePersistedCollectionPositions(
  ctx: BoundedContextIR,
  diags: LoomDiagnostic[],
): void {
  for (const agg of ctx.aggregates) {
    for (const f of agg.fields) checkField(ctx, "aggregate", agg.name, f, diags);
    for (const part of agg.parts) {
      for (const f of part.fields) checkField(ctx, "part", part.name, f, diags);
    }
  }
  for (const proj of ctx.projections) {
    // A query-time projection (`from … select …`) keeps no table.
    if (proj.query) continue;
    for (const f of proj.stateFields) checkField(ctx, "projection", proj.name, f, diags);
  }
  for (const wf of ctx.workflows) {
    // Only a correlation-bearing, state-row workflow keeps a table; an
    // eventSourced one folds its state from its stream.
    if (wf.eventSourced || !wf.correlationField) continue;
    for (const f of wf.stateFields ?? []) checkField(ctx, "workflow", wf.name, f, diags);
  }
}
