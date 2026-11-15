// What the per-aggregate api module and Playwright page objects know about an
// aggregate.
//
// Both emitters render the same client surface — the request and response
// schemas, the query and mutation hooks, the list / new / detail page objects —
// and every fact they need about the aggregate behind it is here, in one
// narrow shape.  Two adapters build it:
//   - `frontendAggregateOfContract` reads the Frontend Contract.  React and
//     Vue emit from it.
//   - `frontendAggregateOf` reads the enriched aggregate and its bounded
//     context.  The frontends that do not yet emit from the contract build
//     their page objects with it.
// `test/generator/_frontend/aggregate-model-equivalence.test.ts` holds the two
// equal on every tracked model with a React or Vue frontend.

import type { ContractInvariant, FrontendContract } from "../../ir/contract/frontend-contract.js";
import { createRequestFields } from "../../ir/plan/create-request.js";
import { unionReturn } from "../../ir/stdlib/unions.js";
import {
  type AggregateIR,
  aggregateUsesMoneyDeep,
  type BoundedContextIR,
  type ExprIR,
  type TypeIR,
} from "../../ir/types/loom-ir.js";
import { emitsRestCreate } from "../../ir/util/canonical-lifecycle.js";
import { partsChildrenFirst } from "../../ir/util/containment-parent.js";
import { operationFormParams } from "../../ir/util/op-gates.js";
import {
  collectReachableTypes,
  enumPool,
  orderValueObjectsByDependency,
  type ScopeEnum,
  type ScopeValueObject,
  type TypeScope,
  valueObjectPool,
} from "../../ir/util/reachable-types.js";
import { snake } from "../../util/naming.js";
import { type ContractHome, contractHomes } from "../_walker/walker-model.js";
import type { ClientFind } from "./contract.js";
import { collectUsedTypes } from "./zod-schemas.js";

/** A request or record field, as a client schema and form render it. */
export interface FrontendField {
  readonly name: string;
  readonly type: TypeIR;
  readonly optional: boolean;
  readonly default?: ExprIR;
}

/** A value object whose `<Vo>Schema` the api module declares: its fields and
 *  the rules a client validates it against. */
export interface SchemaValueObject extends ScopeValueObject {
  readonly invariants: readonly ContractInvariant[];
}

/** One public operation of the aggregate. */
export interface FrontendOperation {
  readonly name: string;
  /** The route segment the operation is posted to (`/<tag>/{id}/<segment>`). */
  readonly segment: string;
  /** The operation has a `when` gate, probed at `GET /{id}/can_<segment>`. */
  readonly gated: boolean;
  /** The variants of a union return, served tagged at 200. */
  readonly union?: readonly TypeIR[];
  /** How many parameters the operation takes. */
  readonly paramCount: number;
  /** The parameters its generated form renders: a masked merge-patch key is
   *  left out. */
  readonly formParams: readonly { readonly name: string; readonly type: TypeIR }[];
}

export interface FrontendAggregate {
  readonly name: string;
  /** The type scope of the context that declares it. */
  readonly scope: TypeScope<ScopeEnum, SchemaValueObject>;
  /** The aggregate serves a REST create. */
  readonly restCreate: boolean;
  /** The fields of its create request. */
  readonly createFields: readonly FrontendField[];
  /** Its public operations, in declaration order. */
  readonly operations: readonly FrontendOperation[];
  /** The contained collections a detail page renders as tables. */
  readonly collections: readonly string[];
  /** Its parts, each after every part it references. */
  readonly parts: readonly string[];
  /** The enums and value objects the module declares schemas for: those its
   *  wire surface reaches, value objects in dependency order. */
  readonly enums: readonly ScopeEnum[];
  readonly valueObjects: readonly SchemaValueObject[];
  /** A response the module emits carries money. */
  readonly usesMoney: boolean;
  /** A response the module emits carries a `provenanced` field. */
  readonly carriesProvenance: boolean;
  /** The fields of the `error` record `name` its context declares. */
  errorRecord(name: string): { readonly fields: readonly FrontendField[] } | undefined;
}

const field = (f: {
  name: string;
  type: TypeIR;
  optional?: boolean;
  default?: ExprIR;
}): FrontendField => ({
  name: f.name,
  type: f.type,
  optional: !!f.optional,
  ...(f.default !== undefined ? { default: f.default } : {}),
});

