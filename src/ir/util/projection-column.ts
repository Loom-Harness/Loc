// ---------------------------------------------------------------------------
// Which PHYSICAL COLUMN a direct-table projection arm's member access denotes.
//
// A query-time projection's direct-table arms (the whole-table aggregation and
// the grouped aggregation — `readsAggregateTableDirectly`) push their read into
// SQL, so every name in the `select` / `group by` / `where` has to be a COLUMN
// on the source's table.  Every backend used to render those names straight off
// the DOMAIN MODEL — take the outermost member and emit it — and never asked
// what the SCHEMA EMITTER actually wrote.  Three things the emitted table
// disagrees with the model about:
//
//   `derived total: money = unitPrice * qty`  there is no `total` column at
//                                             all — a derived field is computed
//                                             in the domain layer, per hydrated
//                                             row, over the full expression
//                                             language, and never written.
//                                             REFUSED.
//
//   `amount: Money`, `sum(b.amount.amount)`   the table has `amount_amount` /
//                                             `amount_currency`; the VO is
//                                             FLATTENED.  A real column, so it
//                                             is RESOLVED rather than refused —
//                                             the backends each render the
//                                             resolved PATH their own way.
//
//   `tags: string[]`                          a collection lives in its own
//                                             child/join table, not as a column
//                                             on the row.  REFUSED.
//
// This module answers that one question — name chain → column path — and is the
// SINGLE place it is answered.  Both halves need it and neither may import the
// other: `ir/validate` raises `loom.projection-columnless-source` off the
// refusals, the five backend projection emitters render the accepted paths.  A
// second copy would drift, and the failure mode of drift here is exactly the
// silent miscompile the gate exists to prevent.
//
// HOW THE BACKENDS SPELL A RESOLVED PATH.  They genuinely diverge — that is why
// this returns the declared-name PATH rather than one rendered string:
//
//   node / drizzle       `schema.bills.amount_amount`   flattened, camel hops
//   node / mikroorm      `b."amount_amount"`            flattened, snake hops
//   python / SQLAlchemy  `BillRow.amount_amount`        flattened, snake hops
//   dotnet / EF Core     `o.Amount.Amount`              OWNED object path
//   dotnet / dapper      `"amount_amount"`              flattened, snake hops
//   java / JPA           `e.amount.amount`              EMBEDDED object path
//   elixir / Ecto        the whole VO is ONE `:map` (jsonb) column, so the leaf
//                        is a jsonb extraction, not a column at all
// ---------------------------------------------------------------------------

import { snake } from "../../util/naming.js";
import type {
  AggregateIR,
  BoundedContextIR,
  ExprIR,
  FieldIR,
  ValueObjectIR,
} from "../types/loom-ir.js";

/** A resolved physical column, as the chain of DECLARED field names from the
 *  source row down to the leaf.  Length 1 for a plain stored field
 *  (`["qty"]`), longer for a value-object leaf (`["amount", "amount"]`, and
 *  `["box", "inner", "zip"]` for a nested one).
 *
 *  Declared names, deliberately: each backend's spelling is a pure function of
 *  them (`join("_")` for the drizzle key, `map(snake).join("_")` for the SQL
 *  column, `map(upperFirst).join(".")` for EF), and pre-rendering any one of
 *  those here would make the other five wrong. */
export interface ProjectionColumn {
  path: string[];
  /** The `FieldIR` at each hop, same order as `path`.  Empty for the universal
   *  `id` column, which carries no declared field. */
  fields: FieldIR[];
}

export type ProjectionColumnResolution =
  | ({ ok: true } & ProjectionColumn)
  /** `reason` is the "…, which …" tail of `loom.projection-columnless-source`. */
  | { ok: false; reason: string };

/** `amount_amount` — the FLATTENED column key, joining the DECLARED hop names.
 *  The drizzle schema key (`${f.name}_${voField.name}`, emit/schema.ts). */
export function flatColumnKey(col: ProjectionColumn): string {
  return col.path.join("_");
}

/** `amount_amount` / `contractor_estimate_amount` — the physical SQL column,
 *  snake-casing each hop before joining.  Matches `flattenValueObject` in
 *  src/system/migrations-builder.ts, which is what actually wrote the DDL. */
export function sqlColumnName(col: ProjectionColumn): string {
  return col.path.map(snake).join("_");
}

/** True when the path descends INTO a value object — the case where the
 *  backends stop agreeing (a flattened column on four of them, an
 *  owned/embedded object path on two, one jsonb blob on Ecto). */
export function isValueObjectLeaf(col: ProjectionColumn): boolean {
  return col.path.length > 1;
}

/** The source-row member chain an expression names, OUTERMOST-LAST, or `null`
 *  when the expression is not rooted at the source row at all (a join alias, a
 *  param, a literal, a computed expression).
 *
 *  Two bare spellings lower from the source-candidate scope and both are
 *  accepted, matching `bareColumn` in projection-aggregate.ts: `o.status`
 *  becomes a member access on `this`, and a bare `status` a `this-prop` ref. */
export function sourceMemberChain(e: ExprIR): string[] | null {
  if (e.kind === "ref" && (e.refKind === "this-prop" || e.refKind === "this-vo-prop")) {
    return [e.name];
  }
  if (e.kind !== "member") return null;
  if (e.receiver.kind === "this") return [e.member];
  const head = sourceMemberChain(e.receiver);
  return head === null ? null : [...head, e.member];
}

