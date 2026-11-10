import { aggregateTableName } from "../ir/enrich/storage-names.js";
import type {
  EnrichedAggregateIR,
  EnrichedBoundedContextIR,
  EnrichedSubdomainIR,
  EnumValueRenameIntentIR,
  FieldIR,
  SavingShape,
  TypeIR,
} from "../ir/types/loom-ir.js";
import type { ColumnShape, SchemaSnapshot } from "../ir/types/migrations-ir.js";
import { valueObjectPool } from "../ir/util/reachable-types.js";
import { snake } from "../util/naming.js";

// ---------------------------------------------------------------------------
// Enum VALUE renames (`migration "…" { Status.Draft -> Pending }`).
//
// Stored rows hold an enum value by its NAME, so renaming one in the model
// leaves every existing row holding a value the model no longer declares.  A
// declared rename turns into one data UPDATE per column that stores the enum,
// emitted once through the snapshot's `appliedDataMigrations` ledger.
//
// What "stores the enum" means is decided by the column mapper, not here: the
// table builders tag each scalar or array column with the enum it holds
// (`ColumnShape.enumOf`), so the UPDATEs reach exactly the columns the schema
// creates — aggregate roots, TPH/TPC tables, parts, flattened value objects,
// value-collection child tables, and the saga / projection state tables.
//
// Deliberately NOT rewritten, each for a stated reason:
//   * the audit and provenance logs — append-only history of what was written
//     at the time; rewriting it would falsify the record;
//   * JSON storage — a document-shaped aggregate's `data`, an embedded
//     containment, a value object collapsed to one column, and the payloads of
//     an event-sourced stream.  Their shape is a backend's serialisation, and
//     an event log is immutable history the stream is folded from; a rename
//     whose enum reaches one is announced (`loom.migration-enum-value-unmigrated`)
//     naming each place, so the author remaps or upcasts it deliberately.
// ---------------------------------------------------------------------------

/** The enum a column stores — the type itself, behind `optional`, or as the
 *  element of an array column.  Undefined for every other type. */
export function enumStoredBy(t: TypeIR): string | undefined {
  if (t.kind === "optional") return enumStoredBy(t.inner);
  if (t.kind === "enum") return t.name;
  if (t.kind === "array") {
    const el = t.element.kind === "optional" ? t.element.inner : t.element;
    return el.kind === "enum" ? el.name : undefined;
  }
  return undefined;
}

/** The ledger key of an enum value rename — the same `<block>#<index>` shape
 *  a raw `sql` step uses, so one block's steps share one ledger. */
export function enumRenameKey(r: Pick<EnumValueRenameIntentIR, "migration" | "index">): string {
  return `${r.migration}#${r.index}`;
}

const lit = (v: string): string => `'${v.replaceAll("'", "''")}'`;
const qi = (name: string): string => `"${name.replaceAll('"', '""')}"`;

/** The UPDATE remapping one column's stored `from` to `to`.  A scalar column
 *  is matched by equality; an enum ARRAY column (`TEXT[]`) has the element
 *  replaced in place, so an array holding the old value keeps its order. */
export function renderEnumValueUpdate(
  schema: string | undefined,
  table: string,
  column: ColumnShape,
  from: string,
  to: string,
): string {
  const rel = schema ? `${qi(schema)}.${qi(table)}` : qi(table);
  const col = qi(column.name);
  return column.type.kind === "array"
    ? `UPDATE ${rel} SET ${col} = array_replace(${col}, ${lit(from)}, ${lit(to)}) WHERE ${lit(from)} = ANY(${col})`
    : `UPDATE ${rel} SET ${col} = ${lit(to)} WHERE ${col} = ${lit(from)}`;
}

/** One module's data UPDATEs for its not-yet-applied enum value renames, in
 *  declaration order, one statement per storing column (Ecto's `execute/1`
 *  runs one statement at a time).  Every UPDATE of one step carries the
 *  step's ledger key. */
