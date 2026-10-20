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

/** The IdP claim path projected onto a `user { … }` field.
 *
 * An explicit `claims: { field: "path" }` mapping wins; otherwise `id` reads
 * the standard `sub` claim and every other field reads ITS OWN NAME, verbatim.
 *
 * WHY THIS IS SHARED.  Six backends each carried a private copy, and two of
 * them had drifted: python and elixir applied `snake()` to the default, so a
 * single `user { technicianId: string }` made node/java/.NET read the claim
 * `technicianId` while python/elixir read `technician_id`.  An IdP mints ONE
 * name, so the same token could not satisfy both halves of a mixed system —
 * the claim decoded to `null` on the snake_case side, which is silent: the
 * tenant filter then matches nothing and every permission gate 403s, with no
 * diagnostic anywhere.
 *
 * The field name wins because a claim path is an EXTERNAL WIRE NAME, not a
 * language identifier — the same reason those two backends already camelCase
 * their HTTP wire (`problem_details.ex`: "matching the JsonCamelCase wire").
 * Applying a language's local casing convention to a name the IdP owns is the
 * bug; `claims: { … }` is the supported way to say the IdP spells it
 * differently.
 */
export function claimPathFor(field: string, auth: { claims: ReadonlyArray<ClaimMapping> }): string {
  const mapped = auth.claims.find((c) => c.field === field);
  if (mapped) return mapped.path;
  return field === "id" ? "sub" : field;
}

/** The shape `claimPathFor` reads — structural so it accepts `AuthIR` without
 *  this module importing the whole auth IR surface. */
interface ClaimMapping {
  readonly field: string;
  readonly path: string;
}
