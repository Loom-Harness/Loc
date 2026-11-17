// -------------------------------------------------------------------------
// MikroORM `@Entity` row-class emission — the schema layer every shape
// (relational / document / embedded / event-sourced) rides: column
// derivation from `TypeIR`, part/join/record row entities, and the
// timer-runs / outbox / audit / provenance / workflow / projection
// system-table entities `renderMikroEntities` assembles per module.  Split
// out of mikroorm.ts by packet 2.6 (wave-2) — mechanical move, no logic
// change.
// -------------------------------------------------------------------------

import type { CodecPrimitive } from "../../../ir/enrich/codec.js";
import { foldTenancyFor } from "../../../ir/enrich/fold-tenancy.js";
import {
  aggregateTableName,
  partTableName,
  projectionTableName,
} from "../../../ir/enrich/storage-names.js";
import {
  eventLogTable,
  eventSourcedWorkflows,
  hasStateRow,
  INBOX_TABLE,
} from "../../../ir/plan/index.js";
import { voLeaves } from "../../../ir/plan/value-object-columns.js";
import type {
  AssociationIR,
  EnrichedAggregateIR,
  EnrichedBoundedContextIR,
  EntityPartIR,
  FieldIR,
  ProjectionIR,
  TypeIR,
  WorkflowIR,
} from "../../../ir/types/loom-ir.js";
import { isMaterializedProjection } from "../../../ir/types/loom-ir.js";
import { directParentName } from "../../../ir/util/containment-parent.js";
import type { AggPool } from "../../../ir/util/inheritance.js";
import {
  discriminatorValue,
  isDiscriminatedTphBase,
  isTphBase,
  isTphConcrete,
  ownFieldsOf,
  tableOwnerName,
} from "../../../ir/util/inheritance.js";
import { findValueObjectInScope } from "../../../ir/util/reachable-types.js";
import { isRefCollectionType } from "../../../ir/util/ref-collection.js";
import { isValueCollectionType, valueCollectionsFor } from "../../../ir/util/value-collections.js";
import { lines } from "../../../util/code-builder.js";
import { snake, upperFirst, workflowStateTableName } from "../../../util/naming.js";
import { ROW_VERSION_FIELD } from "../../../util/row-version.js";
import { RUNTIME_TABLES } from "../../../util/runtime-tables.js";
import { TIMER_CLAIM_TABLE } from "../../../util/timer.js";
import { absenceProbe } from "../../_persistence/value-object-absence.js";
import { type MikroScalar, mikroScalar } from "../codec-spelling.js";
import { joinColumnName, joinTableConstName } from "../emit.js";
import { docFieldType } from "../repository-document-builder.js";
import {
  mikroSchemaFilterLines,
  mikroSchemaFilters,
  tphConcreteAggregates,
} from "./mikroorm-schema-filters.js";
import { usesRawFragment } from "./mikroorm-shared.js";

/** Row-entity class name for an aggregate (the MikroORM persistence model). */

export const rowClassOf = (aggName: string): string => `${aggName}Row`;

/** Row-entity class name for the shared per-context event-log stream row
 *  (`<Ctx>EventRow`) — one table for every `persistedAs: eventLog` aggregate in
 *  the context, discriminated by `streamType`. */
/** The MikroORM entity class for a context's shared `<ctx>_events` stream —
 *  exported so the ES-workflow fold helpers (workflow-eventsourced-builder.ts)
 *  can name it in their EntityManager branch. */

export const eventRowClassOf = (ctxName: string): string => `${upperFirst(ctxName)}EventRow`;

/** Pivot Row-entity class for an `Id[]` reference-collection association
 *  (`trainer_party` join table → `TrainerPartyRow`).  A plain composite-PK
 *  pivot, mirroring the drizzle many-to-many join table. */

export const joinRowClassOf = (assoc: AssociationIR): string =>
  `${upperFirst(joinTableConstName(assoc))}Row`;

// ---------------------------------------------------------------------------
// Column model — one entry per persisted column, matching the drizzle schema's
// property/column names (id, scalars, VO-flattened `field_sub`, id-ref) so the
// reused hydrate/save builders line up.
// ---------------------------------------------------------------------------

interface MikroColumn {
  prop: string; // property/column name (snake; == drizzle column)
  mikroType: string; // MikroORM EntitySchema `type`
  tsType: string; // Row class field TS type
  nullable: boolean;
  primary: boolean;
  /** Explicit columnType for precise numerics (money/decimal), or the
   *  element's own columnType with a trailing `[]` for a scalar array. */
  columnType?: string;
  /** A root SCALAR/ENUM collection (`tags: string[]`, `kinds: Status[]`) —
   *  emits MikroORM's `array: true` alongside `type: <element type>`, which
   *  `MetadataDiscovery` wraps in an element-typed `ArrayType` and, on
   *  Postgres (native array support), resolves the column to
   *  `<element column type>[]` — mirrors drizzle's own `.array()` (see
   *  `emit/schema.ts`, `case "array"`). */
  array?: boolean;
  /** The column, when it is not `prop` (a part row's `parentId` →
   *  `<owner>_id`, the shared schema's FK column). */
  fieldName?: string;
  /** A read-only property computed in SQL (`formula: (cols) => …`), the
   *  body as a template over `cols` — a value-object collection read off its
   *  child table. */
  formula?: string;
}

function unwrapOptional(t: TypeIR): { type: TypeIR; nullable: boolean } {
  return t.kind === "optional" ? { type: t.inner, nullable: true } : { type: t, nullable: false };
}

/** MikroORM type + Row TS type for a primitive — the `Codec` fact's column,
 *  spelled by `mikroScalar`. */
function primTypes(name: string): MikroScalar {
  return name === "duration"
    ? { mikro: "string", ts: "string" }
    : mikroScalar(name as CodecPrimitive);
}

/** Expand a single field into its column(s). VO fields flatten into one column
 *  per sub-field (`total_amount`, `total_currency`); everything else is a
 *  single column. Throws on a kind the validator should have gated.
 *
 *  Property names are the FIELD names (and `field_sub` for VO sub-fields), NOT
 *  snaked — they must match what the reused `hydrateRootExpr` / `projectionObject`
 *  reference (which use the field name / `${field}_${sub}`).  MikroORM's default
 *  underscore naming strategy still maps `customerId` → the `customer_id` column. */

function fieldColumns(f: FieldIR, ctx: EnrichedBoundedContextIR): MikroColumn[] {
  const { type, nullable } = unwrapOptional(f.type);
  return columnsForType(f.name, type, nullable, ctx);
}

