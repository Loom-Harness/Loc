// TypeIR → Dart type spelling + JSON codec expressions for the Flutter
// frontend.  The Dart analogue of `feliz/type-fs.ts` (which renders F#) and of
// `_frontend/zod-schemas.ts` (which renders the zod wire contract).  The JSON
// codecs dispatch on the shared wire classification (`wireCodecInfo`) through
// per-`WirePrimitive` tables, exactly as the zod and Thoth codecs do, so a Dart
// wire model lines up field-for-field with what the backend actually serves
// and a new wire primitive fails to compile here.
//
// Walking-skeleton scope: scalar + collection + nested-record wire types.  The
// hand-written `fromJson`/`toJson` bodies mean the emitted models need NO
// `json_serializable` / `build_runner` codegen.  Discriminated payload unions
// (`sealed class` + Dart-3 `switch`) are deferred — see
// `// TODO(flutter full-parity):` in `dart-model-emit.ts`.

import type { PrimitiveName, TypeIR } from "../../ir/types/loom-ir.js";
import {
  isCollection,
  peelCollection,
  peelNullable,
  type WirePrimitive,
  wireCodecInfo,
} from "../../ir/types/wire-types.js";

/** Dart type spelling for a primitive wire type. */
function dartPrimitive(name: PrimitiveName): string {
  switch (name) {
    case "int":
    case "long":
      return "int";
    case "decimal":
      return "double";
    case "money":
      // MONEY IS THE WIRE STRING, NOT A NUMBER (M-T1.21).  `money` persists as
      // `NUMERIC(19,4)` and rides the wire as a fixed-scale decimal STRING
      // (`money-scale.ts`, RS-12).  A Dart `double` is a binary float with
      // ~15–17 significant digits, so it cannot hold that range exactly, and
      // every read→write round trip through one re-quantizes the value.  The
      // string IS the value here; `LoomMoney` (`money-runtime.ts`) owns the
      // arithmetic on it, exactly as `decimal.js` does on the JS frontends and
      // `System.Decimal` does on Feliz.  `decimal` (RS-24, a JSON number) is
      // unaffected and stays `double` — the deliberate contrast.
      return "String";
    case "bool":
      return "bool";
    case "datetime":
      return "DateTime";
    case "json":
      // Opaque JSON blob — interior is not modelled, so it stays `dynamic`.
      return "dynamic";
    case "File":
      // The fixed `FileRef` wire object (url/key/contentType/size), always
      // NULLABLE — a `File` holds a FileRef-or-nothing (unset until uploaded),
      // so `File` and `File?` both spell `FileRef?`.  The `FileRef` Dart class is
      // emitted into `lib/models.dart`.
      return "FileRef?";
    default:
      // string, guid → String.
      return "String";
  }
}

/** Non-nullable Dart type spelling for a wire `TypeIR`.  An `optional` inner
 *  layer appends `?`; the caller adds `?` for a wire field whose optionality is
 *  carried by the `WireField.optional` flag rather than an `optional` type. */
/** The Dart spelling of the shared `Provenanced<T>` wire carrier. */
export const DART_PROVENANCED = "Provenanced";

export function dartType(t: TypeIR): string {
  switch (t.kind) {
    case "primitive":
      return dartPrimitive(t.name);
    case "id":
      // Ids ride the wire as plain strings (mirrors `feliz/type-fs.ts`); the
      // skeleton emits no dedicated `<Agg>Id` wrapper class.
      return "String";
    case "enum":
      // Enum values ride the wire as their string name; the skeleton keeps them
      // as `String` rather than emitting a Dart `enum`.
      return "String";
    case "valueobject":
    case "entity":
      return t.name;
    case "array":
      return `List<${dartType(t.element)}>`;
    case "genericInstance":
      // `Provenanced<int>` (M-T6.12) — the value + lineage wire carrier.  An
      // explicit arm, not the `dynamic` fallthrough: a dynamic here would
      // silently drop the value's type out of the model and out of every page
      // that reads it.
      if (t.ctor === "provenanced") return `${DART_PROVENANCED}<${dartType(t.arg)}>`;
      return "dynamic";
    case "optional": {
      // `File` already spells the nullable `FileRef?`, so `File?` must not
      // double-up to `FileRef??`.
      const inner = dartType(t.inner);
      return inner.endsWith("?") ? inner : `${inner}?`;
    }
    default:
      return "dynamic";
  }
}

/** Whether a wire primitive's Dart value IS its JSON value.  `datetime` needs
 *  ISO-string conversion and `File` is the `FileRef` object (`.toJson()` /
 *  `.fromJson`).  `money` rides the wire as a decimal STRING and is a Dart
 *  `String` (M-T1.21), so the value the model holds is already the wire value,
 *  byte for byte, and `toJson` has nothing to convert. */