/** True iff the aggregate (root or a part) declares a `provenanced` field — the
 *  gate for importing `provLineageSchema` into the api module, since the
 *  `Provenanced<T>` carrier's `lineage` member references it.
 *
 *  Not an opt-in: the carrier is part of `wireShape`, so EVERY frontend's
 *  response schema carries the lineage the moment the field is declared
 *  `provenanced`.  The enriched-model twin of
 *  {@link FrontendAggregate.carriesProvenance}, for the Svelte and Angular
 *  api modules. */
export function aggregateHasProvenanced(agg: AggregateIR): boolean {
  return (
    agg.fields.some((f) => f.provenanced) ||
    agg.parts.some((p) => p.fields.some((f) => f.provenanced))
  );
}

/** The model of `agg` built from its enriched node and declaring context. */
export function frontendAggregateOf(
  agg: AggregateIR,
  ctx: BoundedContextIR,
  finds: readonly ClientFind[] = [],
): FrontendAggregate {
  const used = collectUsedTypes(agg, { finds }, ctx);
  return {
    name: agg.name,
    scope: ctx,
    restCreate: emitsRestCreate(agg),
    createFields: createRequestFields(ctx.payloads, agg).map(field),
    operations: agg.operations
      .filter((o) => o.visibility === "public")
      .map((o) => {
        const u = o.returnType ? unionReturn(o.returnType) : null;
        return {
          name: o.name,
          segment: snake(o.routeSlug ?? o.name),
          gated: !!o.when,
          ...(u ? { union: u.variants } : {}),
          paramCount: o.params.length,
          formParams: operationFormParams(o).map((p) => ({ name: p.name, type: p.type })),
        };
      }),
    collections: agg.contains
      .filter((c) => c.collection && agg.parts.some((p) => p.name === c.partName))
      .map((c) => c.name),
    parts: partsChildrenFirst(agg.parts).map((p) => p.name),
    enums: used.enums,
    valueObjects: used.valueObjects,
    usesMoney: aggregateUsesMoneyDeep(agg, valueObjectPool(ctx)),
    carriesProvenance: aggregateHasProvenanced(agg),
    errorRecord: (name) => {
      const p = ctx.payloads.find((x) => x.name === name && x.kind === "error");
      return p && { fields: p.fields.map(field) };
    },
  };
}

/** The model of aggregate `name` built from the Frontend Contract, or
 *  undefined when the contract carries no such aggregate. */
