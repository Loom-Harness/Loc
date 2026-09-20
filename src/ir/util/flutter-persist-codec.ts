// ---------------------------------------------------------------------------
// Flutter store-persistence codecs (`persist: local|session|url`).
//
// A Flutter store is a Riverpod `Notifier<<Store>State>` over an immutable Dart
// data class, so persistence rides that class: `build()` seeds each persisted
// cell from its backing store and a `ref.listenSelf` mirror writes the whole
// state back after every transition.  Both directions cross an UNTYPED boundary
// per FIELD — a `dynamic` out of a decoded JSON blob, or a raw `String` out of
// the query string — so a field type only persists when there is a TOTAL Dart
// conversion for it (one that never throws on junk input, exactly like the JS
// frontends' decoders).  Hence this classifier.
//
// It lives at the IR layer, not in `src/generator/flutter/`, because BOTH sides
// consult it: the emitter picks the codec, and `store-checks.ts` raises
// `loom.store-lifetime-target-unsupported` (its `#flutter-field` variant) for
// the fields that have none — a generator import from the validator would be a
// backward layer edge.  Same home, same reason, as `feliz-persist-codec.ts`.
//
// The supported set mirrors what `generator/flutter/dart-types.ts` spells:
//
//   string / guid / id / enum       → Dart `String`   — the raw value
//   int / long                      → Dart `int`      — `int.tryParse`
//   decimal                         → Dart `double`   — JSON number
//   money                           → Dart `String`   — the wire's own digits,
//                                     a JSON *string* both ways (M-T1.21; the
//                                     JS frontends hold a `Decimal`, whose
//                                     `toJSON` is that same string)
//   bool                            → Dart `bool`
//   datetime                        → Dart `DateTime` — ISO-8601 string, read
//                                     via `DateTime.tryParse`
//   arrays of any of the above      → `List<T>`
//
//   an OPTIONAL of any of the above  -> the same cell, nullable
//   json                             -> Dart `dynamic` -- the value verbatim
//
// The last two were gated until wave C2 and should not have been.  An `optional`
// cell's "no absent-vs-null distinction" is not a LOSS here: the Dart cell is
// `T?`, so absent and null are the same value, which makes the round trip total
// rather than lossy.  And a `json` cell IS json -- storing the decoded value
// back verbatim is the identity conversion, the one case that cannot fail.  The
// JS frontends persist both (Zustand's `createJSONStorage` serialises the whole
// state), so refusing them here was a per-target gap, not a shared limit.
//
// What is STILL gated: `File` (the fixed `FileRef` wire object) and
// `valueobject` / `entity`, which would need a per-record codec the store path
// does not emit -- and `fromJson` on junk throws, so admitting one without a
// try/catch wrapper would break the totality rule this whole module rests on.
// An optional ARRAY and an optional `json` stay gated for the same reason the
// non-optional forms of each are shaped the way they are: one nullable layer
// over a scalar is a cell type, one over a collection is a second emptiness.
// ---------------------------------------------------------------------------

import type { TypeIR } from "../types/loom-ir.js";

/** The scalar codecs a persisted Flutter store field can use. */
export type FlutterPersistScalar =
  /** Dart `String` — the raw value, verbatim. */
  | "string"
  /** Dart `int` — JSON number; `int.tryParse` out of a query param. */
  | "int"
  /** Dart `double` from a JSON NUMBER (Loom `decimal`; the JS frontends hold it
   *  in a plain `number`). */
  | "double"
  /** Dart `String` from a JSON STRING (Loom `money` — the wire's fixed-scale
   *  decimal, held verbatim; the JS frontends hold it in a `Decimal`, whose
   *  `toJSON` is that same string). */
  | "money"
  /** Dart `bool`. */
  | "bool"
  /** Dart `DateTime` — an ISO-8601 string both ways. */
  | "datetime";

/** Where a persisted store keeps its state — the two blob tiers behave
 *  identically here; `url` is the one that constrains the supported set. */
export type FlutterPersistTier = "local" | "session" | "url";

/** How one persisted store field crosses the untyped boundary. */
export type FlutterPersistCodec =
  /** A single cell.  `nullable` makes the Dart cell `T?` and every conversion
   *  null-guarded — an absent key / absent query param restores as `null`,
   *  which for a nullable cell is the RIGHT value rather than a lost one. */
  | { kind: "scalar"; scalar: FlutterPersistScalar; nullable?: true }
  | { kind: "list"; element: FlutterPersistScalar }
  /** A `json` cell — Dart `dynamic`.  Stored and restored VERBATIM in the blob
   *  (the identity conversion), `jsonEncode`/`jsonDecode` in the query string. */
  | { kind: "json" };

function scalarCodec(t: TypeIR): FlutterPersistScalar | undefined {
  // Ids and enums ride the wire (and Dart) as plain strings — `dart-types.ts`.
  if (t.kind === "id" || t.kind === "enum") return "string";
  if (t.kind !== "primitive") return undefined;
  switch (t.name) {
    case "int":
    case "long":
      return "int";
    case "decimal":
      return "double";
    case "money":
      return "money";
    case "bool":
      return "bool";
    case "datetime":
      return "datetime";
    case "json":
    case "File":
      // Reached only for a json/File ELEMENT of an array, or a nested layer —
      // a top-level `json` is intercepted by `flutterPersistCodec` above and
      // rides its own codec kind.  `File` has no scalar form at all (the fixed
      // `FileRef` wire object).
      return undefined;
    default:
      // string / guid — both spell Dart `String`.  (`duration` is
      // expression-only and can never reach a field position.)
      return "string";
  }
}

/** The codec for a persisted Flutter store field, or `undefined` when the type
 *  has none (→ `loom.store-lifetime-target-unsupported#flutter-field`). */
export function flutterPersistCodec(
  t: TypeIR,
  /** Which tier the store persists to.  Only the NULLABLE cell depends on it —
   *  see the `optional` arm below.  Defaults to the blob tier, the permissive
   *  one, so a caller that does not care reads the full supported set. */
  tier: FlutterPersistTier = "local",
): FlutterPersistCodec | undefined {
  if (t.kind === "optional") {
    // One nullable layer over a SCALAR is just a nullable cell.  Over a
    // collection or a `json` it is a second kind of emptiness (an absent list
    // vs an empty one), which the flat blob cannot distinguish — gated.
    //
    // REFUSED at the `url` tier, and the reason is the RESTORE side, not the
    // encode side: `hydrateFromUrl` (the browser back/forward half) re-seeds
    // through `copyWith`, whose `x ?? this.x` parameter shape cannot express
    // "set this cell to null".  So removing the param from the URL and pressing
    // Back would silently KEEP the old value instead of clearing it — a
    // wrong-value bug rather than a missing feature, which is exactly what this
    // classifier exists to prevent.  Widening it means giving `copyWith` a
    // null-distinguishing sentinel, which is a change to the shared state data
    // class every page and component also uses.
    if (tier === "url") return undefined;
    const inner = flutterPersistCodec(t.inner, tier);
    return inner?.kind === "scalar"
      ? { kind: "scalar", scalar: inner.scalar, nullable: true }
      : undefined;
  }
  // `json` is unaffected by the tier: its absent-value fallback is the cell's
  // own declared default, which is never null, so `copyWith` restores it.
  if (t.kind === "primitive" && t.name === "json") return { kind: "json" };
  if (t.kind === "array") {
    const el = scalarCodec(t.element);
    return el === undefined ? undefined : { kind: "list", element: el };
  }
  const s = scalarCodec(t);
  return s === undefined ? undefined : { kind: "scalar", scalar: s };
}