function columnsForType(
  prop: string,
  type: TypeIR,
  nullable: boolean,
  ctx: EnrichedBoundedContextIR,
): MikroColumn[] {
  switch (type.kind) {
    case "primitive": {
      const { mikro, ts, columnType } = primTypes(type.name);
      return [{ prop, mikroType: mikro, tsType: ts, nullable, primary: false, columnType }];
    }
    case "enum":
      return [{ prop, mikroType: "string", tsType: "string", nullable, primary: false }];
    case "id":
      return [{ prop, mikroType: "string", tsType: "string", nullable, primary: false }];
    case "valueobject": {
      const vo = findValueObjectInScope(ctx, type.name);
      if (!vo) return [{ prop, mikroType: "string", tsType: "string", nullable, primary: false }];
      return vo.fields.flatMap((sub) => {
        const { type: st, nullable: sn } = unwrapOptional(sub.type);
        return columnsForType(`${prop}_${sub.name}`, st, nullable || sn, ctx);
      });
    }
    case "array": {
      // A root SCALAR collection (`tags: string[]`, `kinds: Status[]`) — the
      // one shape mikroorm was genuinely behind drizzle on (M-T6.23,
      // `#scalar-array`, drained here).  `X id[]` (pivot table) and `<VO>[]`
      // (inline jsonb) are filtered out before `columnsOf` ever calls
      // `fieldColumns` (see the ref-/value-collection filters there and in
      // `tphSharedColumns`), so only a PRIMITIVE / ENUM element reaches this
      // arm; anything else still falls through to the throw below.
      //
      // Mirrors drizzle's own native array column (`emit/schema.ts`,
      // `case "array"`): the ELEMENT's own scalar mikro type plus MikroORM's
      // `array: true` flag.  `MetadataDiscovery` wraps that in an
      // element-typed `ArrayType` (so a `money[]`/`decimal[]` element still
      // round-trips through the SAME string conversion its scalar twin uses
      // — `projectFieldEntries` / `arrayElementHydrate`, shared with drizzle)
      // and, on Postgres (native array support), resolves the column to
      // `<element column type>[]` rather than the cross-platform
      // comma-joined fallback a bare `type: "array"` gets on a non-native
      // driver.
      if (type.element.kind === "primitive" || type.element.kind === "enum") {
        const elem =
          type.element.kind === "enum"
            ? { mikro: "string", ts: "string", columnType: undefined as string | undefined }
            : primTypes(type.element.name);
        return [
          {
            prop,
            mikroType: elem.mikro,
            tsType: `${elem.ts}[]`,
            nullable,
            primary: false,
            columnType: elem.columnType ? `${elem.columnType}[]` : undefined,
            array: true,
          },
        ];
      }
      throw new Error(`mikroorm: unsupported field kind 'array' on '${prop}' (validator gap)`);
    }
    default:
      throw new Error(
        `mikroorm: unsupported field kind '${type.kind}' on '${prop}' (validator gap)`,
      );
  }
}

/** Co-located provenance sidecar columns (provenance.md): a `<field>_provenance`
 *  jsonb column holding the current lineage for each provenanced field.  Typed
 *  `ProvLineage | null` on the Row so the shared save-projection / hydrate seams
 *  (`provColumnEntries` / `hydrateRootExpr`) line up without a cast — mirrors the
 *  drizzle `$type<ProvLineage>()` column. */

function provColumnsOf(fields: readonly FieldIR[]): MikroColumn[] {
  return fields
    .filter((f) => f.provenanced)
    .map((f) => ({
      prop: `${f.name}_provenance`,
      mikroType: "json",
      tsType: `import("../domain/provenance").ProvLineage`,
      nullable: true,
      primary: false,
      columnType: "jsonb",
    }));
}

/** A value-object collection field (`charges: Money[]`) is its `(parent_fk,
 *  ordinal)` child table (D-ONE-SCHEMA), written by the repository and read as
 *  one read-only formula property that aggregates the child rows, in ordinal
 *  order, into the document shape the repository already (de)serialises
 *  (`docFieldType`): the value object's fields by name, a nested one as a
 *  nested object (absent per `ABSENT_RULE`), money as text. */
function valueCollectionColumn(
  f: FieldIR,
  owner: string,
  ctx: EnrichedBoundedContextIR,
): MikroColumn {
  const inner = f.type.kind === "optional" ? f.type.inner : f.type;
  const vc = valueCollectionsFor({ name: owner, fields: [f] })[0]!;
  const el = (inner as Extract<TypeIR, { kind: "array" }>).element;
  return {
    prop: f.name,
    mikroType: "json",
    tsType: docFieldType(inner, ctx),
    nullable: false,
    primary: false,
    formula: `(SELECT COALESCE(jsonb_agg(${elementJsonSql(el, "", ctx)} ORDER BY __c.ordinal), '[]'::jsonb) FROM "${vc.childTable}" __c WHERE __c."${vc.parentFk}" = \${cols.id})`,
  };
}

/** One child row (`__c`) as the document-shape json of value-object type `t`;
 *  `prefix` is the field chain its leaf columns are named under. */
function elementJsonSql(t: TypeIR, prefix: string, ctx: EnrichedBoundedContextIR): string {
  const vo = t.kind === "valueobject" ? findValueObjectInScope(ctx, t.name) : undefined;
  if (!vo) return "NULL";
  const pairs = vo.fields.map((vf) => {
    const name = prefix ? `${prefix}_${vf.name}` : vf.name;
    const inner = vf.type.kind === "optional" ? vf.type.inner : vf.type;
    if (inner.kind === "valueobject" && findValueObjectInScope(ctx, inner.name)) {
      const nested = elementJsonSql(inner, name, ctx);
      if (!(vf.optional || vf.type.kind === "optional")) return `'${vf.name}', ${nested}`;
      const absent = absenceProbe(name, inner, ctx)
        .map((l) => `__c."${l.column}" IS NULL`)
        .join(" AND ");
      return `'${vf.name}', CASE WHEN ${absent} THEN NULL ELSE ${nested} END`;
    }
    const col = `__c."${snake(name)}"`;
    const money = inner.kind === "primitive" && inner.name === "money";
    return `'${vf.name}', ${money ? `${col}::text` : col}`;
  });
  return `jsonb_build_object(${pairs.join(", ")})`;
}

/** The child-table Row entity of each value-object collection of `owner` (an
 *  aggregate or entity part): `parentId` (the `<owner>_id` FK) and `ordinal`
 *  key it, then the element's leaf columns. */
