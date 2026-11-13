// Feliz wire codecs — the F# spelling, Thoth decoder and Thoth encoder of a
// wire value.
//
// The wire classification is the shared one every frontend reads
// (`wireCodecInfo`, `src/ir/types/wire-types.ts`): the JS frontends render it
// as zod, Flutter as Dart `fromJson`/`toJson`, and this module as Thoth.  Each
// codec dispatches on its `refKind` and reads a per-primitive table keyed by
// `WirePrimitive`, so a new wire kind or primitive fails to compile here
// instead of falling through to a string.  A type with no wire codec (a union,
// `none`) keeps its opaque spelling.
//
// The form half — which input a field renders and whether it may be absent —
// is read off the shared form model in `form-fields.ts`; a form cell reaches
// this module only to be lifted from its string back to its wire value.

import type { TypeIR } from "../../ir/types/loom-ir.js";
import {
  isCollection,
  isNullable,
  peelCollection,
  peelNullable,
  type WirePrimitive,
  wireCodecInfo,
} from "../../ir/types/wire-types.js";
import { lowerFirst } from "../../util/naming.js";
import { fsIdent } from "./fs-ident.js";
import { typeToFs } from "./type-fs.js";

/** The Feliz spelling of the shared wire carrier + its Thoth decoder factory. */
export const FS_PROVENANCED = "Provenanced";
export const FS_PROVENANCED_DECODER = "provenancedDecoder";

/** Guard the wire path against a `duration`-typed field.
 *
 *  `typeToFs` spells a duration `System.TimeSpan` (the type `FS_LEAVES.duration`
 *  builds and the temporal binary arms consume), but Thoth ships no
 *  `Decode.timespan` and no backend puts a duration on the wire: `duration` is
 *  EXPRESSION-ONLY, with no spelling in the grammar's `PrimitiveType` rule, so
 *  `wireShape` (built from declared types alone) can never carry one.  Rather
 *  than let the record field say `System.TimeSpan` while its decoder is a
 *  string — a Fable type error in the emitted `App.fs` — the pair fails loudly
 *  at GENERATE time.  Same stance the node backend takes for its column mapper
 *  (`typescript/emit/schema.ts`).  Delete this guard only together with a real
 *  wire representation + matching decoder/encoder arms. */
function assertNotDurationWireField(t: TypeIR): void {
  if (t.kind === "primitive" && t.name === "duration") {
    throw new Error("internal: 'duration' is expression-only and never reaches a wire field");
  }
}

/** Thoth decoder per wire primitive.  `date` is the wire's `YYYY-MM-DD` string;
 *  a `long` goes through `Decode.int64`, because `Decode.int` bounds-checks
 *  against int32 and fails the WHOLE record decode past it. */
const FS_DECODER: Record<WirePrimitive, string> = {
  string: "Decode.string",
  int: "Decode.int",
  long: "Decode.int64",
  decimal: "Decode.decimal",
  money: "Decode.decimal",
  bool: "Decode.bool",
  date: "Decode.string",
  datetime: "Decode.datetimeUtc",
  guid: "Decode.string",
  json: "Decode.string",
  File: "fileRefDecoder", // the fixed FileRef record (renderFileRefType)
};

/** F# type spelling of a wire field's declared type.  An enum value arrives as
 *  its string name, so it is a plain `string`; a `File` is the fixed `FileRef`
 *  record (`renderFileRefType`), decoded via `fileRefDecoder`. */
export function wireFieldType(t: TypeIR): string {
  assertNotDurationWireField(t);
  if (isNullable(t)) return `${wireFieldType(peelNullable(t))} option`;
  if (isCollection(t)) return `${wireFieldType(peelCollection(t))} list`;
  const info = wireCodecInfo(t, "response");
  if (!info) return typeToFs(t);
  switch (info.refKind) {
    case "primitive":
      return info.primitive === "File" ? "FileRef" : typeToFs(t);
    case "id":
    case "enum":
      return "string";
    case "valueObject":
    case "entity":
      return info.base;
    case "provenanced":
      return `${FS_PROVENANCED}<${wireFieldType(info.carried!)}>`;
  }
}

/** Thoth decoder expression for a wire field's declared type.  An `optional`
 *  decodes as its inner type: the field reads it through `get.Optional`. */
export function decoderExprFor(t: TypeIR): string {
  assertNotDurationWireField(t);
  if (isNullable(t)) return decoderExprFor(peelNullable(t));
  if (isCollection(t)) return `(Decode.list ${decoderExprFor(peelCollection(t))})`;
  const info = wireCodecInfo(t, "response");
  if (!info) return "Decode.string";
  switch (info.refKind) {
    case "primitive":
      return FS_DECODER[info.primitive!];
    // The wire carries an id and an enum value as a string.
    case "id":
    case "enum":
      return "Decode.string";
    case "valueObject":
    case "entity":
      return `Decoders.${fsIdent(lowerFirst(info.base))}`;
    case "provenanced":
      return `(${FS_PROVENANCED_DECODER} ${decoderExprFor(info.carried!)})`;
  }
}

