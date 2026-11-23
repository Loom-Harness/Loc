// ---------------------------------------------------------------------------
// The value shapes the mock's runtime fills generated rows by.
//
// zocker reads a response zod schema and invents a value for it, but a zod
// schema cannot say that a string is a reference to another aggregate's row,
// an ISO datetime, or a money amount: the response wire spells all of them
// `z.string()`.  The mock's runtime therefore carries, beside each schema, the
// wire TYPE of every field, and corrects zocker's value by it (stable ids,
// references into real rows, datetimes, short nouns).  This module derives
// that description from the IR, once, at emit time.
// ---------------------------------------------------------------------------

import type {
  AggregateIR,
  BoundedContextIR,
  EntityPartIR,
  ExprIR,
  TypeIR,
  WireField,
} from "../../ir/types/loom-ir.js";
import { peelCollection, peelNullable, wireTypeInfo } from "../../ir/types/wire-types.js";
import { findValueObjectInScope } from "../../ir/util/reachable-types.js";
import { responseWireFor } from "../../ir/util/response-wire.js";

/** One value's wire type, as the runtime reads it.  `self` is a row's own
 *  id; `ref` an id of a row of `to`; `enum` and `bool` keep zocker's pick;
 *  `any` is left as generated. */
export type MockTypeSpec =
  | { k: "self" }
  | { k: "ref"; to: string }
  | {
      k:
        | "text"
        | "int"
        | "long"
        | "decimal"
        | "money"
        | "bool"
        | "datetime"
        | "date"
        | "guid"
        | "enum"
        | "any";
    }
  | { k: "obj"; f: MockFieldSpec[] }
  | { k: "list"; of: MockTypeSpec }
  | { k: "opt"; of: MockTypeSpec };

export interface MockFieldSpec {
  n: string;
  t: MockTypeSpec;
}

/** Records nest (a value object holding a value object, a part holding a
 *  part); a self-referencing shape stops here and is left as generated. */
const MAX_DEPTH = 6;

/** The wire type of `t` on the response side. */
export function specForType(t: TypeIR, ctx: BoundedContextIR, depth = 0): MockTypeSpec {
  if (depth > MAX_DEPTH) return { k: "any" };
  const info = wireTypeInfo(t, "response");
  if (info.isNullable) return { k: "opt", of: specForType(peelNullable(t), ctx, depth) };
  if (info.isCollection) return { k: "list", of: specForType(peelCollection(t), ctx, depth) };
  switch (info.refKind) {
    case "primitive":
      switch (info.primitive) {
        case "string":
          return { k: "text" };
        case "int":
        case "long":
        case "decimal":
        case "money":
        case "bool":
        case "datetime":
        case "date":
        case "guid":
          return { k: info.primitive };
        default:
          return { k: "any" };
      }
    case "id":
      return { k: "ref", to: info.idTarget ?? info.base };
    case "enum":
      return { k: "enum" };
    case "valueObject": {
      const vo = findValueObjectInScope(ctx, info.base);
      if (!vo) return { k: "any" };
      return {
        k: "obj",
        f: vo.fields.map((f) => ({ n: f.name, t: fieldSpec(f.type, f.optional, ctx, depth + 1) })),
      };
    }
    case "entity": {
      const ent = entityNamed(ctx, info.base);
      if (ent) return { k: "obj", f: wireSpecs(ctx, ent, false, depth + 1) };
      const record = ctx.payloads.find((p) => p.name === info.base);
      if (record && !record.variants) {
        return {
          k: "obj",
          f: record.fields.map((f) => ({
            n: f.name,
            t: fieldSpec(f.type, f.optional, ctx, depth + 1),
          })),
        };
      }
      return { k: "any" };
    }
    default:
      return { k: "any" };
  }
}

function fieldSpec(
  t: TypeIR,
  optional: boolean,
  ctx: BoundedContextIR,
  depth: number,
): MockTypeSpec {
  const spec = specForType(t, ctx, depth);
  return optional && spec.k !== "opt" ? { k: "opt", of: spec } : spec;
}

function entityNamed(ctx: BoundedContextIR, name: string): AggregateIR | EntityPartIR | undefined {
  for (const a of ctx.aggregates) {
    if (a.name === name) return a;
    const part = a.parts.find((p) => p.name === name);
    if (part) return part;
  }
  return undefined;
}

/** The fields of an aggregate's (or part's) response row.  On a root row the
 *  `id` row is the row's own stable id; on a nested part it is an id of its
 *  own, minted per position. */
export function wireSpecs(
  ctx: BoundedContextIR,
  ent: AggregateIR | EntityPartIR,
  root: boolean,
  depth = 0,
): MockFieldSpec[] {
  return responseWireFor(ctx.payloads, ent).map((wf: WireField) => ({
    n: wf.name,
    t:
      wf.source === "id"
        ? root
          ? { k: "self" }
          : { k: "guid" }
        : fieldSpec(wf.type, wf.optional || wf.maskUnless !== undefined, ctx, depth),
  }));
}

/** The field a row is labelled by when it serves a derived `display`: the
 *  text field the derivation reads when it is a bare field (`display = sku`),
 *  so the mock's `display` is the value the node backend computes; else its
 *  first name-like text field. */
const LABEL_FIELDS = ["name", "title", "label", "sku", "code", "email"];

export function labelField(fields: readonly MockFieldSpec[], display?: ExprIR): string | undefined {
  const read =
    display?.kind === "ref" && display.refKind === "this-prop"
      ? display.name
      : display?.kind === "member" && display.receiver.kind === "this"
        ? display.member
        : undefined;
  const isText = (f: MockFieldSpec): boolean =>
    f.t.k === "text" || (f.t.k === "opt" && f.t.of.k === "text");
  const declared = read === undefined ? undefined : fields.find((x) => x.n === read);
  if (declared && isText(declared)) return declared.n;
  for (const name of LABEL_FIELDS) {
    const f = fields.find((x) => x.n === name);
    if (f && isText(f)) return name;
  }
  return undefined;
}