function renderValueCollectionRowEntities(
  owner: { name: string; fields: readonly FieldIR[] },
  ctx: EnrichedBoundedContextIR,
): { block: string; schemaName: string }[] {
  return valueCollectionsFor(owner).map((vc) => {
    const cls = valueCollectionRowClassOf(vc);
    const schemaName = `${cls}Schema`;
    const leaves = voLeaves("", { kind: "valueobject", name: vc.voName }, ctx);
    const cols: MikroColumn[] = [
      {
        prop: "parentId",
        mikroType: "string",
        tsType: "string",
        nullable: false,
        primary: true,
        fieldName: vc.parentFk,
      },
      { prop: "ordinal", mikroType: "integer", tsType: "number", nullable: false, primary: true },
      ...leaves.flatMap((l) =>
        fieldColumns(
          {
            name: l.prop,
            type: l.nullable ? { kind: "optional", inner: l.type } : l.type,
            optional: l.nullable,
          },
          ctx,
        ),
      ),
    ];
    return {
      schemaName,
      block: lines(
        `export class ${cls} {`,
        ...cols.map((c) => `  ${c.prop}!: ${c.tsType}${c.nullable ? " | null" : ""};`),
        `}`,
        "",
        `export const ${schemaName} = new EntitySchema<${cls}>({`,
        `  class: ${cls},`,
        `  tableName: "${vc.childTable}",`,
        `  properties: {`,
        ...cols.map(mikroPropertyLine),
        `  },`,
        `});`,
        "",
      ),
    };
  });
}

/** `order_charges` → `OrderChargesRow`: the Row class of a value-object
 *  collection's child table. */
export function valueCollectionRowClassOf(vc: { tableConst: string }): string {
  return `${upperFirst(vc.tableConst)}Row`;
}

function columnsOf(agg: EnrichedAggregateIR, ctx: EnrichedBoundedContextIR): MikroColumn[] {
  const id: MikroColumn = {
    prop: "id",
    mikroType: "string",
    tsType: "string",
    nullable: false,
    primary: true,
  };
  // `Id[]` reference collections persist as pivot tables (join-Row entities),
  // not columns on the aggregate row — skip them here.  Value-object collections
  // (`<VO>[]`) fold onto one inline jsonb column each (see valueCollectionColumn).
  const scalarFields = agg.fields.filter(
    (f) => !isRefCollectionType(f.type) && !isValueCollectionType(f.type),
  );
  const valueCollFields = agg.fields.filter((f) => isValueCollectionType(f.type));
  return [
    id,
    ...scalarFields.flatMap((f) => fieldColumns(f, ctx)),
    ...valueCollFields.map((f) => valueCollectionColumn(f, agg.name, ctx)),
    ...provColumnsOf(agg.fields),
  ];
}

/** TPH root columns (aggregate-inheritance.md, sharedTable): `id`, the `kind`
 *  discriminator (only when the base has a shared-table concrete —
 *  `isDiscriminatedTphBase`), then the abstract base's own columns with their
 *  declared nullability.  Every concrete's own columns live on its subclass
 *  schema (`tphConcreteColumns`) — only rows of that `kind` populate them, so
 *  they are nullable in the shared table. */

function tphRootColumns(
  base: EnrichedAggregateIR,
  ctx: EnrichedBoundedContextIR,
  discriminated: boolean,
): MikroColumn[] {
  const cols: MikroColumn[] = [
    { prop: "id", mikroType: "string", tsType: "string", nullable: false, primary: true },
    ...(discriminated
      ? [{ prop: "kind", mikroType: "string", tsType: "string", nullable: false, primary: false }]
      : []),
  ];
  const seen = new Set(cols.map((c) => c.prop));
  for (const f of base.fields) {
    if (isRefCollectionType(f.type)) continue;
    for (const c of fieldColumns(f, ctx)) {
      if (seen.has(c.prop)) continue;
      seen.add(c.prop);
      cols.push(c);
    }
  }
  return cols;
}

/** The columns one TPH concrete adds to the shared table, forced nullable. */

function tphConcreteColumns(
  concrete: EnrichedAggregateIR,
  base: EnrichedAggregateIR,
  taken: ReadonlySet<string>,
  ctx: EnrichedBoundedContextIR,
): MikroColumn[] {
  const cols: MikroColumn[] = [];
  const seen = new Set(taken);
  for (const f of ownFieldsOf(concrete, base)) {
    if (isRefCollectionType(f.type)) continue;
    // A value-object collection rides inline as one jsonb column, as on a
    // plain aggregate (`valueCollectionColumn`).
    const fieldCols = isValueCollectionType(f.type)
      ? [valueCollectionColumn(f, concrete.name, ctx)]
      : fieldColumns(f, ctx);
    for (const c of fieldCols) {
      if (seen.has(c.prop)) continue;
      seen.add(c.prop);
      cols.push({ ...c, nullable: true });
    }
  }
  return cols;
}

/** Render one pivot Row entity class + EntitySchema for an association. */

function renderJoinRowEntity(assoc: AssociationIR): { block: string; schemaName: string } {
  const cls = joinRowClassOf(assoc);
  const schemaName = `${cls}Schema`;
  const ownerProp = joinColumnName(assoc.ownerFk);
  const targetProp = joinColumnName(assoc.targetFk);
  return {
    schemaName,
    block: lines(
      `export class ${cls} {`,
      `  ${ownerProp}!: string;`,
      `  ${targetProp}!: string;`,
      `}`,
      "",
      `export const ${schemaName} = new EntitySchema<${cls}>({`,
      `  class: ${cls},`,
      `  tableName: "${assoc.joinTable}",`,
      `  properties: {`,
      // Composite PK over (owner, target) — the whole row IS the set membership
      // (no payload); the default underscore naming maps `${ownerProp}` → the
      // `${assoc.ownerFk}` column, matching the drizzle join table.
      `    ${ownerProp}: { type: "string", primary: true },`,
      `    ${targetProp}: { type: "string", primary: true },`,
      `  },`,
      `});`,
      "",
    ),
  };
}

/** Row-entity class name for a contained entity part (`OrderLine` →
 *  `OrderLineRow`), its own child table keyed by a `parentId` FK. */

export const partRowClassOf = (partName: string): string => `${partName}Row`;

/** One MikroORM EntitySchema property descriptor line for a {@link MikroColumn}
 *  — the single point every Row-entity emitter below builds its `properties:`
 *  block from, so a column concern (e.g. `array: true`) is added once rather
 *  than re-added at each duplicate call site. */