/** Thoth encoder function per wire primitive for an already-typed op-param
 *  value (`wireFieldType` spelling).  A `long` / `decimal` is a JSON NUMBER:
 *  Thoth's `Encode.int64` / `Encode.decimal` render strings, so both widen
 *  through `Encode.float`; `money` is a wire STRING (RS-12), which is exactly
 *  what `Encode.decimal` renders. */
const FS_PARAM_ENCODER: Record<WirePrimitive, string> = {
  string: "Encode.string",
  int: "Encode.int",
  long: "(fun (v: int64) -> Encode.float (float v))",
  decimal: "(fun (v: decimal) -> Encode.float (float v))",
  money: "Encode.decimal",
  bool: "Encode.bool",
  date: "Encode.string",
  datetime: "Encode.string",
  guid: "Encode.string",
  json: "Encode.string",
  File: "Encode.string",
};

/** Thoth encoder function for a scalar op-param type (peeling `optional`).  A
 *  non-scalar param falls back to `Encode.string`, which fails loud at the
 *  Fable compile (a type mismatch) rather than silently mis-encoding. */
export function paramEncoder(t: TypeIR): string {
  const info = wireCodecInfo(peelNullable(t), "request");
  if (!info || info.isCollection || info.refKind !== "primitive") return "Encode.string";
  return FS_PARAM_ENCODER[info.primitive!];
}

/** Encoder per wire primitive for a form CELL — a string `s` the encoder
 *  parses back to the wire value.  `long` / `decimal` are JSON numbers (through
 *  `Encode.float`, as above); `money` is a wire string (`Encode.decimal`); a
 *  `datetime` cell already holds the ISO text. */
const FS_CELL_ENCODER: Record<WirePrimitive, (s: string) => string> = {
  string: (s) => `Encode.string ${s}`,
  int: (s) => `Encode.int (int ${s})`,
  long: (s) => `Encode.float (float (int64 ${s}))`,
  decimal: (s) => `Encode.float (float ${s})`,
  money: (s) => `Encode.decimal (decimal ${s})`,
  bool: (s) => `Encode.bool (${s} = "true")`,
  date: (s) => `Encode.string ${s}`,
  datetime: (s) => `Encode.string ${s}`,
  guid: (s) => `Encode.string ${s}`,
  json: (s) => `Encode.string ${s}`,
  // A collection's `File` element stays the cell's text (no per-item upload).
  File: (s) => `Encode.string ${s}`,
};

/** The point-free / lambda encoder for ONE collection element, applied to a
 *  trimmed string item.  A string-shaped element is point-free. */
function elemEncoderFn(element: TypeIR): string {
  const info = wireCodecInfo(peelNullable(element), "request");
  if (!info || info.isCollection || info.refKind !== "primitive") return "Encode.string";
  const encoded = FS_CELL_ENCODER[info.primitive!]("s");
  return encoded === "Encode.string s" ? "Encode.string" : `(fun s -> ${encoded})`;
}

/** Thoth encoder expression that lifts a string-typed form cell `access`
 *  (`form.price`) back to its wire type.  A collection cell splits the
 *  comma-separated string into a JSON array; an `optional` cell's empty string
 *  encodes to `Encode.nil` (JSON `null`) — the client omitted it — while a
 *  filled value encodes as its base type; a bool is never wrapped (unchecked is
 *  a legitimate `false`, never absent). */
export function encodeExprFor(t: TypeIR, access: string, optional = false): string {
  const base = peelNullable(t);
  const info = wireCodecInfo(base, "request");
  // A `File` form cell is NOT a string — it holds the `FileRef option` the
  // upload returned, so it encodes as the FileRef OBJECT (`fileRefEncoder`) or
  // JSON `null` when nothing has been uploaded yet.  Required-ness is enforced
  // by the submit guard (`Validation`), not by the encoder.
  if (info && !info.isCollection && info.primitive === "File") {
    return `(match ${access} with | Some __f -> fileRefEncoder __f | None -> Encode.nil)`;
  }
  // A collection → split the comma-separated input, trim/drop blanks, encode
  // each element.  An empty input yields `[]` (never null), so it needs no
  // optional-null wrapping.
  if (isCollection(base)) {
    const elemFn = elemEncoderFn(peelCollection(base));
    return `Encode.list (${access}.Split(',') |> Array.toList |> List.map (fun s -> s.Trim()) |> List.filter (fun s -> s <> "") |> List.map ${elemFn})`;
  }
  // An id / enum / record cell is its string verbatim.
  const primitive = info?.refKind === "primitive" ? info.primitive! : "string";
  const encoded = FS_CELL_ENCODER[primitive](access);
  // A bool always has a value; only text/number optionals fold empty → null.
  if (optional && primitive !== "bool") {
    return `(if ${access} = "" then Encode.nil else ${encoded})`;
  }
  return encoded;
}
