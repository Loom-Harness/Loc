import type { PrimitiveName } from "../../ir/types/loom-ir.js";

/** Field-shaped (non-call) members a PRIMITIVE receiver carries, beyond the
 *  `src/util/intrinsics.ts` catalogue.  One table, three readers — the member
 *  TYPING (the typing pass, `elaborate.ts`), the completion list (`membersOfType`) and the
 *  membership judgement (`absentPrimitiveMember`) all consult it, so a future
 *  scalar field cannot be legal in one and unknown in another.
 *
 *  `string.length` is the only entry today: it is the one bare scalar member
 *  every backend renders (`.length` / `.Length` / `len()` / `String.length/1`).
 *  Everything else reachable on a scalar is an intrinsic CALL. */
export const PRIMITIVE_FIELDS: ReadonlyMap<
  PrimitiveName,
  ReadonlyMap<string, PrimitiveName>
> = new Map([["string", new Map<string, PrimitiveName>([["length", "int"]])]]);

/** The type of a primitive's field-shaped member, or `undefined` when the
 *  primitive has no such field. */
export function primitiveFieldType(recv: PrimitiveName, name: string): PrimitiveName | undefined {
  return PRIMITIVE_FIELDS.get(recv)?.get(name);
}