function mikroPropertyLine(c: MikroColumn): string {
  if (c.formula !== undefined) {
    return `    ${c.prop}: { type: "${c.mikroType}", formula: (cols) => \`${c.formula}\`${c.nullable ? ", nullable: true" : ""} },`;
  }
  const parts = [`type: "${c.mikroType}"`];
  if (c.primary) parts.push("primary: true");
  if (c.array) {
    // `array: true` alone is inert on a SCALAR property: MikroORM wraps a
    // scalar in its `ArrayType` only for a `string[]`/`number[]`/`array` TYPE
    // name (or an enum with `items`), so the value went through the element's
    // scalar type instead — an `int[]` was bound as the JSON text `[7,2,9]`
    // into `integer[]`, and a `text[]` hydrated as the raw `{a,b}` literal
    // (wave C3 D1/D3).  The explicit `customType` marshals both directions, and
    // the pinned `columnType` keeps the native element column.
    parts.push(`columnType: "${c.columnType ?? mikroArrayColumnType(c.mikroType)}"`);
    parts.push(`customType: new ArrayType(${mikroArrayToJs(c.mikroType)})`);
  } else if (c.columnType) parts.push(`columnType: "${c.columnType}"`);
  if (c.nullable) parts.push("nullable: true");
  if (c.fieldName) parts.push(`fieldName: "${c.fieldName}"`);
  // The concurrency counter starts at 1, as the migration chain's `DEFAULT 1`
  // does: an entity created without it takes the column's default.
  if (c.prop === ROW_VERSION_FIELD && !c.nullable) parts.push("default: 1");
  return `    ${c.prop}: { ${parts.join(", ")} },`;
}

/** The Postgres array column for a scalar-collection element's mikro type
 *  (a precise numeric element carries its own `columnType` already). */
function mikroArrayColumnType(elementMikroType: string): string {
  switch (elementMikroType) {
    case "integer":
    case "bigint":
    case "boolean":
    case "uuid":
      return `${elementMikroType}[]`;
    case "datetime":
      return "timestamptz[]";
    case "date":
      return "date[]";
    default:
      return "text[]";
  }
}

/** The per-element JS conversion `ArrayType` applies on read — the SAME value
 *  the element's scalar mikro type would hydrate (`long` is a JS number, as
 *  its scalar twin). An empty string is `ArrayType`'s identity default. */
function mikroArrayToJs(elementMikroType: string): string {
  switch (elementMikroType) {
    case "integer":
    case "bigint":
      return "(i) => +i";
    case "boolean":
      return '(i) => i === true || i === "t" || i === "true"';
    case "datetime":
      return "(i) => (i instanceof Date ? i : new Date(i))";
    default:
      return "";
  }
}

function renderPartRowEntity(
  part: EntityPartIR,
  ctx: EnrichedBoundedContextIR,
  /** The entity whose row the part's FK references (`directParentName`). */
  parentName: string,
): { block: string; schemaName: string } {
  const cls = partRowClassOf(part.name);
  const schemaName = `${cls}Schema`;
  const cols: MikroColumn[] = [
    { prop: "id", mikroType: "string", tsType: "string", nullable: false, primary: true },
    {
      prop: "parentId",
      mikroType: "string",
      tsType: "string",
      nullable: false,
      primary: false,
      fieldName: `${snake(parentName)}_id`,
    },
    ...part.fields.flatMap((f) =>
      isValueCollectionType(f.type)
        ? [valueCollectionColumn(f, part.name, ctx)]
        : fieldColumns(f, ctx),
    ),
  ];
  const classFields = cols.map((c) => `  ${c.prop}!: ${c.tsType}${c.nullable ? " | null" : ""};`);
  const propLines = cols.map(mikroPropertyLine);
  return {
    schemaName,
    block: lines(
      `export class ${cls} {`,
      ...classFields,
      `}`,
      "",
      `export const ${schemaName} = new EntitySchema<${cls}>({`,
      `  class: ${cls},`,
      `  tableName: "${partTableName(part)}",`,
      `  properties: {`,
      ...propLines,
      `  },`,
      `});`,
      "",
    ),
  };
}

// ---------------------------------------------------------------------------
// db/entities.ts — Row classes + EntitySchema definitions.
// ---------------------------------------------------------------------------

/** Document-shape columns: the whole aggregate collapses to `(id, data,
 *  version)` — one opaque jsonb blob + a concurrency counter.  Mirrors the
 *  drizzle `emitDocumentTable`; no per-field / containment / pivot columns. */

function documentColumnsOf(): MikroColumn[] {
  return [
    { prop: "id", mikroType: "string", tsType: "string", nullable: false, primary: true },
    {
      prop: "data",
      mikroType: "json",
      tsType: "unknown",
      nullable: false,
      primary: false,
      columnType: "jsonb",
    },
    {
      prop: ROW_VERSION_FIELD,
      mikroType: "number",
      tsType: "number",
      nullable: false,
      primary: false,
    },
  ];
}

/** Embedded-shape columns: the queryable root columns (via `columnsOf`) plus
 *  one jsonb column per `Id[]` reference collection (the id-string array folds
 *  onto the root row — no pivot table under embedded) and one jsonb column per
 *  containment (typed `unknown` on the Row, cast in the repo through
 *  `<Part>Doc`).  Mirrors the drizzle `emitEmbeddedTable`. */

function embeddedColumnsOf(agg: EnrichedAggregateIR, ctx: EnrichedBoundedContextIR): MikroColumn[] {
  const cols = columnsOf(agg, ctx);
  // `Id[]` reference collections fold onto the root as a jsonb id-string array
  // (the embedded analogue of the relational pivot table) — `columnsOf` skips
  // them, so add them here, keeping the field's declared nullability.
  for (const f of agg.fields) {
    if (!isRefCollectionType(f.type)) continue;
    cols.push({
      prop: f.name,
      mikroType: "json",
      tsType: "string[]",
      nullable: f.optional ?? false,
      primary: false,
      columnType: "jsonb",
    });
  }
  for (const c of agg.contains) {
    cols.push({
      prop: c.name,
      mikroType: "json",
      tsType: "unknown",
      nullable: c.optional ?? false,
      primary: false,
      columnType: "jsonb",
    });
  }
  return cols;
}

/** A plain Row entity block from a fixed column list (audit / provenance
 *  history tables — no aggregate to walk). */

function renderRecordRowEntity(
  cls: string,
  tableName: string,
  cols: MikroColumn[],
): { block: string; schemaName: string } {
  const schemaName = `${cls}Schema`;
  const classFields = cols.map((c) => `  ${c.prop}!: ${c.tsType}${c.nullable ? " | null" : ""};`);
  const propLines = cols.map(mikroPropertyLine);
  return {
    schemaName,
    block: lines(
      `export class ${cls} {`,
      ...classFields,
      `}`,
      "",
      `export const ${schemaName} = new EntitySchema<${cls}>({`,
      `  class: ${cls},`,
      `  tableName: "${tableName}",`,
      `  properties: {`,
      ...propLines,
      `  },`,
      `});`,
      "",
    ),
  };
}

