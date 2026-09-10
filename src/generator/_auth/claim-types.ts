// Which generated DOMAIN symbols a `user { … }` claim shape names — the ONE
// detector every backend's auth emitter reads when deciding what its `User`
// module must import.
//
// WHY THIS EXISTS.  A single `.ddd` line
//
//     user { id: string  role: string  customerId: Customer id? }
//
// broke four of five backends, and the missing IMPORT was half of it (D6/P2 of
// `docs/audits/2026-09-10-eshop-dev-experience.md`).  The strong-id class the
// claim's type names is emitted into the DOMAIN tree — `domain/ids.ts`,
// `<basePkg>.domain.ids`, `app/domain/ids` — while the `User` shape is emitted
// into the AUTH tree, so naming it without an import is a hard compile error on
// node (`TS2503: Cannot find namespace 'Ids'`) and java (`cannot find symbol`),
// and a per-call `NameError` on python (the annotation sits inside `cast(...)`
// in a function body, so it is evaluated on every token verification — login is
// permanently broken, not merely un-typechecked).
//
// Each backend still renders its own import SYNTAX — that is irreducibly
// per-language — but the question "does this claim shape name a domain symbol,
// and which" is answered once, here.  Python already carried a private copy of
// exactly this walk; it now reads this instead.

import type { FieldIR, TypeIR } from "../../ir/types/loom-ir.js";

/** Aggregate/entity target names whose strong id (`<Name>Id`) a user-claim
 *  field's type names, sorted + deduped.  Looks through `optional` and `array`
 *  wrappers, so `Customer id?` and `Customer id[]` both count. */
export function claimIdTargets(fields: readonly FieldIR[]): string[] {
  const out = new Set<string>();
  for (const f of fields) collectIdTargets(f.type, out);
  return [...out].sort();
}

/** True when the claim shape names at least one strong id — the gate every
 *  backend's auth emitter puts its `ids` import behind. */
export function claimsReferenceIds(fields: readonly FieldIR[]): boolean {
  return claimIdTargets(fields).length > 0;
}

function collectIdTargets(t: TypeIR, into: Set<string>): void {
  switch (t.kind) {
    case "id":
      into.add(t.targetName);
      return;
    case "optional":
      collectIdTargets(t.inner, into);
      return;
    case "array":
      collectIdTargets(t.element, into);
      return;
    default:
      return;
  }
}
