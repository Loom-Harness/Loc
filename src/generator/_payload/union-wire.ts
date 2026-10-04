// Tagged-wire shape for discriminated unions (payload-transport-layer.md, P4b).
//
// The single source of truth for how a `union` payload serializes — every
// backend renders the *same* shape from these member specs, so the wire is
// identical by construction (the union analogue of `genericShape`).
//
// Each variant is an object carrying a `type: "<tag>"` discriminator (the
// pinned field name) plus its data:
//   - a record variant (aggregate / value-object → its `wireShape`, or a
//     payload / event → its fields) flattens its fields alongside `type`;
//   - a scalar variant (primitive / id) carries a single `value` field;
//   - the `none` unit carries nothing — just `{ type: "none" }`.
//
// Pure + dependency-free apart from the IR; the per-field Zod / type rendering
// stays in each backend (which owns its primitive mapping), so this module
// only resolves *which* fields each variant contributes.

import {
  forApiRead,
  wireFieldsForAggregate,
  wireFieldsForPart,
  wireFieldsForValueObject,
} from "../../ir/enrich/wire-projection.js";
import { unionInstanceName, variantTag } from "../../ir/stdlib/unions.js";
import type { BoundedContextIR, TypeIR, WireField } from "../../ir/types/loom-ir.js";
import { peelCollection, peelNullable, wireTypeInfo } from "../../ir/types/wire-types.js";
import { resolveErrorStatus } from "../../util/error-defaults.js";

/** A normalized field contributed by a record-shaped union variant. */
export interface UnionMemberField {
  name: string;
  type: TypeIR;
  optional: boolean;
  /** True for an aggregate / part `id` — backends emit it as a bare string. */
  isId: boolean;
}

export type UnionMember =
  | { tag: string; shape: "record"; fields: UnionMemberField[] }
  | { tag: string; shape: "scalar"; type: TypeIR }
  | { tag: string; shape: "none" };

/** Resolve a union's variants to their tagged-wire member specs in source
 *  order.  Record variants (aggregate / value-object / payload / event) expose
 *  their read-side wire fields; scalar variants wrap a `value`; `none` is the
 *  empty unit. */
export function unionMembers(variants: TypeIR[], ctx: BoundedContextIR): UnionMember[] {
  return variants.map((v) => {
    const tag = variantTag(v);
    if (v.kind === "none") return { tag, shape: "none" };
    const fields = recordFields(v, ctx);
    return fields ? { tag, shape: "record", fields } : { tag, shape: "scalar", type: v };
  });
}

/** The read-side wire fields of a record-shaped variant, or null when the
 *  variant is a scalar (primitive / id) that has no field list. */
function recordFields(v: TypeIR, ctx: BoundedContextIR): UnionMemberField[] | null {
  if (v.kind === "entity") {
    const agg = ctx.aggregates.find((a) => a.name === v.name);
    if (agg) return wireToMembers(wireFieldsForAggregate(agg));
    for (const a of ctx.aggregates) {
      const part = a.parts.find((p) => p.name === v.name);
      if (part) return wireToMembers(wireFieldsForPart(part));
    }
    // A payload / event variant (`payload Foo = OrderPlaced | …`).  Named-union
    // variants are not re-expanded here (they reference their own schema in P4+).
    const payload = ctx.payloads.find((p) => p.name === v.name && !p.variants);
    if (payload) {
      return payload.fields.map((f) => ({
        name: f.name,
        type: f.type,
        optional: f.optional ?? false,
        isId: false,
      }));
    }
    return null;
  }
  if (v.kind === "valueobject") {
    const vo = ctx.valueObjects.find((o) => o.name === v.name);
    return vo ? wireToMembers(wireFieldsForValueObject(vo)) : null;
  }
  return null;
}

function wireToMembers(wire: readonly WireField[] | undefined): UnionMemberField[] {
  return forApiRead(wire ?? []).map((wf) => ({
    name: wf.name,
    type: wf.type,
    optional: wf.optional,
    isId: wf.source === "id",
  }));
}

/** Producer-side spec for a union-returning find (payload-transport-layer.md
 *  P4 producer side; absence semantics per exception-less.md).  The IR
 *  validator (`loom.union-find-shape-unsupported`) pins the supported v1
 *  shape — exactly two inline variants: the repository's aggregate plus one
 *  *absent* variant (`none`, or an `error` payload whose only permitted field
 *  is `resource: string`) — so by emission time this resolves for every union
 *  find that reaches a backend.  Returns null for non-union returns. */
export interface FindUnionSpec {
  /** Polymorphic DTO / zod schema name (`OrderOrNotFound`). */
  name: string;
  variants: TypeIR[];
  /** The aggregate success variant's wire tag (the aggregate name). */
  successTag: string;
  /** The absent variant: the `none` unit (stdlib 404) or an error payload. */
  absent: { kind: "none"; tag: "none" } | { kind: "error"; tag: string; hasResource: boolean };
}