const JSONB = (prop: string, nullable: boolean): MikroColumn => ({
  prop,
  mikroType: "json",
  tsType: "unknown",
  nullable,
  primary: false,
  columnType: "jsonb",
});

const TEXT = (prop: string, opts: { primary?: boolean; nullable?: boolean } = {}): MikroColumn => ({
  prop,
  mikroType: "string",
  tsType: "string",
  nullable: opts.nullable ?? false,
  primary: opts.primary ?? false,
});

const TIMESTAMPTZ = (prop: string, opts: { nullable?: boolean } = {}): MikroColumn => ({
  prop,
  mikroType: "Date",
  tsType: "Date",
  nullable: opts.nullable ?? false,
  primary: false,
  columnType: "timestamptz",
});

const INT = (prop: string): MikroColumn => ({
  prop,
  mikroType: "number",
  tsType: "number",
  nullable: false,
  primary: false,
});

/** Row-entity class name for the transactional-outbox table.  Exported so the
 *  workflow builder's mikro outbox machinery references the same symbol. */

export const MIKRO_OUTBOX_ROW_CLASS = "LoomOutboxRow";

/** Row-entity class name for the timer-scheduler watermark table. */

export const MIKRO_TIMER_RUNS_ROW_CLASS = "LoomTimerRunsRow";

/** Timer-scheduler watermark Row (`_timer_runs`).  The scheduler creates this
 *  table itself with `CREATE TABLE IF NOT EXISTS` (self-owned infrastructure,
 *  outside the domain MigrationsIR); the entity maps it. */

function timerRunsRowEntity(): { block: string; schemaName: string } {
  return renderRecordRowEntity(MIKRO_TIMER_RUNS_ROW_CLASS, RUNTIME_TABLES.timerRuns, [
    TEXT("timer", { primary: true }),
    TIMESTAMPTZ("lastFiredAt"),
  ]);
}

/** Row-entity class name for the `every:` timer claim table. */

export const MIKRO_TIMER_CLAIM_ROW_CLASS = "LoomTimerClaimRow";

/** The `every:` timer claim Row (`_timer`, decision D-TIMER-SINGLE-FIRE).
 *  The table comes from the shared migration chain; the scheduler only ever
 *  writes it with the raw claim upsert. */

function timerClaimRowEntity(): { block: string; schemaName: string } {
  return renderRecordRowEntity(MIKRO_TIMER_CLAIM_ROW_CLASS, TIMER_CLAIM_TABLE, [
    TEXT("timer", { primary: true }),
    { prop: "lastPeriod", mikroType: "bigint", tsType: "string", nullable: false, primary: false },
    TIMESTAMPTZ("firedAt"),
  ]);
}

/** Transactional outbox Row (`_outbox`) — the MikroORM edition of the
 *  drizzle `loomOutbox` pgTable (docs/channels.md).  The table
 *  comes from the shared migration chain; the mapping differs from drizzle's
 *  on two properties, because the capture site writes them:
 *    - `id` is a TEXT pk the capture site fills with `randomUUID()`, not a
 *      `uuid DEFAULT gen_random_uuid()` — every other id in the mikro model is
 *      an application-generated text id, and a DB-side default would have to be
 *      threaded as `defaultRaw` purely to be immediately overwritten.
 *    - `occurredAt` / `attempts` are written by the capture site too, so they
 *      need no DDL default (the drizzle table has `defaultNow()` / `default(0)`
 *      because its INSERT omits them).
 *  `dispatchedAt` and `deadAt` both NULL mark the pending rows the relay drains,
 *  exactly as on drizzle. */

function outboxRowEntity(): { block: string; schemaName: string } {
  return renderRecordRowEntity(MIKRO_OUTBOX_ROW_CLASS, RUNTIME_TABLES.outbox, [
    TEXT("id", { primary: true }),
    TIMESTAMPTZ("occurredAt"),
    TEXT("type"),
    JSONB("payload", false),
    TIMESTAMPTZ("dispatchedAt", { nullable: true }),
    INT("attempts"),
    TIMESTAMPTZ("deadAt", { nullable: true }),
  ]);
}

/** Consumer inbox Row (`_inbox`): one row per `(consumer, event_id)` a
 *  consumer applied.  The table comes from the shared migration chain; the
 *  consumers only write it with the raw claim insert. */

function inboxRowEntity(): { block: string; schemaName: string } {
  return renderRecordRowEntity("ConsumerInboxRow", INBOX_TABLE, [
    TEXT("consumer", { primary: true }),
    TEXT("eventId", { primary: true }),
    TIMESTAMPTZ("receivedAt"),
  ]);
}

/** Audit history Row (`audit_records`) — the MikroORM edition of the drizzle
 *  `auditRecords` table.  Property names + underscore-mapped columns match, so
 *  the shared routes-builder's `em.insert(AuditRecordRow, { auditId, … })`
 *  round-trips into the same schema. */

function auditRecordEntity(): { block: string; schemaName: string } {
  return renderRecordRowEntity("AuditRecordRow", "audit_records", [
    TEXT("auditId", { primary: true }),
    TEXT("operationId"),
    TEXT("action"),
    TEXT("targetType"),
    TEXT("targetId"),
    JSONB("actor", true),
    // Nullable, matching `migrations-builder`: a `create` has no BEFORE state
    // and a `destroy` has no AFTER state, and the routes insert `null` for
    // each.  Declaring them NOT NULL here made the emitted DDL contradict the
    // insert sites.
    JSONB("before", true),
    JSONB("after", true),
    TIMESTAMPTZ("at"),
    TEXT("status"),
    TEXT("correlationId", { nullable: true }),
    TEXT("scopeId", { nullable: true }),
    TEXT("parentId", { nullable: true }),
  ]);
}

/** Provenance history Row (`provenance_records`) — the MikroORM edition of the
 *  drizzle `provenanceRecords` table. */

function provenanceRecordEntity(): { block: string; schemaName: string } {
  return renderRecordRowEntity("ProvenanceRecordRow", "provenance_records", [
    TEXT("traceId", { primary: true }),
    TEXT("snapshotId"),
    TEXT("targetType"),
    TEXT("field"),
    JSONB("inputs", false),
    JSONB("computedValue", true),
    TIMESTAMPTZ("at"),
    TEXT("correlationId", { nullable: true }),
    TEXT("scopeId", { nullable: true }),
    TEXT("actorId", { nullable: true }),
    TEXT("parentId", { nullable: true }),
  ]);
}

