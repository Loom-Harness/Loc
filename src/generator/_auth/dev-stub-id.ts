// The dev-stub principal's value for a NON-optional strong-id claim — the ONE
// table every backend's stub verifier reads when the `user { … }` block names
// a generated id class.
//
// WHY THIS EXISTS.  #2869 fixed the OPTIONAL id claim
//
//     user { id: string  role: string  customerId: Customer id? }
//
// in two places: the doubled optional marker (`_type/target.ts`) and the
// missing `ids` import (`./claim-types.ts`).  It left the un-suffixed shape —
// the MORE COMMON spelling, since a customer or tenant claim that is always
// present takes no `?` — because that is a different defect in a different
// place: the dev-stub principal VALUE tables.
//
//     user { id: string  role: string  customerId: Customer id }
//
// An optional claim never reaches the type arm at all (every stub table
// short-circuits `f.optional` to null/None/nil), so the `id` arm of those five
// tables was only ever exercised by this shape — and four of the five wrote a
// RAW SCALAR where the emitted id is a distinct nominal type:
//
//   • node   — `customerId: "00000000-…"` against
//              `type CustomerId = string & { readonly __brand: "CustomerId" }`
//              ⇒ `TS2322: Type 'string' is not assignable to type 'CustomerId'`.
//   • dotnet — `CustomerId: System.Guid.Empty` against
//              `readonly record struct CustomerId(Guid Value)`, which declares
//              no implicit conversion ⇒ **CS0029**.
//   • java   — `null`, which compiles but hands every `currentUser.customerId`
//              read a null strong id where the other four carry the zero id.
//   • elixir — a bare string, which is right by construction (the LiveView
//              principal is an untyped map) but decided independently.
//   • python — `CustomerId("00000000-…")`, the only arm that already
//              constructed through the id factory.
//
// Five tables answering one question drifted five ways; one table with five
// readers cannot (`./dev-claims.ts`, one layer down, makes the same argument
// about the `x-loom-dev-claims` classifier).
//
// The CONSTRUCTION SYNTAX is irreducibly per-language, so it lives here as a
// per-language arm rather than a per-backend copy; the SEED VALUE (the zero
// identity, widened per `IdValueType`) is decided once for all five.
//
// Each backend still owns its own IMPORT of the id class — `Ids` on node,
// `using <ns>.Domain.Ids` on dotnet, `<basePkg>.domain.ids.*` on java — behind
// the same `claimsReferenceIds` gate `./claim-types.ts` already defines.

import type { IdValueType } from "../../ir/types/loom-ir.js";

/** The zero identity a dev-stub principal carries for a guid- or string-valued
 *  strong id.  The same literal every backend already wrote by hand. */
export const DEV_STUB_ID_GUID = "00000000-0000-0000-0000-000000000000";

/** The emitted language an id construction is being rendered into. */
export type DevStubIdLang = "ts" | "csharp" | "python" | "java" | "elixir";

/** The id-typed arm of a dev-stub principal: `<Target>Id` built around the zero
 *  identity, in the target language's construction syntax.
 *
 *  Unqualified on purpose — the caller adds the id class's import, which is the
 *  same gate (`claimsReferenceIds`) the claim's TYPE already goes through. */
export function devStubIdExpr(
  t: { targetName: string; valueType: IdValueType },
  lang: DevStubIdLang,
): string {
  const cls = `${t.targetName}Id`;
  const numeric = t.valueType === "int" || t.valueType === "long";
  switch (lang) {
    // node brands every id as `string & { __brand }` regardless of the id's
    // value type (`typescript/emit/ids.ts`), so the seed is always a string
    // and always goes through the `Ids.<T>Id(...)` factory.
    case "ts":
      return `Ids.${cls}(${numeric ? '"0"' : JSON.stringify(DEV_STUB_ID_GUID)})`;
    // python's ids are `NewType("<T>Id", str)` — same story, same factory.
    case "python":
      return `${cls}(${numeric ? '"0"' : `"${DEV_STUB_ID_GUID}"`})`;
    // Phoenix's principal is a plain map with no id struct to construct; the
    // claim rides as the bare scalar it is serialized as.
    case "elixir":
      return numeric ? "0" : `"${DEV_STUB_ID_GUID}"`;
    case "csharp":
      return `new ${cls}(${csharpSeed(t.valueType)})`;
    // `java.util.UUID` is spelled out rather than imported: the stub's import
    // set is derived from the claim TYPES, and this seed is the only place a
    // UUID appears for an id whose own class already hides it.
    case "java":
      return `new ${cls}(${javaSeed(t.valueType)})`;
    default: {
      const never: never = lang;
      throw new Error(`unhandled dev-stub id language: ${String(never)}`);
    }
  }
}

/** The C# zero for each `IdValueType`, matching `csValueTypeForId`'s mapping
 *  (`guid → Guid`, `int → int`, `long → long`, `string → string`). */
function csharpSeed(valueType: IdValueType): string {
  switch (valueType) {
    case "int":
      return "0";
    case "long":
      return "0L";
    case "string":
      return `"${DEV_STUB_ID_GUID}"`;
    default:
      return "System.Guid.Empty";
  }
}

/** The Java zero for each `IdValueType`, matching `javaValueTypeForId`
 *  (`guid → UUID`, `int → int`, `long → long`, `string → String`). */
function javaSeed(valueType: IdValueType): string {
  switch (valueType) {
    case "int":
      return "0";
    case "long":
      return "0L";
    case "string":
      return `"${DEV_STUB_ID_GUID}"`;
    default:
      return "new java.util.UUID(0L, 0L)";
  }
}