export function enumValueRenameUpdates(
  next: SchemaSnapshot,
  intents: readonly EnumValueRenameIntentIR[],
  applied: ReadonlySet<string>,
): { key: string; sql: string }[] {
  const out: { key: string; sql: string }[] = [];
  for (const r of intents) {
    const key = enumRenameKey(r);
    if (applied.has(key)) continue;
    for (const t of next.tables) {
      for (const c of t.columns) {
        if (c.enumOf !== r.enum) continue;
        out.push({ key, sql: renderEnumValueUpdate(t.schema, t.name, c, r.from, r.to) });
      }
    }
  }
  return out;
}

/** True when the module stores `enumName` in any column — the modules a
 *  rename's UPDATEs (and its block's other steps) belong to. */
export function moduleStoresEnum(next: SchemaSnapshot, enumName: string): boolean {
  return next.tables.some((t) => t.columns.some((c) => c.enumOf === enumName));
}

/** Every place in `module` that stores `enumName` inside JSON, which the
 *  generated UPDATEs do not rewrite — one human-readable line per place. */
export function enumJsonPlaces(
  module: EnrichedSubdomainIR,
  enumName: string,
  shapeOf: (agg: EnrichedAggregateIR, ctx: EnrichedBoundedContextIR) => SavingShape,
  schemaOf: (agg: EnrichedAggregateIR, ctx: EnrichedBoundedContextIR) => string | undefined,
  contextSchemaOf: (ctx: EnrichedBoundedContextIR) => string | undefined,
): string[] {
  const out: string[] = [];
  for (const ctx of module.contexts) {
    const vos = new Map(valueObjectPool(ctx).map((v) => [v.name, v.fields] as const));
    const reaches = (fields: readonly FieldIR[], seen = new Set<string>()): boolean =>
      fields.some((f) => typeReaches(f.type, enumName, vos, seen));
    const rel = (schema: string | undefined, table: string): string =>
      schema ? `${schema}.${table}` : table;
    for (const agg of ctx.aggregates) {
      if (agg.persistedAs === "eventLog") continue; // its events are checked below
      const table = rel(schemaOf(agg, ctx), aggregateTableName(agg, ctx.aggregates));
      const shape = shapeOf(agg, ctx);
      if (shape === "document") {
        if (reaches(agg.fields) || agg.parts.some((p) => reaches(p.fields))) {
          out.push(`  - ${table}.data (the document of ${agg.name})`);
        }
        continue;
      }
      if (shape === "embedded") {
        for (const c of agg.contains) {
          const part = agg.parts.find((p) => p.name === c.partName);
          if (part && reaches(part.fields)) {
            out.push(`  - ${table}.${snake(c.name)} (embedded ${part.name})`);
          }
        }
        for (const f of agg.fields) {
          const base = f.type.kind === "optional" ? f.type.inner : f.type;
          if (base.kind === "valueobject" && typeReaches(base, enumName, vos, new Set())) {
            out.push(`  - ${table}.${snake(f.name)} (value object ${base.name})`);
          }
        }
      }
    }
    const hasEventStream =
      ctx.aggregates.some((a) => a.persistedAs === "eventLog") ||
      ctx.workflows.some((w) => w.eventSourced);
    if (!hasEventStream) continue;
    const log = rel(contextSchemaOf(ctx), `${snake(ctx.name)}_events`);
    for (const ev of ctx.events) {
      if (reaches(ev.fields)) out.push(`  - ${log}.data (payloads of ${ev.name})`);
    }
  }
  return out;
}

function typeReaches(
  t: TypeIR,
  enumName: string,
  vos: ReadonlyMap<string, readonly FieldIR[]>,
  seen: Set<string>,
): boolean {
  switch (t.kind) {
    case "enum":
      return t.name === enumName;
    case "optional":
      return typeReaches(t.inner, enumName, vos, seen);
    case "array":
      return typeReaches(t.element, enumName, vos, seen);
    case "valueobject": {
      if (seen.has(t.name)) return false;
      seen.add(t.name);
      return (vos.get(t.name) ?? []).some((f) => typeReaches(f.type, enumName, vos, seen));
    }
    default:
      return false;
  }
}
