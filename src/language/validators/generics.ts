// Generic-carrier checks (payload-transport-layer.md, phase P3).
//
// Carrier-bound rule for ML-postfix generic instantiation (`customer paged`).  The single type argument of a blessed generic carrier
// must itself be a *carrier* — a primitive, an `X id`, an enum, a value
// object, or an entity (aggregate / entity part, which project through their
// wire shape).  Two shapes are rejected:
//
//   * a `slot` argument — `slot` is a UI-only param marker, never a
//     boundary-crossing carrier; and
//   * a nested generic argument (`T paged paged`) — v1 ships only
//     single-level instantiation (A7a); nested carriers arrive with P3b
//     monomorphization.
//
// The grammar (`base (ctors+=GenericCtor)*`) admits both forms so the surface
// and IR stay forward-compatible, and lowering folds them faithfully; this
// model-level check is what restricts v1 to the supported subset.
//
// A second rule pins *position*: a generic carrier is a transport shape, so it
// may only appear as a repository find's return type or as a payload field —
// never as a stored property, parameter, or signature elsewhere.  This keeps
// `genericInstance` out of the storage-side emitters entirely.

import { AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import type { Model, TypeAtom, TypeRef } from "../generated/ast.js";
import {
  isCapability,
  isPayloadDecl,
  isProperty,
  isQueryHandler,
  isSelfType,
  isSlotType,
  isTypeAtom,
  isTypeRef,
} from "../generated/ast.js";

/** `Self id` (the anchored capability type, typed-capabilities.md) is only
 *  meaningful inside a `capability` body, where it resolves to the implementing
 *  aggregate's own type at splice time.  Anywhere else there is no implementor
 *  to resolve it to, so it is an error — the author should name a concrete
 *  `<Aggregate> id`. */
export function checkSelfType(model: Model, accept: ValidationAcceptor): void {
  for (const node of AstUtils.streamAllContents(model)) {
    if (!isSelfType(node)) continue;
    if (!AstUtils.getContainerOfType(node, isCapability)) {
      accept("error", diagMessage("loom.self-outside-capability"), {
        node,
        code: "loom.self-outside-capability",
      });
    }
  }
}

export function checkGenericCarriers(model: Model, accept: ValidationAcceptor): void {
  for (const node of AstUtils.streamAllContents(model)) {
    if (isTypeRef(node) || isTypeAtom(node)) {
      checkOptionDeprecated(node, accept);
      checkEnvelopeRemoved(node, accept);
    }
    if (isTypeRef(node)) {
      checkTypeRefCarrier(node, accept);
      checkTypeRefPosition(node, accept);
    }
  }
}

/** `T option` is `T?` (D-ABSENCE-MODEL): it lowers to the one nullable shape,
 *  so the keyword is a deprecated spelling with a mechanical fix. */
function checkOptionDeprecated(t: TypeRef | TypeAtom, accept: ValidationAcceptor): void {
  t.ctors.forEach((ctor, index) => {
    if (ctor !== "option") return;
    accept("warning", diagMessage("loom.option-deprecated"), {
      node: t,
      property: "ctors",
      index,
      code: "loom.option-deprecated",
    });
  });
}

/** `T envelope` meant exactly `T` — a single value, no wire carrier — so the
 *  keyword is refused with a mechanical fix: drop it.  It still parses so the
 *  refusal can name the replacement; it lowers as its argument. */
function checkEnvelopeRemoved(t: TypeRef | TypeAtom, accept: ValidationAcceptor): void {
  t.ctors.forEach((ctor, index) => {
    if (ctor !== "envelope") return;
    accept("error", diagMessage("loom.envelope-removed"), {
      node: t,
      property: "ctors",
      index,
      code: "loom.envelope-removed",
    });
  });
}

/** The constructors that build a transport carrier — `option` is `T?` and a
 *  refused `envelope` is its argument, so neither is one. */
const carrierCtors = (t: TypeRef): string[] =>
  t.ctors.filter((c) => c !== "option" && c !== "envelope");

/** A generic carrier is a transport shape, not a stored value — it may only
 *  appear as a queryHandler's return type or as a field of a payload
 *  (payload-transport-layer.md, P3b).  Anywhere else (a stored aggregate /
 *  value-object property, a parameter, a derived/state field, a function
 *  signature) is rejected, which also keeps the storage-side emitters
 *  (migrations, schema columns, wire-spec) free of `genericInstance`. */
function checkTypeRefPosition(t: TypeRef, accept: ValidationAcceptor): void {
  // `option` is `T?`, legal in any position; only the transport carriers stay
  // bound to one.
  const carriers = carrierCtors(t);
  if (carriers.length === 0) return;
  const container = t.$container;
  // A queryHandler's return type: the TypeRef sits directly on the QueryHandler
  // (`queryHandler X(...): <T> paged`).  A paged read exposed through the
  // application layer is the durable read-path vehicle (read-path-architecture.md,
  // "The ergonomic default") — the criterion runs through the read-only port and
  // the handler returns the `Paged<T>` envelope, so `paged` is legal here.  Params are wrapped in `Parameter` nodes,
  // so a param carrier still doesn't match.
  if (isQueryHandler(container)) return;
  // A payload field: a `Property` whose owner is a `PayloadDecl`.
  if (isProperty(container) && isPayloadDecl(container.$container)) return;
  accept("error", diagMessage("loom.generic-position", { ctors: carriers.join(" ") }), {
    node: t,
    property: "ctors",
    code: "loom.generic-position",
  });
}

function checkTypeRefCarrier(t: TypeRef, accept: ValidationAcceptor): void {
  const ctors = carrierCtors(t);
  if (ctors.length === 0) return;

  // Nesting: with two or more postfix constructors, every constructor past
  // the innermost receives a generic-instance argument — not a carrier.
  // `T paged paged` → `paged(paged(T))`.  Rejected.
  if (ctors.length > 1) {
    accept(
      "error",
      diagMessage("loom.generic-arg-not-carrier#nested-generic-carriers", {
        ctors: ctors.join(" "),
        ctors2: ctors[ctors.length - 1],
      }),
      { node: t, property: "ctors", code: "loom.generic-arg-not-carrier" },
    );
    return;
  }

  // Single constructor: its argument is the base type.  Only `slot` is a
  // non-carrier base — primitives, ids, enums, value objects and entities are
  // all valid carriers (unresolved named refs are reported elsewhere).
  if (isSlotType(t.base)) {
    accept(
      "error",
      diagMessage("loom.generic-arg-not-carrier#requires-a-carrier-type", { ctors: ctors[0] }),
      { node: t, property: "base", code: "loom.generic-arg-not-carrier" },
    );
  }
}
