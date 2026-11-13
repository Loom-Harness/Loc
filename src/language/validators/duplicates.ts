// Duplicate-name validator family (full-review remediation §B4, audit
// finding 10).
//
// The grammar admits sibling declarations that share a name; without a
// gate the last one silently wins and the earlier ones vanish:
//
//   • Two `aggregate Order` in one context → the first's fields are
//     dropped wholesale (a duplicate `aggregate Order` retains only the
//     second body).
//   • `total: money` + `total: string` on one aggregate → the field is
//     silently retyped.
//   • Duplicate operation params, event fields, value-object fields, and
//     enum values all pass validation and mangle the emitted DTO / signature.
//
// This module closes the class with four namespaces, each a themed
// `loom.duplicate-*` code:
//
//   1. loom.duplicate-context-type   — sibling aggregate / value-object /
//      event / enum *type* names must be unique within a bounded context
//      (they share the context's type-name namespace).  Root-level value
//      objects / enums / systems / contexts are covered separately by the
//      IR validator (`src/ir/validate/checks/structural-checks.ts`); this
//      is the context-scoped complement.  Payload name collisions are owned
//      by `validators/payload.ts` (`loom.payload-name-conflict`).
//   2. loom.duplicate-field          — property / derived / containment
//      *field* names must be unique within an aggregate / value object /
//      event (they all lower to one member of the wire shape).  Duplicate
//      entity-part *type* names and reserved `derived display`/`inspect`
//      collisions are owned by `validators/structural.ts`; payload fields by
//      `validators/payload.ts` (`loom.payload-duplicate-field`).
//   3. loom.duplicate-parameter      — operation / function / create /
//      destroy / commandHandler / queryHandler parameter names must be
//      distinct.
//   4. loom.duplicate-enum-value     — enum values must be distinct.
//   5. loom.duplicate-handler        — within a context, a `commandHandler` /
//      `queryHandler` name must not collide with another handler in the same
//      context (unfoldable-api-derivation.md,
//      Layer 3-4).  A `route -> Context.<name>` resolves the bare name against
//      the UNION of both kinds, so a collision silently deduplicates in the
//      resolver and a route would dispatch ambiguously.
//   6. loom.duplicate-repository     — within a context, at most one
//      `repository … for X` per aggregate.  A repository is body-less and its
//      surface is the shared verb contract (D-REPOSITORY-CONTRACT), so a
//      second one is only another name for the same store; the backends emit
//      one repository class per aggregate and resolve operations per
//      aggregate, so the alias would either crash an emitter or quietly share
//      the first one's class.

import type { AstNode, ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import type {
  Aggregate,
  BoundedContext,
  EnumDecl,
  EventDecl,
  Model,
  Parameter,
  ValueObject,
} from "../generated/ast.js";
import {
  isAggregate,
  isBoundedContext,
  isCommandHandler,
  isContainment,
  isCreate,
  isDerivedProp,
  isDestroy,
  isEntityPart,
  isEnumDecl,
  isEventDecl,
  isFunctionDecl,
  isOperation,
  isProperty,
  isQueryHandler,
  isRepository,
  isValueObject,
} from "../generated/ast.js";
import { modelContents } from "./model-contents.js";

/** A named member paired with the node the diagnostic should attach to. */
interface Named {
  readonly name: string;
  readonly node: AstNode;
}

/** Emit an error on every occurrence after the first for each repeated name.
 *  The first declaration is left un-flagged (it is the one that "wins"); the
 *  later shadowing declarations carry the diagnostic. */
function reportDuplicates(
  items: readonly Named[],
  code: string,
  message: (name: string) => string,
  accept: ValidationAcceptor,
): void {
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.name)) {
      accept("error", message(it.name), { node: it.node, property: "name", code });
    } else {
      seen.add(it.name);
    }
  }
}

/** Sibling type names within a bounded context — aggregates, value objects,
 *  events, and enums share one type-name namespace. */
function checkContextTypeNames(ctx: BoundedContext, accept: ValidationAcceptor): void {
  const types: Named[] = [];
  for (const m of ctx.members) {
    if (isAggregate(m) || isValueObject(m) || isEventDecl(m) || isEnumDecl(m)) {
      types.push({ name: m.name, node: m });
    }
  }
  reportDuplicates(
    types,
    "loom.duplicate-context-type",
    (name) =>
      `Duplicate declaration '${name}' in context '${ctx.name}'; aggregate / value-object / ` +
      `event / enum names must be unique within a context (the later one silently replaces the first).`,
    accept,
  );
}

/** Application-layer handler names within a context — `commandHandler` /
 *  `queryHandler` context members share one route-target namespace
 *  (`route -> Context.<name>`), so a handler whose name an earlier handler in
 *  the same context already took is ambiguous. */
function checkHandlerNames(ctx: BoundedContext, accept: ValidationAcceptor): void {
  const seen = new Set<string>();
  // Walk the explicit handlers in document order; each collides if its name is
  // already taken by an earlier handler.
  for (const m of ctx.members) {
    if (isCommandHandler(m) || isQueryHandler(m)) {
      const kind = isCommandHandler(m) ? "commandHandler" : "queryHandler";
      if (seen.has(m.name)) {
        accept(
          "error",
          diagMessage("loom.duplicate-handler", { name: m.name, ctxName: ctx.name, kind }),
          { node: m, property: "name", code: "loom.duplicate-handler" },
        );
      } else {
        seen.add(m.name);
      }
    }
  }
}

/** One repository per aggregate root within a context: the first
 *  `repository … for X` owns X, every later one is refused. */