export function findUnionSpec(
  returnType: TypeIR,
  aggName: string,
  ctx: BoundedContextIR,
): FindUnionSpec | null {
  if (returnType.kind !== "union") return null;
  const variants = returnType.variants;
  const success = variants.find((v) => v.kind === "entity" && v.name === aggName);
  const other = variants.find((v) => v !== success);
  if (!success || !other || variants.length !== 2) return null;
  const name = unionInstanceName(variants);
  const successTag = variantTag(success);
  if (other.kind === "none") {
    return { name, variants, successTag, absent: { kind: "none", tag: "none" } };
  }
  if (other.kind !== "entity") return null;
  const payload = ctx.payloads.find((p) => p.name === other.name && p.kind === "error");
  if (!payload) return null;
  return {
    name,
    variants,
    successTag,
    absent: {
      kind: "error",
      tag: other.name,
      hasResource: payload.fields.some((f) => f.name === "resource"),
    },
  };
}

/** Render each member as a `z.object({ type: z.literal("tag"), … })` literal,
 *  delegating per-field and scalar Zod to the backend (which owns its
 *  primitive → Zod mapping).  Record fields flatten alongside `type`; a scalar
 *  variant gets a `value` field; `none` is bare. */
export function unionMemberObjects(
  members: UnionMember[],
  fieldZod: (f: UnionMemberField) => string,
  scalarZod: (t: TypeIR) => string,
): string[] {
  return members.map((m) => {
    const head = `type: z.literal(${JSON.stringify(m.tag)})`;
    if (m.shape === "none") return `z.object({ ${head} })`;
    if (m.shape === "scalar") return `z.object({ ${head}, value: ${scalarZod(m.type)} })`;
    const body = m.fields.map((f) => `${f.name}: ${fieldZod(f)}`).join(", ");
    return `z.object({ ${head}${body ? `, ${body}` : ""} })`;
  });
}

/** Assemble the `z.discriminatedUnion("type", [...])` string from already-
 *  rendered member object literals.  Shared by every Zod-emitting backend. */
export function discriminatedUnionZod(memberObjects: string[]): string {
  return `z.discriminatedUnion("type", [${memberObjects.join(", ")}])`;
}

/** Raw JSON schema of a tagged-union member list — one `oneOf` arm per
 *  member: the `type` discriminator literal plus the member's wire fields.
 *  Consumed by the backends whose OpenAPI layer can't express the union
 *  through its native response-model types without publishing extra
 *  per-variant components (FastAPI's install_openapi post-processor, the
 *  springdoc customizer's baked components, the .NET document filter).
 *  Structural kinds only — the parity diff folds formats. */
export function unionMembersJsonSchema(members: readonly UnionMember[]): unknown {
  return { oneOf: members.map(memberJsonSchema) };
}

function memberJsonSchema(m: UnionMember): unknown {
  const props: Record<string, unknown> = { type: { type: "string", enum: [m.tag] } };
  const required = ["type"];
  if (m.shape === "scalar") {
    props.value = jsonSchemaType(m.type);
    required.push("value");
  } else if (m.shape === "record") {
    for (const f of m.fields) {
      props[f.name] = jsonSchemaType(f.type);
      if (!f.optional) required.push(f.name);
    }
  }
  return { type: "object", properties: props, required };
}

// ---------------------------------------------------------------------------
// Operation-return unions: the OpenAPI split (M-FT.24, OpenAPI half).
//
// An exception-less operation `reject(): string or NotFound` does not answer
// its whole union at 200.  Every backend's route turns an `error`-kind arm into
// an RFC 7807 problem at that arm's resolved status, carrying the arm's fields
// as §3.2 extension members.  Only the success arms reach the 200 body, which
// stays tagged (`{ "type": "string", "value": … }`).  The published contract
// says the same thing:
//
//   200            → `<Union>Success`, a tagged `oneOf` over the success arms
//                    only.
//   <arm status>   → `anyOf: [ProblemDetails, <Tag>Problem, …]` under
//                    `application/problem+json`.  `<Tag>Problem` is
//                    ProblemDetails plus the arm's fields, required.  Plain
//                    ProblemDetails stays in the `anyOf` because the status
//                    has a generic producer too: an absent aggregate is a 404
//                    on every operation route, and that body has no arm fields.
//
// The split is decided here once; each backend renders it.  The runtime wire
// does not change.
// ---------------------------------------------------------------------------

/** The RFC 7807 core members.  Every backend spreads the arm first and the
 *  problem members after it, so an arm field with one of these names is
 *  overwritten on the wire and is not declared as an arm field. */
const RFC7807_MEMBERS: ReadonlySet<string> = new Set([
  "type",
  "title",
  "status",
  "detail",
  "instance",
]);

