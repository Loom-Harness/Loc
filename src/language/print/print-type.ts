// TypeRef → `.ddd` source, shared by the structural printer (field and
// parameter types) and the statement printer (`let x: T = e`).

import type { TypeAtom, TypeRef } from "../generated/ast.js";

export function printTypeRef(node: TypeRef): string {
  // The head atom plus any anonymous `or`-union alternatives (P4).  A
  // non-union TypeRef has an empty `alternatives` and prints as a bare atom.
  const head = printTypeAtom(node);
  const alts = node.alternatives ?? [];
  if (alts.length === 0) return head;
  return [head, ...alts.map(printTypeAtom)].join(" or ");
}

/** Print one type atom — `base` plus the postfix generic carriers (P3:
 *  `customer paged`; P4: `T option`) and the array/optional suffixes, matching
 *  the grammar's `base (ctors)* ([]) (?)` order.  Shared by `printTypeRef`'s
 *  head + `or`-alternatives and by named-union variant printing. */
export function printTypeAtom(node: TypeRef | TypeAtom): string {
  const base = node.base;
  let s: string;
  switch (base.$type) {
    case "PrimitiveType":
      s = base.name;
      break;
    case "SlotType":
      s = "slot";
      break;
    case "ActionType":
      s = base.arg ? `action(${printTypeRef(base.arg)})` : "action";
      break;
    case "SelfType":
      s = "Self id";
      break;
    case "IdType":
      s = `${base.target.$refText} id`;
      break;
    case "NamedType":
      s = base.target.$refText;
      break;
    default: {
      const exhaustive: never = base;
      throw new Error(`printTypeAtom: unhandled base ${(exhaustive as { $type: string }).$type}`);
    }
  }
  // Guard against programmatically built nodes (web builder, macros) that may
  // omit the ctor list.
  const ctorList = node.ctors ?? [];
  const ctors = ctorList.length > 0 ? ` ${ctorList.join(" ")}` : "";
  return `${s}${ctors}${node.array ? "[]" : ""}${node.optional ? "?" : ""}`;
}
