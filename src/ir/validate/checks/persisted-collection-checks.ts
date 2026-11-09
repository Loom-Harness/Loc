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
//                 child table (`ValueCollectionIR`), which every
//                 backend reads and writes — except a part's under Dapper
//                 and MikroORM (see #part-value-collection).
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
//                            MikroORM is the exception: it owns its schema and
//                            folds a part's collections into jsonb columns, so
//                            a context hosted ONLY on mikroorm keeps it.
//   #part-value-collection   `<VO>[]` on an entity part of a relational
//                            aggregate, when a Dapper or MikroORM host shares
//                            the context with another adapter.  Every other
//                            adapter (PART_VALUES_IN_CHILD_TABLE) reads and
//                            writes the part's child table the migration
//                            creates; Dapper and MikroORM each keep the list
//                            in a jsonb column their own schema declares, so
//                            either is accepted only as the context's sole
//                            adapter.  A document aggregate's part keeps the
//                            list inside the blob on every adapter, and a
//                            context no database-backed host serves persists
//                            nothing; neither is refused.
//   #state-value-collection  `<VO>[]` on a projection / workflow state row —
//                            no child table is created for a state row.
//   #nested-in-value-object  a value object reached from persisted state that
//                            itself holds an `X id[]` / `<VO>[]` — a value
//                            object flattens into scalar `<field>_<sub>`
//                            columns, and a collection has no such column.
//                            On a `shape: document` aggregate a nested
//                            `<VO>[]` is accepted: the aggregate persists as
//                            one jsonb blob, flattens nothing, and every
//                            backend's document serializer writes the nested
//                            array as a JSON array.  A nested `X id[]` stays
//                            refused there (#nested-in-value-object-document):
//                            a reference collection persists only as a join
//                            table, and none is derived for a collection
//                            inside a value object.
// ---------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import { platformFamily } from "../../../language/validators/data/platform-rules.js";
import { descriptorFor } from "../../../platform/metadata.js";
import type {
  BoundedContextIR,
  EnrichedAggregateIR,
  EnrichedLoomModel,
  FieldIR,
  SystemIR,
  TypeIR,
  ValueObjectIR,
} from "../../types/loom-ir.js";
import { findValueObjectInScope } from "../../util/reachable-types.js";
import { isDocumentShaped, resolveDataSourceConfig } from "../../util/resolve-datasource.js";
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

/** The first refused collection field inside value object `voName` (searched
 *  through nested value-object fields and value-collection elements), as a
 *  dotted path below the VO — or undefined when it holds none.  Every
 *  `X id[]` / `<VO>[]` is refused, except a `<VO>[]` when `valuesStored` (a
 *  document aggregate's blob holds it). */
