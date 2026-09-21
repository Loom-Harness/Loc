// ---------------------------------------------------------------------------
// Feliz store-persistence codecs (`persist: local|session|url`).
//
// Feliz stores fold into the single Elmish `Model`, so persistence rides the
// fold: `init` seeds each persisted field from its backing store and the
// `update` loop mirrors the Model back.  Crossing the JS boundary is per FIELD
// (a raw `string` out of `localStorage`/`sessionStorage`/the query string, then
// an F# conversion), so a field type only persists when there IS an F# codec
// for it — hence this classifier.
//
// It lives at the IR layer, not in `src/generator/feliz/`, because BOTH sides
// consult it: the emitter picks the codec, and `store-checks.ts` raises
// `loom.store-lifetime-target-unsupported` (its `#field` variant) for the
// fields that have none (a generator import from the validator would be a
// backward layer edge).  Same home, same reason, as `feliz-async-effect.ts`.
//
// The supported set is bounded by what `type-fs.ts` spells and what the F#
// conversion path can do TOTALLY (never throwing on junk input, exactly like
// the JS frontends' decoders):
//
//   string / json / id / enum → F# `string`          — the raw value, verbatim
//   int                       → F# `int`             — `System.Int32.TryParse`
//   long                      → F# `int64`           — `System.Int64.TryParse`
//   bool                      → F# `bool`            — `= "true"`
//   decimal / money           → F# `decimal`         — `System.Decimal.TryParse`
//   datetime                  → F# `System.DateTime` — `System.DateTime.TryParse`,
//                               written back as the ISO-8601 `ToString("o")`
//                               the Feliz query-param encoder already emits
//   guid                      → F# `System.Guid`     — `System.Guid.TryParse`,
//                               written back as its canonical string
//   arrays of any of the above → F# `'T list`
//
// Everything still gated: `File` (the Model cell is a `FileRef option`, not a
// scalar) and `entity`/`valueobject` (and arrays of them), which would need a
// record codec the store path does not emit.  `duration` is expression-only —
// it has no spelling in the grammar's `PrimitiveType` rule, so it can never
// reach a `state {}` field position at all (`flutter-persist-codec.ts` records
// the same fact).
//
// ONE honest asymmetry against the JS builders, written down rather than
// discovered: a `datetime` / `guid` cell at its ZERO writes its .NET zero
// (`0001-01-01T00:00:00.0000000` / the all-zeroes guid) where the JS side,
// which holds both as `string`, would hold `""` and DROP the query param.
// Both directions still decode on both sides; only the empty-cell spelling
// differs.
// ---------------------------------------------------------------------------

import type { TypeIR } from "../types/loom-ir.js";

/** The scalar codecs a persisted Feliz store field can use. */
export type FelizPersistScalar =
  | "string"
  /** F# `int` — `System.Int32.TryParse`, JSON number. */
  | "int"
  /** F# `int64` — `System.Int64.TryParse`, JSON number.  Distinct from `int`
   *  since M-T1.22: `type-fs.ts` spells a Loom `long` `int64`, so an `int`
   *  codec would both truncate the value and fail to typecheck against the
   *  Model field. */
  | "long"
  /** F# `bool` — `"true"`, JSON boolean. */
  | "bool"
  /** F# `decimal` serialised as a JSON NUMBER (Loom `decimal`; the JS
   *  frontends hold it in a plain `number`). */
  | "decimal"
  /** F# `decimal` serialised as a JSON STRING (Loom `money`; the JS frontends
   *  hold it in a `Decimal` whose `toJSON` is a string). */
  | "money"
  /** F# `System.DateTime` — `System.DateTime.TryParse` in, `ToString("o")`
   *  (ISO-8601) out, the same spelling `wire.ts`'s query-param encoder uses. */
  | "datetime"
  /** F# `System.Guid` — `System.Guid.TryParse` in, the canonical lowercase
   *  string out. */
  | "guid";

/** How one persisted store field crosses the JS boundary. */
export type FelizPersistCodec =
  | { kind: "scalar"; scalar: FelizPersistScalar }
  /** An F# `'T list` over a scalar element — every scalar codec has a total
   *  per-CELL conversion, so the element set is the scalar set. */
  | { kind: "list"; element: FelizPersistScalar };

function scalarCodec(t: TypeIR): FelizPersistScalar | undefined {
  // Ids and enums ride the wire — and F# (`type-fs.ts` `typeToFs`) — as plain
  // strings, so the raw slot value IS the cell.
  if (t.kind === "id" || t.kind === "enum") return "string";
  if (t.kind !== "primitive") return undefined;
  switch (t.name) {
    case "int":
      return "int";
    case "long":
      return "long";
    case "bool":
      return "bool";
    case "decimal":
      return "decimal";
    case "money":
      return "money";
    case "string":
    case "json":
      return "string";
    case "datetime":
      return "datetime";
    case "guid":
      return "guid";
    default:
      // `File` — the Model cell is a `FileRef option` record, not a scalar.
      // (`duration` is expression-only and can never reach a field position.)
      return undefined;
  }
}

/** The codec for a persisted Feliz store field, or `undefined` when the type
 *  has none (→ `loom.store-lifetime-target-unsupported`, `#field` variant). */
export function felizPersistCodec(t: TypeIR): FelizPersistCodec | undefined {
  if (t.kind === "array") {
    const el = scalarCodec(t.element);
    if (el === undefined) return undefined;
    return { kind: "list", element: el };
  }
  const s = scalarCodec(t);
  return s === undefined ? undefined : { kind: "scalar", scalar: s };
}
