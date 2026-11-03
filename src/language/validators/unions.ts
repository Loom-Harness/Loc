// Discriminated-union checks (payload-transport-layer.md, P4).
//
// Both union surfaces produce a variant list:
//   * anonymous `A or B or C` — a `TypeRef` head atom plus its `alternatives`;
//   * named `payload Foo = A | B | C` — a `PayloadDecl`'s `variants`.
//
// Two AST-level rules pin the variant set:
//   * `loom.union-duplicate-variant` — each variant must be a distinct type.
//     `string or string` / `payload F = A | A` is rejected so the wire
//     discriminator (the per-variant `type` tag) stays unambiguous.
//   * `loom.union-variant-not-carrier` — a `slot` variant is rejected: `slot`
//     is a UI-only param marker, never a boundary-crossing union variant.
//
// Match exhaustiveness over a union scrutinee is deferred to P4b — it needs the
// resolved scrutinee type that arrives with union narrowing + emission.

import { AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import type { Model, TypeAtom, TypeRef } from "../generated/ast.js";
import {
  isCommandHandler,
  isDomainServiceOperation,
  isNamedType,
  isOperation,
  isPayloadDecl,
  isProperty,
  isQueryHandler,
  isSlotType,
  isTypeRef,
  isWorkflowCreateDecl,
} from "../generated/ast.js";

export function checkUnions(model: Model, accept: ValidationAcceptor): void {
  for (const node of AstUtils.streamAllContents(model)) {
    if (isTypeRef(node) && node.alternatives.length > 0) {
      // The anonymous `or` form: head atom + each alternative.
      checkVariants([node, ...node.alternatives], accept);
      checkUnionPosition(node, accept);
    } else if (isPayloadDecl(node) && node.variants.length > 0) {
      checkVariants(node.variants, accept);
    }
  }
}

/** An inline `A or B` union is a transport shape (like a generic carrier) — it
 *  may only appear as an operation's return type (or, with an `error`
 *  variant, a routed command entry point's — see below), not
 *  as a stored property / parameter elsewhere.  This keeps the `union` TypeIR
 *  out of the storage-side emitters (drizzle columns, migrations) that don't
 *  render it.  A *named* union (`payload Foo = A | B`) is referenced by name
 *  (an `entity` marker) and so is unaffected.
 *
 *  A payload FIELD is refused too: the tagged wire is emitted for a union at
 *  the top of a return, and no backend renders one NESTED inside a record —
 *  an `error` payload's union field, or a workflow `create` payload's, reached
 *  every backend's wire-DTO emitter with nothing to render it as. */
function checkUnionPosition(t: TypeRef, accept: ValidationAcceptor): void {
  const container = t.$container;
  if (isProperty(container) && isPayloadDecl(container.$container)) {
    accept("error", diagMessage("loom.union-position#payload-field"), {
      node: t,
      code: "loom.union-position",
    });
    return;
  }
  // An operation's `or`-union return type (exception-less.md): a designed-in
  // outcome (`operation place(): OrderId or NotFound`), not a stored value.
  if (isOperation(container)) return;
  // A domainService operation's `or`-union return (domain-services.md) — the
  // same designed-in-outcome shape as an aggregate operation return.
  if (isDomainServiceOperation(container)) return;
  // The result of a routed command entry point — a workflow `create`, a
  // `commandHandler`, a `queryHandler` — may be an expected failure: a union
  // with at least one `error` variant answers the error at its mapped status.
  // A union with no error variant, or one on an `extern` handler (whose user
  // code owns the result), stays a transport shape out of place here.
  if (
    t.$containerProperty === "returnType" &&
    (isWorkflowCreateDecl(container) ||
      ((isCommandHandler(container) || isQueryHandler(container)) && !container.extern)) &&
    [t, ...t.alternatives].some(isErrorAtom)
  ) {
    return;
  }
  accept("error", diagMessage("loom.union-position"), { node: t, code: "loom.union-position" });
}

/** True when the union variant names an `error` payload.  A variant a macro
 *  built carries a plain, never-linked `{ $refText }` reference (it resolves
 *  by name, as lowering reads it), so an unlinked one is looked up by name
 *  among the model's `error` records. */
function isErrorAtom(a: TypeRef | TypeAtom): boolean {
  if (!isNamedType(a.base)) return false;
  const ref = a.base.target;
  if (ref?.ref) return isPayloadDecl(ref.ref) && ref.ref.kind === "error";
  const name = ref?.$refText;
  if (!name) return false;
  for (const n of AstUtils.streamAllContents(AstUtils.findRootNode(a))) {
    if (isPayloadDecl(n) && n.kind === "error" && n.name === name) return true;
  }
  return false;
}

/** Stable structural key for a variant atom — base identity plus the postfix
 *  ctor list and the array / optional markers.  Two variants with the same key
 *  are the same type (`string` vs `string?` differ; `Customer id` collides
 *  with another `Customer id`). */
function atomKey(a: TypeRef | TypeAtom): string {
  const base = a.base;
  let b: string;
  switch (base.$type) {
    case "PrimitiveType":
      b = base.name;
      break;
    case "SlotType":
      b = "slot";
      break;
    case "IdType":
      b = `id:${base.target.$refText}`;
      break;
    case "NamedType":
      b = base.target.$refText;
      break;
    default:
      b = "?";
  }
  return `${b}|${a.ctors.join(",")}|${a.array ? "[]" : ""}|${a.optional ? "?" : ""}`;
}

function checkVariants(variants: (TypeRef | TypeAtom)[], accept: ValidationAcceptor): void {
  const seen = new Set<string>();
  for (const v of variants) {
    if (isSlotType(v.base)) {
      accept("error", diagMessage("loom.union-variant-not-carrier"), {
        node: v,
        property: "base",
        code: "loom.union-variant-not-carrier",
      });
      continue;
    }
    const key = atomKey(v);
    if (seen.has(key)) {
      accept("error", diagMessage("loom.union-duplicate-variant"), {
        node: v,
        code: "loom.union-duplicate-variant",
      });
      continue;
    }
    seen.add(key);
  }
}
