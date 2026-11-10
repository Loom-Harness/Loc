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
  isNamedType,
  isPayloadDecl,
  isQueryHandler,
  isSlotType,
  isTypeRef,
} from "../generated/ast.js";
import { admittedPositionsText, positionRule, typeRefPosition } from "../type-positions.js";

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

/** An inline `A or B` union is a transport shape: it stands only where the
 *  type-position table admits it (`type-positions.ts`) — an operation return,
 *  and, with at least one `error` variant, the result of a routed command entry
 *  point (a workflow `create`, a non-`extern` `commandHandler` / `queryHandler`),
 *  where the error answers its mapped status.  This keeps the `union` TypeIR
 *  out of the storage-side emitters (drizzle columns, migrations) that don't
 *  render it.  A payload field is refused with its own message: the tagged wire
 *  is emitted for a union at the top of a return, and no backend renders one
 *  nested inside a record. */
function checkUnionPosition(t: TypeRef, accept: ValidationAcceptor): void {
  const rule = positionRule("inline-union", typeRefPosition(t));
  if (rule.verdict === "allowed" || rule.verdict === "unwritable") return;
  if (rule.verdict === "with-error-variant") {
    const container = t.$container;
    const extern = (isCommandHandler(container) || isQueryHandler(container)) && container.extern;
    if (!extern && [t, ...t.alternatives].some(isErrorAtom)) return;
  }
  const slug = rule.verdict === "refused" ? rule.slug : undefined;
  if (slug === "payload-field") {
    accept("error", diagMessage("loom.union-position#payload-field"), {
      node: t,
      code: "loom.union-position",
    });
    return;
  }
  accept(
    "error",
    diagMessage("loom.union-position", { positions: admittedPositionsText("inline-union") }),
    { node: t, code: "loom.union-position" },
  );
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