/** Row-entity class name for a workflow's persisted correlation state
 *  (`OrderFulfillment` → `OrderFulfillmentRow`).  Exported so the workflow
 *  builder's `usingMikro` store branch references the same symbol. */

export const mikroWorkflowRowClass = (wf: WorkflowIR): string => `${upperFirst(wf.name)}Row`;

/** Columns for a workflow's correlation-state Row: the correlation field is the
 *  string PK (an id column), every other declared saga state field maps through
 *  the shared `fieldColumns` — mirroring the drizzle `emitWorkflowStateTable`. */

/** A state row's (workflow / projection) columns for one non-key field.  A
 *  reference collection is one jsonb id-string array column — the shared
 *  migration's `JSONB` (a state row has no pivot table); everything else
 *  maps through the shared `fieldColumns`. */
function stateFieldColumns(f: FieldIR, ctx: EnrichedBoundedContextIR): MikroColumn[] {
  if (!isRefCollectionType(f.type)) return fieldColumns(f, ctx);
  return [
    {
      prop: f.name,
      mikroType: "json",
      tsType: "string[]",
      nullable: f.optional ?? false,
      primary: false,
      columnType: "jsonb",
    },
  ];
}

function workflowStateColumns(wf: WorkflowIR, ctx: EnrichedBoundedContextIR): MikroColumn[] {
  const corr = wf.correlationField;
  const cols: MikroColumn[] = (wf.stateFields ?? []).flatMap((f) =>
    f.name === corr
      ? [{ prop: f.name, mikroType: "string", tsType: "string", nullable: false, primary: true }]
      : stateFieldColumns(f, ctx),
  );
  return cols;
}

/** Row-entity class name for a folded projection's read-model row
 *  (`OrderBoard` → `OrderBoardRow`).  Exported so the projection builder's
 *  `usingMikro` store branch references the same symbol. */

export const mikroProjectionRowClass = (proj: ProjectionIR): string =>
  `${upperFirst(proj.name)}Row`;

/** Columns for a folded projection's read-model Row: the correlation field is
 *  the string PK, every other state field maps through the shared `fieldColumns`
 *  but is forced NULLABLE — a fold upserts only the fields its event carries, so
 *  a row is partial until every contributing event arrives.  Mirrors the drizzle
 *  `emitProjectionTable`. */

function projectionStateColumns(proj: ProjectionIR, ctx: EnrichedBoundedContextIR): MikroColumn[] {
  const corr = proj.correlationField;
  const cols = proj.stateFields.flatMap((f): MikroColumn[] =>
    f.name === corr
      ? [{ prop: f.name, mikroType: "string", tsType: "string", nullable: false, primary: true }]
      : stateFieldColumns(f, ctx).map((c) => ({ ...c, nullable: true })),
  );
  // A tenant-scoped fold (`fold-tenancy.ts`): the row carries the tenant
  // columns and is keyed by `(tenantId, <key>)` — a composite primary key.
  const tenancy = foldTenancyFor(proj);
  if (tenancy) {
    for (const m of tenancy.metadata) cols.push(TEXT(m.field, { primary: true }));
  }
  return cols;
}

/** The `uniques:` block for each `unique (...)` key the aggregate declares —
 *  it names the index the migration chain creates (`<table>_<cols>_uq`).  A
 *  `softDeletable` key is partial (`WHERE is_deleted = false`, so a soft-deleted
 *  row frees its key), which MikroORM only expresses as the index's full DDL. */
function mikroUniquesLines(agg: EnrichedAggregateIR, pool: AggPool): string[] {
  const keys = agg.uniqueKeys ?? [];
  if (keys.length === 0) return [];
  const table = aggregateTableName(agg, pool);
  const softDeletable = agg.capabilities?.includes("softDeletable") ?? false;
  const entries = keys.map((uk) => {
    const cols = uk.columns.map((c) => snake(c));
    const name = `${table}_${cols.join("_")}_uq`;
    if (softDeletable) {
      const ddl = `create unique index "${name}" on "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) where is_deleted = false`;
      return `    { name: "${name}", expression: ${JSON.stringify(ddl)} },`;
    }
    const props = uk.columns.map((c) => JSON.stringify(c)).join(", ");
    return `    { name: "${name}", properties: [${props}] },`;
  });
  return [`  uniques: [`, ...entries, `  ],`];
}

