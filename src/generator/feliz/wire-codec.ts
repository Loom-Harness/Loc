// Feliz form-cell wire encoders — lift an all-string form cell back to its
// wire value (Thoth `Encode.*`).  This is the CODEC half of a Feliz form:
// which input a field renders and whether it may be absent are read off the
// shared form model in `form-fields.ts`; only the wire value's encoding is
// read off the type here.

import type { TypeIR } from "../../ir/types/loom-ir.js";

/** The scalar base of a type, peeling `optional` — an optional field encodes
 *  as the same wire type as its required twin (optionality only folds the
 *  empty cell to `null`). */
function scalarBase(t: TypeIR): TypeIR {
  return t.kind === "optional" ? t.inner : t;
}

/** The point-free / lambda encoder for ONE array element of scalar type `base`
 *  (already peeled), applied to a trimmed string item. */
function elemEncoderFn(base: TypeIR): string {
  if (base.kind === "primitive") {
    switch (base.name) {
      case "int":
        return "(fun s -> Encode.int (int s))";
      // A `long` element is an int64 on the wire as a JSON NUMBER.  Thoth's
      // `Encode.int64` renders a STRING (`value.ToString(InvariantCulture)`),
      // so the number goes out through `Encode.float`.
      case "long":
        return "(fun s -> Encode.float (float (int64 s)))";
      // RS-12: `money` is a wire STRING (Thoth's `Encode.decimal` is
      // `value.ToString()`), and RS-24: a plain `decimal` is a wire NUMBER.
      // They shared one arm until M-T1.22, so every `decimal` element encoded
      // as a string and the backends answered 422.
      case "money":
        return "(fun s -> Encode.decimal (decimal s))";
      case "decimal":
        return "(fun s -> Encode.float (float s))";
      case "bool":
        return '(fun s -> Encode.bool (s = "true"))';
      default:
        return "Encode.string";
    }
  }
  return "Encode.string"; // id / enum / string
}

/** Thoth encoder expression that lifts a string-typed form field `access`
 *  (`form.price`) back to its wire type.  A scalar-array field splits the
 *  comma-separated string into a JSON array; an `optional` scalar field's empty
 *  string encodes to `Encode.nil` (JSON `null`) — the client omitted it — while a
 *  filled value encodes as its base type; a bool is never wrapped (unchecked is
 *  a legitimate `false`, never absent). */
export function encodeExprFor(t: TypeIR, access: string, optional = false): string {
  const base = scalarBase(t);
  // A `File` form cell is NOT a string — it holds the `FileRef option` the
  // upload returned, so it encodes as the FileRef OBJECT (`fileRefEncoder`) or
  // JSON `null` when nothing has been uploaded yet.  Required-ness is enforced
  // by the submit guard (`Validation`), not by the encoder.
  if (base.kind === "primitive" && base.name === "File") {
    return `(match ${access} with | Some __f -> fileRefEncoder __f | None -> Encode.nil)`;
  }
  // A scalar array → split the comma-separated input, trim/drop blanks, encode
  // each element.  An empty input yields `[]` (never null), so it needs no
  // optional-null wrapping.
  if (base.kind === "array") {
    const elemFn = elemEncoderFn(scalarBase(base.element));
    return `Encode.list (${access}.Split(',') |> Array.toList |> List.map (fun s -> s.Trim()) |> List.filter (fun s -> s <> "") |> List.map ${elemFn})`;
  }
  const encodeBase = (): string => {
    if (base.kind === "primitive") {
      switch (base.name) {
        case "int":
          return `Encode.int (int ${access})`;
        // A `long` is a JSON NUMBER, and Thoth's `Encode.int64` renders a
        // STRING — so the int64 is parsed (keeping the full range on the way
        // in) and encoded through `Encode.float`.
        case "long":
          return `Encode.float (float (int64 ${access}))`;
        // `money` is a wire STRING (RS-12) — Thoth's `Encode.decimal` renders
        // `value.ToString()`.  A plain `decimal` is a wire NUMBER (RS-24), so
        // it goes out through `Encode.float`; sharing the money arm made every
        // decimal request field a string and the backends rejected it (422).
        case "money":
          return `Encode.decimal (decimal ${access})`;
        case "decimal":
          return `Encode.float (float ${access})`;
        case "bool":
          return `Encode.bool (${access} = "true")`;
        default:
          return `Encode.string ${access}`; // string, json, datetime (ISO)
      }
    }
    // id / enum (string name) / everything else → the string verbatim.
    return `Encode.string ${access}`;
  };
  const encoded = encodeBase();
  // A bool always has a value; only text/number optionals fold empty → null.
  if (optional && !(base.kind === "primitive" && base.name === "bool")) {
    return `(if ${access} = "" then Encode.nil else ${encoded})`;
  }
  return encoded;
}