function nestedCollectionPath(
  ctx: BoundedContextIR,
  voName: string,
  seen: Set<string>,
  valuesStored: boolean,
): string | undefined {
  if (seen.has(voName)) return undefined;
  seen.add(voName);
  const vo: ValueObjectIR | undefined = findValueObjectInScope(ctx, voName);
  if (!vo) return undefined;
  for (const f of vo.fields) {
    const kind = collectionKind(f.type);
    if (kind === "reference" || (kind === "value" && !valuesStored)) return f.name;
    const inner = unwrap(f.type);
    const nestedVo =
      inner.kind === "valueobject"
        ? inner.name
        : inner.kind === "array" && inner.element.kind === "valueobject"
          ? inner.element.name
          : undefined;
    if (nestedVo) {
      const below = nestedCollectionPath(ctx, nestedVo, seen, valuesStored);
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
  stored: PartCollectionsStored,
  inDocument = false,
): void {
  const field = f.name;
  const push = (message: string): void => {
    diags.push({
      severity: "error",
      code: "loom.collection-field-unpersisted",
      message,
      source: `${ctx.name}/${owner} ${ownerName}.${f.name}`,
    });
  };
  const nested = (voName: string): void => {
    const path = nestedCollectionPath(ctx, voName, new Set(), inDocument);
    if (!path) return;
    push(
      inDocument
        ? diagMessage("loom.collection-field-unpersisted#nested-in-value-object-document", {
            owner,
            ownerName,
            field,
            voName,
            path,
          })
        : diagMessage("loom.collection-field-unpersisted#nested-in-value-object", {
            owner,
            ownerName,
            field,
            voName,
            path,
          }),
    );
  };
  const kind = collectionKind(f.type);
  if (kind === "reference") {
    if (f.type.kind === "optional" || f.optional) {
      push(
        diagMessage("loom.collection-field-unpersisted#optional-reference", {
          owner,
          ownerName,
          field,
        }),
      );
    } else if (owner === "part" && !stored.references) {
      push(diagMessage("loom.collection-field-unpersisted#part-reference", { ownerName, field }));
    }
    return;
  }
  const inner = unwrap(f.type);
  if (kind === "value") {
    if (owner === "projection" || owner === "workflow") {
      push(
        diagMessage("loom.collection-field-unpersisted#state-value-collection", {
          owner,
          ownerName,
          field,
        }),
      );
    } else if (owner === "part" && !stored.values && !inDocument) {
      push(
        diagMessage("loom.collection-field-unpersisted#part-value-collection", {
          ownerName,
          field,
          hosts: stored.hosts.join(", "),
        }),
      );
    } else if (inner.kind === "array" && inner.element.kind === "valueobject") {
      nested(inner.element.name);
    }
    return;
  }
  if (inner.kind === "valueobject") nested(inner.name);
}

/** Which collections on an entity part a context's hosts actually store. */
export interface PartCollectionsStored {
  /** `X id[]` on a part (only MikroORM stores it). */
  references: boolean;
  /** `<VO>[]` on a part — false only when a jsonb-column adapter (Dapper,
   *  MikroORM) shares the context with another adapter. */
  values: boolean;
  /** The database-backed hosts' adapters, for the message. */
  hosts: string[];
}

/** The adapters that read and write a part's `<VO>[]` in the child table the
 *  shared migration creates — any mix of them agrees on one schema.  Dapper and
 *  MikroORM keep the list in a jsonb column of their own instead, so each is
 *  accepted only as a context's sole adapter. */
const PART_VALUES_IN_CHILD_TABLE: ReadonlySet<string> = new Set([
  "jpa",
  "drizzle",
  "python",
  "efcore",
  "ecto",
]);

const NOTHING_HOSTED: PartCollectionsStored = { references: false, values: true, hosts: [] };

/** The persistence adapter a database-backed deployable runs: its
 *  `persistence:` choice, else its platform family's one adapter. */
function adapterOf(d: { platform: string; persistence?: string }): string {
  if (d.persistence) return d.persistence;
  return platformFamily(d.platform) ?? d.platform;
}

/** Per context name, which part collections its database-backed hosts store.
 *  A context absent from the map has no such host. */
export function partCollectionsStored(loom: EnrichedLoomModel): Map<string, PartCollectionsStored> {
  const adapters = new Map<string, Set<string>>();
  for (const sys of loom.systems) {
    for (const d of sys.deployables) {
      if (!descriptorFor(d.platform).needsDb) continue;
      for (const cn of d.contextNames) {
        const set = adapters.get(cn) ?? new Set<string>();
        set.add(adapterOf(d));
        adapters.set(cn, set);
      }
    }
  }
  const out = new Map<string, PartCollectionsStored>();
  for (const [cn, set] of adapters) {
    const only = (a: string): boolean => set.size === 1 && set.has(a);
    out.set(cn, {
      references: only("mikroorm"),
      values:
        [...set].every((a) => PART_VALUES_IN_CHILD_TABLE.has(a)) ||
        only("dapper") ||
        only("mikroorm"),
      hosts: [...set].sort(),
    });
  }
  return out;
}

/** Is `agg` stored as one jsonb document blob?  Its own state shape, not an
 *  event stream, under the binding's `shape:` (else the aggregate header's). */
function storedAsDocument(
  agg: EnrichedAggregateIR,
  ctx: BoundedContextIR,
  sys: SystemIR | undefined,
): boolean {
  if (agg.persistedAs === "eventLog") return false;
  return isDocumentShaped(agg, sys ? resolveDataSourceConfig(agg, ctx, sys) : undefined);
}

export function validatePersistedCollectionPositions(
  ctx: BoundedContextIR,
  diags: LoomDiagnostic[],
  stored: PartCollectionsStored = NOTHING_HOSTED,
  sys?: SystemIR,
): void {
  for (const agg of ctx.aggregates) {
    const doc = storedAsDocument(agg as EnrichedAggregateIR, ctx, sys);
    for (const f of agg.fields) checkField(ctx, "aggregate", agg.name, f, diags, stored, doc);
    for (const part of agg.parts) {
      for (const f of part.fields) checkField(ctx, "part", part.name, f, diags, stored, doc);
    }
  }
  for (const proj of ctx.projections) {
    // A query-time projection (`from … select …`) keeps no table.
    if (proj.query) continue;
    for (const f of proj.stateFields) checkField(ctx, "projection", proj.name, f, diags, stored);
  }
  for (const wf of ctx.workflows) {
    // Only a correlation-bearing, state-row workflow keeps a table; an
    // eventSourced one folds its state from its stream.
    if (wf.eventSourced || !wf.correlationField) continue;
    for (const f of wf.stateFields ?? []) checkField(ctx, "workflow", wf.name, f, diags, stored);
  }
}