/** Resolve one source-row member chain against the aggregate the direct-table
 *  arm reads, to the physical column it denotes — or to the reason no column
 *  exists.  `null` when the expression is not a source-row chain at all, which
 *  is the caller's cue that this is not its business (a join alias' member, a
 *  parameter, a literal).
 *
 *  `id` resolves without appearing in `agg.fields`: it is the one column every
 *  shape has, including a document `(id, data, version)` triple, and
 *  `select n = count()` over it is the row-count tile `scaffoldDashboard`
 *  synthesises. */
export function resolveProjectionColumn(
  e: ExprIR,
  agg: AggregateIR,
  ctx: BoundedContextIR,
): ProjectionColumnResolution | null {
  const chain = sourceMemberChain(e);
  if (chain === null) return null;
  return resolveColumnChain(chain, agg, ctx);
}

/** The chain-taking half of {@link resolveProjectionColumn}, for callers that
 *  already hold the names. */
export function resolveColumnChain(
  chain: readonly string[],
  agg: AggregateIR,
  ctx: BoundedContextIR,
): ProjectionColumnResolution {
  const [head, ...rest] = chain;
  if (head === undefined) return { ok: false, reason: refuseUnknown(agg.name, "") };
  // `id` and `version` are the columns every relational shape has and neither
  // carries a declared `FieldIR`; nothing may hang off them (`o.id.value` is a
  // domain-object read, not a column).
  if ((head === "id" || head === "version") && rest.length === 0) {
    return { ok: true, path: [head], fields: [] };
  }
  if (agg.derived?.some((d) => d.name === head)) {
    return { ok: false, reason: refuseDerived(agg.name, head) };
  }
  if (agg.contains?.some((c) => c.name === head)) {
    return { ok: false, reason: refuseContainment(agg.name, head) };
  }
  const field = agg.fields.find((f) => f.name === head);
  if (!field) return { ok: false, reason: refuseUnknown(agg.name, head) };
  return descend(field, rest, `${agg.name}.${head}`, [head], [field], ctx);
}

function descend(
  field: FieldIR,
  rest: readonly string[],
  label: string,
  path: string[],
  fields: FieldIR[],
  ctx: BoundedContextIR,
): ProjectionColumnResolution {
  const base = field.type.kind === "optional" ? field.type.inner : field.type;
  if (base.kind === "array") return { ok: false, reason: refuseCollection(label) };
  if (base.kind === "valueobject") {
    const vo = lookupValueObject(base.name, ctx);
    const [next, ...tail] = rest;
    if (next === undefined) {
      return { ok: false, reason: refuseWholeValueObject(label, base.name, vo) };
    }
    if (!vo) return { ok: false, reason: refuseUnknown(label, next) };
    if (vo.derived?.some((d) => d.name === next)) {
      return { ok: false, reason: refuseDerived(base.name, next) };
    }
    const sub = vo.fields.find((f) => f.name === next);
    if (!sub) return { ok: false, reason: refuseUnknown(`${label}' ('${base.name}`, next) };
    return descend(sub, tail, `${label}.${next}`, [...path, next], [...fields, sub], ctx);
  }
  // A scalar / enum / id leaf.  Anything still hanging off it is a domain-object
  // read (`o.placedAt.year`), not a column — and an intrinsic CALL never reaches
  // here (a grouping transform is unwrapped by `groupKeyOf` before this runs).
  if (rest.length > 0) return { ok: false, reason: refuseUnknown(label, rest[0] as string) };
  return { ok: true, path, fields };
}

function lookupValueObject(name: string, ctx: BoundedContextIR): ValueObjectIR | undefined {
  return (
    ctx.valueObjects.find((v) => v.name === name) ??
    (ctx as { siblingValueObjects?: ValueObjectIR[] }).siblingValueObjects?.find(
      (v) => v.name === name,
    )
  );
}

// --- refusal reasons -------------------------------------------------------
//
// Each is the `reason` PARAMETER of `loom.projection-columnless-source`, whose
// message template (with the shared remedy sentence) lives in the catalog,
// src/diagnostics/messages.ts — exactly as the source-shape refusals next door
// in query-projection-arm.ts do.

function refuseDerived(owner: string, name: string): string {
  return (
    `aggregates over derived field '${owner}.${name}', which has no column — a 'derived' field ` +
    `is computed in the domain layer on each hydrated row, over the full expression language, ` +
    `and is never written to the table`
  );
}

function refuseCollection(label: string): string {
  return (
    `aggregates over collection field '${label}', which has no column on the source row — a ` +
    `collection is stored in its own child/join table`
  );
}

function refuseContainment(owner: string, name: string): string {
  return (
    `aggregates over containment '${owner}.${name}', which has no column on the source row — a ` +
    `contained part is stored in its own table`
  );
}

function refuseWholeValueObject(
  label: string,
  voName: string,
  vo: ValueObjectIR | undefined,
): string {
  const leaves = (vo?.fields ?? []).map((f) => f.name);
  const example = leaves[0] ?? "<field>";
  const short = label.split(".").slice(-1)[0] ?? label;
  return (
    `aggregates over value object '${label}', which is not a single column — '${voName}' is ` +
    `FLATTENED into one column per leaf` +
    (leaves.length > 0 ? ` (${leaves.map((l) => `${snake(short)}_${snake(l)}`).join(", ")})` : "") +
    `. Name the leaf instead ('${short}.<field>', e.g. '${short}.${example}')`
  );
}

function refuseUnknown(owner: string, name: string): string {
  return (
    `names '${name}' on '${owner}', which is not a column on the source table — the ` +
    `direct-table read has no such name to select`
  );
}