/** One `error`-kind arm of an operation-return union. */
export interface OpUnionErrorArm {
  /** The arm's wire tag (the error payload's name, e.g. `NotFound`). */
  tag: string;
  /** The status the route answers this arm with: the context's `httpStatus`
   *  override, else the stdlib default. */
  status: number;
  /** Component name of the arm's problem body: `<Tag>Problem`. */
  problemName: string;
  /** The arm's own fields, minus any that collide with an RFC 7807 member. */
  fields: UnionMemberField[];
}

/** The OpenAPI split of one operation-return union. */
export interface OpUnionResponses {
  /** The full union's instance name (`stringOrNotFound`). */
  unionName: string;
  /** Component name of the 200 body: `<Union>Success` when the union was
   *  split, else `unionName` (the 200 is the whole union). */
  successName: string;
  /** The arms that reach the 200 body, in source order. */
  success: UnionMember[];
  /** The `error`-kind arms, in source order.  Empty when not split. */
  errors: OpUnionErrorArm[];
  /** The error arms grouped by status, ascending. */
  errorStatuses: { status: number; arms: OpUnionErrorArm[] }[];
}

/** Split an operation-return union into the arms that answer 200 and the
 *  `error`-kind arms that answer a problem at their own status.  A union with
 *  no error arm, or no success arm, comes back unsplit (`errors: []`,
 *  `successName === unionName`).  With no error arm there is nothing to move
 *  out of the 200.  With no success arm there is no 200 body to narrow, and
 *  `oneOf: []` is not a valid schema. */
export function opUnionResponses(variants: TypeIR[], ctx: BoundedContextIR): OpUnionResponses {
  const unionName = unionInstanceName(variants);
  const members = unionMembers(variants, ctx);
  const isErrorArm = (v: TypeIR): boolean =>
    v.kind === "entity" && ctx.payloads.some((p) => p.name === v.name && p.kind === "error");
  const success: UnionMember[] = [];
  const errors: OpUnionErrorArm[] = [];
  variants.forEach((v, i) => {
    const m = members[i]!;
    if (!isErrorArm(v)) {
      success.push(m);
      return;
    }
    errors.push({
      tag: m.tag,
      status: resolveErrorStatus(m.tag, ctx.errorStatusOverrides),
      problemName: `${m.tag}Problem`,
      fields: m.shape === "record" ? m.fields.filter((f) => !RFC7807_MEMBERS.has(f.name)) : [],
    });
  });
  if (errors.length === 0 || success.length === 0) {
    return { unionName, successName: unionName, success: members, errors: [], errorStatuses: [] };
  }
  const byStatus = new Map<number, OpUnionErrorArm[]>();
  for (const e of errors) byStatus.set(e.status, [...(byStatus.get(e.status) ?? []), e]);
  const errorStatuses = [...byStatus.entries()]
    .sort(([a], [b]) => a - b)
    .map(([status, arms]) => ({ status, arms }));
  return { unionName, successName: `${unionName}Success`, success, errors, errorStatuses };
}

/** Raw JSON schema of an error arm's problem body: ProblemDetails plus the
 *  arm's fields, required (the route spreads the arm's whole value into the
 *  body).  `problemRef` is the backend's `$ref` to its ProblemDetails. */
export function errorArmProblemJsonSchema(arm: OpUnionErrorArm, problemRef: string): unknown {
  const props: Record<string, unknown> = {};
  const required: string[] = [];
  for (const f of arm.fields) {
    props[f.name] = jsonSchemaType(f.type);
    if (!f.optional) required.push(f.name);
  }
  return { allOf: [{ $ref: problemRef }, { type: "object", properties: props, required }] };
}

/** Raw JSON schema of the problem response at one error-arm status: `anyOf`
 *  the plain ProblemDetails and each arm's problem body.  `ref` maps a
 *  component name to the backend's `$ref` string. */
export function errorStatusJsonSchema(
  arms: readonly OpUnionErrorArm[],
  problemSchema: string,
  ref: (component: string) => string,
): unknown {
  return {
    anyOf: [problemSchema, ...arms.map((a) => a.problemName)].map((n) => ({ $ref: ref(n) })),
  };
}

/** Compact TypeIR → JSON-schema fragment for the union arms above.
 *  Enums / VOs / entities inline as their structural type. */
function jsonSchemaType(t: TypeIR): unknown {
  const info = wireTypeInfo(t, "response");
  if (info.isNullable) return jsonSchemaType(peelNullable(t));
  if (info.isCollection) return { type: "array", items: jsonSchemaType(peelCollection(t)) };
  switch (info.refKind) {
    case "primitive":
      switch (info.primitive) {
        case "int":
        case "long":
          return { type: "integer" };
        case "decimal":
          return { type: "number" };
        case "bool":
          return { type: "boolean" };
        case "json":
          return { type: "object" };
        default:
          // string / guid / datetime / money — all cross as strings.
          return { type: "string" };
      }
    case "id":
      return { type: "string" };
    case "enum":
      return { type: "string" };
    default:
      return { type: "object" };
  }
}