export function frontendAggregateOfContract(
  contract: FrontendContract,
  name: string,
  finds: readonly ClientFind[] = [],
): FrontendAggregate | undefined {
  const w = contract.wire;
  const a = w.aggregates.find((x) => x.name === name);
  if (!a) return undefined;
  const home = contractHomes(contract, [a.context]).get(a.context) as ContractHome;
  const responseOf = (entity: string) => w.responses.find((r) => r.entity === entity);
  const ops = w.operations.filter((o) => o.aggregate === name);
  const create = ops.find((o) => o.kind === "create");
  const createRecord = create?.request
    ? w.records.find((r) => r.name === create.request)
    : undefined;
  const gated = new Set(ops.filter((o) => o.kind === "gateProbe").map((o) => o.opName));
  const operations: FrontendOperation[] = ops
    .filter((o) => o.kind === "operation" && o.opName !== undefined)
    .map((o) => {
      const body = o.params.filter((p) => p.location === "body");
      const optional = new Set(o.optionalParams ?? []);
      const u = o.responseType ? unionReturn(o.responseType) : null;
      return {
        name: o.opName as string,
        segment: o.path.slice(o.path.lastIndexOf("/") + 1),
        gated: gated.has(o.opName),
        ...(u ? { union: u.variants } : {}),
        paramCount: body.length,
        formParams: body
          .filter((p) => !optional.has(p.name))
          .map((p) => ({ name: p.name, type: p.type })),
      };
    });
  const partNames = new Set(a.parts ?? []);
  // A part's response names the parts it contains as `<Part>Response`.
  const partRefs = (entity: string): string[] => {
    const out: string[] = [];
    const visit = (t: TypeIR): void => {
      if (t.kind === "array") visit(t.element);
      else if (t.kind === "optional") visit(t.inner);
      else if (t.kind === "entity" && t.name.endsWith("Response")) {
        const p = t.name.slice(0, -"Response".length);
        if (partNames.has(p)) out.push(p);
      }
    };
    for (const f of responseOf(entity)?.fields ?? []) visit(f.type);
    return out;
  };
  const collections = (responseOf(name)?.fields ?? [])
    .filter(
      (f) =>
        f.type.kind === "array" &&
        f.type.element.kind === "entity" &&
        f.type.element.name.endsWith("Response") &&
        partNames.has(f.type.element.name.slice(0, -"Response".length)),
    )
    .map((f) => f.name);
  const parts: string[] = [];
  const placed = new Set<string>();
  const place = (p: string, onStack: Set<string>): void => {
    if (placed.has(p) || onStack.has(p)) return;
    onStack.add(p);
    for (const r of partRefs(p)) place(r, onStack);
    onStack.delete(p);
    placed.add(p);
    parts.push(p);
  };
  for (const p of a.parts ?? []) place(p, new Set());
  const entities = [name, ...(a.parts ?? [])];
  const responseTypes = entities.flatMap((e) => (responseOf(e)?.fields ?? []).map((f) => f.type));
  const seeds = [
    ...responseTypes,
    ...ops.flatMap((o) => o.params.map((p) => p.type)),
    ...(createRecord?.fields ?? []).map((f) => f.type),
    ...finds.flatMap((f) => f.params.map((p) => p.type)),
  ];
  const pool = valueObjectPool(home);
  const reached = collectReachableTypes(seeds, pool);
  const reachesMoney = (t: TypeIR, seen: Set<string>): boolean => {
    if (t.kind === "primitive") return t.name === "money";
    if (t.kind === "array") return reachesMoney(t.element, seen);
    if (t.kind === "optional") return reachesMoney(t.inner, seen);
    if (t.kind !== "valueobject" || seen.has(t.name)) return false;
    seen.add(t.name);
    const vo = pool.find((v) => v.name === t.name);
    return (vo?.fields ?? []).some((f) => reachesMoney(f.type, seen));
  };
  return {
    name,
    scope: home,
    restCreate: create !== undefined,
    createFields: (createRecord?.fields ?? []).map(field),
    operations,
    collections,
    parts,
    enums: enumPool(home).filter((e) => reached.enums.has(e.name)),
    valueObjects: orderValueObjectsByDependency(
      pool.filter((v) => reached.valueObjects.has(v.name)),
    ),
    usesMoney: responseTypes.some((t) => reachesMoney(t, new Set())),
    carriesProvenance: entities.some((e) =>
      (responseOf(e)?.fields ?? []).some((f) => f.provenanced),
    ),
    errorRecord: (record) => {
      const r = w.records.find(
        (x) => x.name === record && x.kind === "error" && x.context === a.context,
      );
      return r && { fields: r.fields.map(field) };
    },
  };
}

/** {@link frontendAggregateOfContract} for an aggregate the frontend emits an
 *  api module for, which the contract always carries. */
export function contractAggregate(
  contract: FrontendContract,
  name: string,
  finds: readonly ClientFind[],
): FrontendAggregate {
  const m = frontendAggregateOfContract(contract, name, finds);
  if (!m) throw new Error(`internal: the Frontend Contract carries no aggregate '${name}'`);
  return m;
}

/** Resolves an aggregate a scaffold page names to its model: by name, in
 *  the context the page names when the frontend has it. */
export type FrontendAggregateResolver = (
  aggregate: string,
  context: string,
) => FrontendAggregate | undefined;

/** The resolver over a frontend's enriched contexts.  The page's context wins
 *  when the frontend reaches it; else the context that declares the
 *  aggregate. */
export function frontendAggregatesOf(
  contexts: ReadonlyMap<string, BoundedContextIR>,
): FrontendAggregateResolver {
  return (aggregate, context) => {
    let agg: AggregateIR | undefined;
    let home: BoundedContextIR | undefined;
    for (const c of contexts.values()) {
      const a = c.aggregates.find((x) => x.name === aggregate);
      if (a) {
        agg ??= a;
        home ??= c;
      }
    }
    const ctx = contexts.get(context) ?? home;
    return agg && ctx ? frontendAggregateOf(agg, ctx) : undefined;
  };
}

/** The resolver over the Frontend Contract. */
export function frontendAggregatesOfContract(
  contract: FrontendContract,
): FrontendAggregateResolver {
  return (aggregate) => frontendAggregateOfContract(contract, aggregate);
}
