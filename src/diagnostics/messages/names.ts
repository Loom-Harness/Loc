// The `names` family of the diagnostic-message catalog: the `loom.reserved-*`
// codes — a name a declaration may not take, or a clause no backend emits.
//
// A code lives in the family that owns its first segment (`loom.<segment>-…`),
// listed in `segments` below; `../messages.ts` merges every family into
// `DIAGNOSTIC_MESSAGES`, and `test/system/diagnostic-catalog.test.ts` fails on a
// key filed under the wrong family.

import type { MessageEntry } from "./_shared.js";

/** The code first-segments this family owns. */
export const segments = ["reserved"] as const;

export const messages = {
  // ----------------------------------------------------------------------
  // src/language/validators/structural.ts
  // ----------------------------------------------------------------------
  // Reserved derived names are aggregate-only — a value object participates in
  // neither `string(x)` lowering nor host-language `ToString()`/`Inspect`
  // emission, so `derived display` on one has nowhere to go.
  "loom.reserved-derived-on-vo": (p: { name: unknown }) =>
    `Reserved 'derived ${p.name}' is only allowed on aggregates, not value objects.`,

  // ----------------------------------------------------------------------
  // src/language/validators/reserved-type-names.ts
  // ----------------------------------------------------------------------
  "loom.reserved-type-name": (p: { keyword: unknown; name: unknown; binders: unknown }) =>
    `${p.keyword} '${p.name}' is named like a type the generated code binds — ${p.binders} — ` +
    `so the generated project would bind two types to one name and not build. The name is ` +
    `refused on every target so the model stays portable; rename the declaration.`,
  "loom.reserved-type-name#context": (p: { name: unknown; reason: unknown }) =>
    `context '${p.name}' takes a reserved name: ${p.reason}. Rename the context.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/structural-checks.ts
  // ----------------------------------------------------------------------
  "loom.reserved-structural-error-name": (p: { name: unknown }) =>
    `error '${p.name}' collides with a built-in structural-conflict name. ` +
    `That name is reserved: its HTTP status defaults to 409 and a ` +
    `\`httpStatus ${p.name} -> <code>\` line retargets the framework conflict, not ` +
    `just this payload. Rename the error to avoid the shadow.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/reserved-surfaces.ts
  // ----------------------------------------------------------------------
  "loom.reserved-not-emitted": (p: { spelling: unknown; consequence: unknown }) =>
    `\`${p.spelling}\` is not supported: no backend emits it, so the generated output would ` +
    `ignore it and at runtime ${p.consequence}.  Remove the clause.`,
} satisfies Record<string, MessageEntry>;