export function renderMikroEntities(
  aggs: readonly EnrichedAggregateIR[],
  ctx: EnrichedBoundedContextIR,
  shapeOf: (agg: EnrichedAggregateIR) => "relational" | "embedded" | "document" = (a) =>
    (a.savingShape as "relational" | "embedded" | "document" | undefined) ?? "relational",
  opts: {
    audit?: boolean;
    provenance?: boolean;
    outbox?: boolean;
    timerRuns?: boolean;
    /** The deployable owns an `every:` timer — map the `_timer` claim
     *  table. */
    timerClaim?: boolean;
    /** Some consumer claims in the consumer inbox (`deployableNeedsInbox`) —
     *  map the `_inbox` table. */
    inbox?: boolean;
    /** Maps an event-sourced aggregate / workflow to the context that declares
     *  it. A multi-context deployable passes one merged context here, and each
     *  `<Ctx>EventRow` must still be named after its stream's owner — the name
     *  the event-sourced repository and workflow fold helpers import. */
    resolveStreamContext?: (streamName: string) => string | undefined;
  } = {},
): string {
  const blocks: string[] = [];
  const schemaNames: string[] = [];
  // Event-sourced (`persistedAs: eventLog`) aggregates share a SINGLE
  // per-context `<ctx>_events` stream row (event-log-architecture.md),
  // discriminated by `stream_type`, rather than one table each.  Emitted once
  // after the per-aggregate walk; the entity maps the migrated table's
  // composite `(stream_type, stream_id, version)` PK and inert `seq` cursor.
  // An event-sourced WORKFLOW folds the same `<ctx>_events` stream (it has no
  // state table — see the correlation-row loop below), so it needs the stream
  // entity even when no AGGREGATE is event-sourced.  Gating on aggregates alone
  // meant a context whose only event-sourced thing was a workflow emitted no
  // entity at all, and the generated `http/workflows.ts` fell back to the
  // drizzle event store — importing `drizzle-orm`, which a `persistence:
  // mikroorm` project does not install, so the server died at import.
  const streamOwner = (name: string): string => opts.resolveStreamContext?.(name) ?? ctx.name;
  const eventLogOwners = [
    ...new Set([
      ...aggs.filter((agg) => agg.persistedAs === "eventLog").map((agg) => streamOwner(agg.name)),
      ...eventSourcedWorkflows(ctx.workflows ?? []).map((wf) => streamOwner(wf.name)),
    ]),
  ];
  for (const agg of aggs) {
    if (agg.persistedAs === "eventLog") continue;
    // TPH concretes (aggregate-inheritance.md, sharedTable) own no Row — their
    // columns live in the base's shared table, emitted once for the base below.
    // …but a TPH concrete's contained parts still need their own child tables:
    // each part FKs the SHARED base row (the concrete has no table of its own),
    // and the part row's `parentId` holds that shared-table row id — which is
    // exactly the concrete's id (TPT-via-`contains`).  Mirrors emit/schema.ts.
    if (isTphConcrete(agg, aggs)) {
      const owner = tableOwnerName(agg, aggs);
      for (const part of agg.parts ?? []) {
        const { block, schemaName: partSchema } = renderPartRowEntity(
          part,
          ctx,
          directParentName(agg, part.name, owner),
        );
        schemaNames.push(partSchema);
        blocks.push(block);
      }
      // …and its own value-object collections keep their child tables, FK'd to
      // the shared base row like the parts.
      const base = aggs.find((a) => a.name === owner);
      const ownFields = base ? ownFieldsOf(agg, base) : agg.fields;
      for (const owned of [{ name: agg.name, fields: ownFields }, ...(agg.parts ?? [])]) {
        for (const { block, schemaName: s } of renderValueCollectionRowEntities(owned, ctx)) {
          schemaNames.push(s);
          blocks.push(block);
        }
      }
      continue;
    }
    // Abstract bases own no table EXCEPT a TPH root, which owns the shared
    // table (a TPC / intermediate abstract base emits nothing).
    if (agg.isAbstract && !isTphBase(agg, aggs)) continue;
    // TPH base → the one shared hierarchy table; document → one `(id, data,
    // version)` jsonb blob; embedded → root columns + one jsonb column per
    // containment; else the aggregate's own Row (a TPC concrete carries its
    // merged base+own fields via columnsOf).
    const shape = shapeOf(agg);
    const embedded = shape === "embedded";
    const document = shape === "document";
    const tph = isTphBase(agg, aggs);
    const discriminated = isDiscriminatedTphBase(agg, aggs);
    const cols = tph
      ? tphRootColumns(agg, ctx, discriminated)
      : document
        ? documentColumnsOf()
        : embedded
          ? embeddedColumnsOf(agg, ctx)
          : columnsOf(agg, ctx);
    const cls = rowClassOf(agg.name);
    const schemaName = `${cls}Schema`;
    schemaNames.push(schemaName);
    const classFields = cols.map((c) => `  ${c.prop}!: ${c.tsType}${c.nullable ? " | null" : ""};`);
    const propLines = cols.map(mikroPropertyLine);
    // The aggregate's read scope, declared once as named default filters.  A
    // `document` row is an opaque blob (no queryable columns) — its repository
    // evaluates the scope in the app instead.
    const filterLines = document
      ? []
      : mikroSchemaFilterLines(agg, mikroSchemaFilters(agg, aggs), rowClassOf);
    // A TPH root is the ABSTRACT parent of one subclass schema per concrete
    // (single-table inheritance): the discriminator column and its map live
    // here, so the ORM scopes `find(CarRow)` to `kind = 'Car'` and hydrates
    // `find(VehicleRow)` as the right subclass.  A childless base maps a plain
    // table: no discriminator, nothing to be abstract over.
    const concretes = tph ? tphConcreteAggregates(agg, aggs) : [];
    const stiLines = discriminated
      ? [
          `  abstract: true,`,
          `  discriminatorColumn: "kind",`,
          `  discriminatorMap: { ${concretes
            .map((c) => `${JSON.stringify(discriminatorValue(c, aggs))}: ${rowClassOf(c.name)}`)
            .join(", ")} },`,
        ]
      : [];
    const taken = new Set(cols.map((c) => c.prop));
    const concreteCols = concretes.map((c) => ({
      agg: c,
      cls: rowClassOf(c.name),
      cols: tphConcreteColumns(c, agg, taken, ctx),
    }));
    // A TPH root's `discriminatorMap` names the concrete CLASSES, so every class
    // of the hierarchy is declared before the first schema is built.
    if (tph) {
      blocks.push(
        lines(
          `export class ${cls} {`,
          ...classFields,
          `}`,
          "",
          ...concreteCols.flatMap((c) => [
            `export class ${c.cls} extends ${cls} {`,
            ...c.cols.map(
              (col) => `  ${col.prop}!: ${col.tsType}${col.nullable ? " | null" : ""};`,
            ),
            `}`,
            "",
          ]),
        ),
      );
    }
    blocks.push(
      lines(
        ...(tph ? [] : [`export class ${cls} {`, ...classFields, `}`, ""]),
        `export const ${schemaName} = new EntitySchema<${cls}>({`,
        `  class: ${cls},`,
        `  tableName: "${aggregateTableName(agg, ctx.aggregates)}",`,
        ...stiLines,
        `  properties: {`,
        ...propLines,
        `  },`,
        ...filterLines,
        ...mikroUniquesLines(agg, ctx.aggregates),
        `});`,
        "",
      ),
    );
    // Each concrete is a subclass schema: only its own columns are declared, the
    // table, discriminator and filters are the root's.
    for (const c of concreteCols) {
      const cschema = `${c.cls}Schema`;
      schemaNames.push(cschema);
      blocks.push(
        lines(
          `export const ${cschema} = new EntitySchema<${c.cls}, ${cls}>({`,
          `  class: ${c.cls},`,
          `  extends: ${cls},`,
          `  properties: {`,
          ...c.cols.map(mikroPropertyLine),
          `  },`,
          `});`,
          "",
        ),
      );
    }
    // `Id[]` reference-collection associations persist as pivot Row entities
    // (composite-PK join tables), one per declared collection field.  Under
    // document (whole blob) OR embedded (id-string array folded onto the root
    // jsonb column, see `embeddedColumnsOf`) they ride inline — no pivot table.
    if (!document && !embedded)
      for (const assoc of agg.associations ?? []) {
        const { block, schemaName: joinSchema } = renderJoinRowEntity(assoc);
        schemaNames.push(joinSchema);
        blocks.push(block);
      }
    // Contained entity parts persist as parent-scoped child Row entities
    // (relational shape only), one table per declared part.  Under embedded
    // (jsonb containment columns) or document (whole blob) they fold in — no
    // child tables.
    if (!embedded && !document) {
      for (const part of agg.parts ?? []) {
        const { block, schemaName: partSchema } = renderPartRowEntity(
          part,
          ctx,
          directParentName(agg, part.name, agg.name),
        );
        schemaNames.push(partSchema);
        blocks.push(block);
      }
      // Value-object collections: one child table each, on the root and on
      // every part.
      for (const owned of [agg, ...(agg.parts ?? [])]) {
        for (const { block, schemaName: s } of renderValueCollectionRowEntities(owned, ctx)) {
          schemaNames.push(s);
          blocks.push(block);
        }
      }
    }
  }
  for (const owner of eventLogOwners) {
    const cls = eventRowClassOf(owner);
    const schemaName = `${cls}Schema`;
    schemaNames.push(schemaName);
    blocks.push(
      lines(
        `export class ${cls} {`,
        // OPTIONAL, unlike every other column: `seq` is a DB-generated
        // `bigserial` (see the property below), so every append omits it — and
        // MikroORM derives `RequiredEntityData` from the CLASS, not from the
        // `autoincrement` flag.  Declared required, `em.insert(<Ctx>EventRow, {…})`
        // fails `tsc` with "Property 'seq' is missing" on every event-sourced
        // append.  Found by's compile proof: no gate hid this
        // one, the tsc TIERS did — the corpus tsc gates run drizzle only, and the
        // mikro behavioural leg builds with esbuild (no typecheck), so an
        // event-sourced aggregate or workflow on `persistence: mikroorm` has
        // never actually been type-checked.
        "  seq?: number;",
        "  streamType!: string;",
        "  streamId!: string;",
        "  version!: number;",
        "  type!: string;",
        "  data!: unknown;",
        "  occurredAt!: Date;",
        "}",
        "",
        `export const ${schemaName} = new EntitySchema<${cls}>({`,
        `  class: ${cls},`,
        `  tableName: "${eventLogTable(owner)}",`,
        "  properties: {",
        // `seq` — context-global monotonic cursor, a sequence-backed column in
        // the migration chain; not part of the PK.  The `autoincrement` flag
        // keeps MikroORM treating it as DB-generated, so every event insert
        // leaves it out of the column list.
        '    seq: { type: "number", columnType: "bigserial", autoincrement: true },',
        // Composite `(stream_type, stream_id, version)` PK: every ES stream in
        // the context shares this table, discriminated by `streamType`.
        '    streamType: { type: "string", primary: true },',
        '    streamId: { type: "string", primary: true },',
        '    version: { type: "number", primary: true },',
        '    type: { type: "string" },',
        '    data: { type: "json", columnType: "jsonb" },',
        '    occurredAt: { type: "Date", columnType: "timestamptz" },',
        "  },",
        "});",
        "",
      ),
    );
  }
  // Persisted workflow-correlation state (workflow-and-applier.md A2-S2): one
  // Row per non-event-sourced correlation-bearing workflow — the MikroORM twin
  // of the drizzle `emitWorkflowStateTable`.  The in-process dispatcher's
  // load/save helpers (http/workflows.ts, usingMikro branch) read/upsert these.
  // An event-sourced workflow folds its `<ctx>_events` stream instead (no state
  // table), and a plain command workflow has no correlation field → no Row.
  for (const wf of ctx.workflows ?? []) {
    if (!hasStateRow(wf)) continue;
    const { block, schemaName } = renderRecordRowEntity(
      mikroWorkflowRowClass(wf),
      workflowStateTableName(wf.name),
      workflowStateColumns(wf, ctx),
    );
    schemaNames.push(schemaName);
    blocks.push(block);
  }
  // Folded-projection read-model Row entities (projection.md): one Row per
  // FOLDED projection — the MikroORM twin of the drizzle `emitProjectionTable`.
  // The in-process dispatcher's fold helpers (http/projections.ts, usingMikro
  // branch) load/upsert these; the by-key/list read routes read them.  Query-
  // time projections have no read-model row and are skipped.
  for (const proj of ctx.projections ?? []) {
    if (!isMaterializedProjection(proj)) continue;
    const { block, schemaName } = renderRecordRowEntity(
      mikroProjectionRowClass(proj),
      projectionTableName(proj),
      projectionStateColumns(proj, ctx),
    );
    schemaNames.push(schemaName);
    blocks.push(block);
  }
  // Audit / provenance history Row entities — emitted (like the drizzle
  // `audit_records` / `provenance_records` tables) only when the model has an
  // audited target / a provenanced field, so a plain project pays nothing.
  if (opts.audit) {
    const { block, schemaName } = auditRecordEntity();
    schemaNames.push(schemaName);
    blocks.push(block);
  }
  if (opts.provenance) {
    const { block, schemaName } = provenanceRecordEntity();
    schemaNames.push(schemaName);
    blocks.push(block);
  }
  // Transactional-outbox Row — emitted (like the drizzle `_outbox` table)
  // only when a context carries a durable channel, so a project with no
  // at-least-once delivery contract pays nothing.
  if (opts.outbox) {
    const { block, schemaName } = outboxRowEntity();
    schemaNames.push(schemaName);
    blocks.push(block);
  }
  // Timer-scheduler watermark Row — only for a deployable that OWNS a timer
  // (the same condition that emits `scheduler.ts`).
  if (opts.timerRuns) {
    const { block, schemaName } = timerRunsRowEntity();
    schemaNames.push(schemaName);
    blocks.push(block);
  }
  if (opts.timerClaim) {
    const { block, schemaName } = timerClaimRowEntity();
    schemaNames.push(schemaName);
    blocks.push(block);
  }
  if (opts.inbox) {
    const { block, schemaName } = inboxRowEntity();
    schemaNames.push(schemaName);
    blocks.push(block);
  }
  return (
    lines(
      "// Auto-generated.  Do not edit by hand.",
      "// MikroORM persistence model — Row entities mapped to the relational",
      "// tables.  Kept separate from the rich domain aggregates; the per-",
      "// aggregate repository maps between them.",
      `import { ${[
        blocks.some((b) => b.includes("new ArrayType(")) && "ArrayType",
        "EntitySchema",
        blocks.some(usesRawFragment) && "raw",
      ]
        .filter(Boolean)
        .join(", ")} } from "@mikro-orm/core";`,
      // The filters read the request principal when a query RUNS.
      blocks.some((b) => /\brequireCurrentUser\(/.test(b)) &&
        `import { requireCurrentUser } from "../auth/middleware";`,
      "",
      ...blocks,
      `export const entities = [${schemaNames.join(", ")}];`,
    ) + "\n"
  );
}