const DART_IDENTITY_JSON: Record<WirePrimitive, boolean> = {
  string: true,
  int: true,
  long: true,
  decimal: true,
  money: true,
  bool: true,
  date: true,
  datetime: false,
  guid: true,
  json: true,
  File: false,
};

/** Whether a value of type `t` encodes to JSON unchanged (no `.toJson()` /
 *  `.toIso8601String()` / element mapping needed) — lets `dartToJson` emit the
 *  bare field for scalars and null-guard only the transforming cases. */
export function isIdentityJson(t: TypeIR): boolean {
  const base = peelNullable(t);
  if (isCollection(base)) return isIdentityJson(peelCollection(base));
  const info = wireCodecInfo(base, "request");
  if (!info) return false;
  switch (info.refKind) {
    case "primitive":
      return DART_IDENTITY_JSON[info.primitive!];
    case "id":
    case "enum":
      return true;
    case "valueObject":
    case "entity":
    case "provenanced":
      return false;
  }
}

/** Dart decoder per wire primitive, over a `dynamic` JSON value `a`.
 *  - `decimal` rides the wire as a JSON NUMBER (`z.number()` in the shared
 *    frontend contract).
 *  - `money` rides the wire as a decimal STRING at MONEY_WIRE_SCALE digits
 *    (`money-scale.ts`, RS-12), and is TAKEN AS-IS: no parse, so nothing is lost
 *    and nothing can throw on a value wider than a binary float (M-T1.21).
 *    `'${…}'` stringifies rather than casts, so a hand-rolled `extern` endpoint
 *    serving a bare JSON number still decodes instead of crashing.
 *  - `json` is opaque and passes through as `dynamic`. */
const DART_FROM_JSON: Record<WirePrimitive, (a: string) => string> = {
  string: (a) => `${a} as String`,
  int: (a) => `${a} as int`,
  long: (a) => `${a} as int`,
  decimal: (a) => `(${a} as num).toDouble()`,
  money: (a) => `'\${${a}}'`,
  bool: (a) => `${a} as bool`,
  date: (a) => `${a} as String`,
  datetime: (a) => `DateTime.parse(${a} as String)`,
  guid: (a) => `${a} as String`,
  json: (a) => a,
  File: (a) => `FileRef.fromJson(${a} as Map<String, dynamic>)`,
};

/** Dart expression decoding a `dynamic` JSON value `access` into type `t`.
 *  Non-nullable base cases; optionality is layered in the model emitter. */
export function dartFromJson(t: TypeIR, access: string): string {
  const base = peelNullable(t);
  if (isCollection(base)) {
    return `(${access} as List<dynamic>).map((e) => ${dartFromJson(peelCollection(base), "e")}).toList()`;
  }
  const info = wireCodecInfo(base, "response");
  if (!info) return access;
  switch (info.refKind) {
    case "primitive":
      return DART_FROM_JSON[info.primitive!](access);
    case "id":
    case "enum":
      return `${access} as String`;
    case "valueObject":
    case "entity":
      return `${info.base}.fromJson(${access} as Map<String, dynamic>)`;
    case "provenanced":
      // The carrier's `fromJson` takes a decoder for the value half, so the
      // carried type keeps its own conversion (a `datetime` value still
      // parses, a nested VO still builds its class).
      return `${DART_PROVENANCED}.fromJson(${access} as Map<String, dynamic>, (__v) => ${dartFromJson(info.carried!, "__v")})`;
  }
}

/** Dart expression encoding a field value `access` of type `t` back to JSON.
 *  Identity types return the bare value; only `datetime`, `File`, records, and
 *  collections of those transform.  `money` is a Dart `String` holding the
 *  wire's own digits, so it goes back out unchanged — the shape the backend's
 *  request schema validates (`z.string()` over `^-?\d+(\.\d+)?$`). */
export function dartToJson(t: TypeIR, access: string): string {
  const base = peelNullable(t);
  if (isIdentityJson(base)) return access;
  if (isCollection(base)) {
    return `${access}.map((e) => ${dartToJson(peelCollection(base), "e")}).toList()`;
  }
  const info = wireCodecInfo(base, "request");
  if (!info) return access;
  switch (info.refKind) {
    case "primitive":
      return info.primitive === "File" ? `${access}.toJson()` : `${access}.toIso8601String()`;
    case "valueObject":
    case "entity":
      return `${access}.toJson()`;
    // Unreachable (identity), or a response-only carrier: the value as is.
    case "id":
    case "enum":
    case "provenanced":
      return access;
  }
}
