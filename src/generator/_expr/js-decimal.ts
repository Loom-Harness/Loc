// The spelling hook for decimal.js's `Decimal` class in the shared JavaScript
// helpers (`js-intrinsics.ts`, `js-collection-ops.ts`, `zod-refine.ts`).
//
// Those helpers serve two kinds of surface, which bring the class into scope
// differently, so each takes the spelling from its caller rather than writing
// the name itself:
//   - the node backend passes its import symbol (`T.Decimal`,
//     `typescript/ts-symbols.ts`).  The module's finalizer spells it and, in a
//     module that also binds a model type named `Decimal`, imports the library
//     class under an alias — so a model may name a type `Decimal`;
//   - the four JS-embedding frontends pass `FRONTEND_DECIMAL`, the bare name
//     their page shells and stores import by scanning the rendered source
//     (`usesDecimalBinding`).
// `test/system/symbol-plan-census.test.ts` refuses a bare `Decimal` spelling in
// the helpers.

/** The frontends' spelling of decimal.js's `Decimal` class: the bare name. */
export const FRONTEND_DECIMAL = "Decimal";