function checkRepositoryTargets(ctx: BoundedContext, accept: ValidationAcceptor): void {
  const owner = new Map<string, string>();
  for (const m of ctx.members) {
    if (!isRepository(m)) continue;
    const agg = m.aggregate.ref?.name ?? m.aggregate.$refText;
    const first = owner.get(agg);
    if (first === undefined) {
      owner.set(agg, m.name);
      continue;
    }
    accept(
      "error",
      diagMessage("loom.duplicate-repository", { name: m.name, agg, first, ctxName: ctx.name }),
      { node: m, property: "aggregate", code: "loom.duplicate-repository" },
    );
  }
}

/** Field-position names on an aggregate — properties, derived fields, and
 *  containments all lower to a single wire-shape member, so they share one
 *  namespace.  (Entity-part *type* names are a separate namespace, gated in
 *  `structural.ts`.) */
function checkAggregateFieldNames(agg: Aggregate, accept: ValidationAcceptor): void {
  const fields: Named[] = [];
  for (const m of agg.members) {
    if (isProperty(m) || isDerivedProp(m) || isContainment(m)) {
      fields.push({ name: m.name, node: m });
    }
  }
  reportDuplicates(
    fields,
    "loom.duplicate-field",
    (name) =>
      `Duplicate field '${name}' in aggregate '${agg.name}'; property, derived, and containment ` +
      `names must be distinct (they map to one field of the wire shape).`,
    accept,
  );
}

/** The member namespace of an aggregate or entity part: a field, derived field,
 *  containment, function and named operation all become one member of the
 *  generated class (a getter / property beside a method of the same name), so a
 *  callable that reuses a field's name — or an earlier callable's — is refused.
 *  Fields repeating a field are `loom.duplicate-field`'s business; this reports
 *  the CALLABLE that collides. */
function checkMemberNamespace(
  owner: string,
  members: readonly AstNode[],
  accept: ValidationAcceptor,
): void {
  const taken = new Map<string, string>();
  for (const m of members) {
    if (isProperty(m) || isDerivedProp(m) || isContainment(m)) {
      const what = isContainment(m) ? "containment" : isDerivedProp(m) ? "derived field" : "field";
      if (!taken.has(m.name)) taken.set(m.name, what);
    }
  }
  for (const m of members) {
    if (!isFunctionDecl(m) && !isOperation(m)) continue;
    const what = isFunctionDecl(m) ? "function" : "operation";
    const first = taken.get(m.name);
    if (first !== undefined) {
      accept(
        "error",
        diagMessage("loom.member-name-collision", { what, name: m.name, owner, first }),
        { node: m, property: "name", code: "loom.member-name-collision" },
      );
    } else {
      taken.set(m.name, what);
    }
  }
}

/** Field-position names on a value object — properties and derived fields
 *  (value objects cannot contain entities). */
function checkValueObjectFieldNames(vo: ValueObject, accept: ValidationAcceptor): void {
  const fields: Named[] = [];
  for (const m of vo.members) {
    if (isProperty(m) || isDerivedProp(m)) fields.push({ name: m.name, node: m });
  }
  reportDuplicates(
    fields,
    "loom.duplicate-field",
    (name) => `Duplicate field '${name}' in value object '${vo.name}'.`,
    accept,
  );
}

/** Field names within an event record. */
function checkEventFieldNames(ev: EventDecl, accept: ValidationAcceptor): void {
  reportDuplicates(
    ev.fields.map((f) => ({ name: f.name, node: f })),
    "loom.duplicate-field",
    (name) => `Duplicate field '${name}' in event '${ev.name}'.`,
    accept,
  );
}

/** Values within an enum. */
function checkEnumValueNames(en: EnumDecl, accept: ValidationAcceptor): void {
  reportDuplicates(
    en.values.map((v) => ({ name: v.name, node: v })),
    "loom.duplicate-enum-value",
    (name) => `Duplicate value '${name}' in enum '${en.name}'.`,
    accept,
  );
}

/** Parameter names within a single signature (operation / function / create /
 *  destroy). */
function checkParamNames(
  params: readonly Parameter[],
  owner: string,
  accept: ValidationAcceptor,
): void {
  reportDuplicates(
    params.map((p) => ({ name: p.name, node: p })),
    "loom.duplicate-parameter",
    (name) => `Duplicate parameter '${name}' in ${owner}.`,
    accept,
  );
}

export function checkDuplicateNames(model: Model, accept: ValidationAcceptor): void {
  for (const node of modelContents(model)) {
    if (isBoundedContext(node)) {
      checkContextTypeNames(node, accept);
      checkHandlerNames(node, accept);
      checkRepositoryTargets(node, accept);
    } else if (isAggregate(node)) {
      checkAggregateFieldNames(node, accept);
      checkMemberNamespace(`aggregate '${node.name}'`, node.members, accept);
    } else if (isEntityPart(node)) {
      checkMemberNamespace(`entity '${node.name}'`, node.members, accept);
    } else if (isValueObject(node)) {
      checkValueObjectFieldNames(node, accept);
      checkMemberNamespace(`value object '${node.name}'`, node.members, accept);
    } else if (isEventDecl(node)) checkEventFieldNames(node, accept);
    else if (isEnumDecl(node)) checkEnumValueNames(node, accept);

    if (isOperation(node)) checkParamNames(node.params, `operation '${node.name}'`, accept);
    else if (isFunctionDecl(node)) checkParamNames(node.params, `function '${node.name}'`, accept);
    else if (isCreate(node))
      checkParamNames(node.params, `create${node.name ? ` '${node.name}'` : ""}`, accept);
    else if (isDestroy(node))
      checkParamNames(node.params, `destroy${node.name ? ` '${node.name}'` : ""}`, accept);
    else if (isCommandHandler(node))
      checkParamNames(node.params, `commandHandler '${node.name}'`, accept);
    else if (isQueryHandler(node))
      checkParamNames(node.params, `queryHandler '${node.name}'`, accept);
  }
}
