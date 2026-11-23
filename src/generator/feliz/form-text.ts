// The F# rendering of the form text-parse rule (`src/ir/plan/form-text.ts`):
// the `FormText` module of a Feliz app's `App.fs`.  A Feliz form holds every
// cell as text; a number or money cell is refused by `FormText.refusal` (the
// field's inline message and the submit guard) and encoded by
// `FormText.encode`, both reading the grammars, ranges and zeros written here
// from the plan.

import {
  FORM_TEXT_KINDS,
  type FormTextKind,
  type FormTextRefusal,
  formTextRule,
} from "../../ir/plan/form-text.js";
import { fsString } from "./fs-expr.js";

/** A cell's parse rule: `[kind, optional]`, plus `"list"` for a comma-separated
 *  list of numbers. */
export type FelizTextKind =
  | readonly [FormTextKind, boolean]
  | readonly [FormTextKind, boolean, "list"];

/** A rule's static param as F#: a number as a float literal. */
function fsParam(v: number | string): string {
  if (typeof v === "string") return fsString(v);
  return v < 0 ? `(${v}.0)` : `${v}.0`;
}

function refusalLiteral(r: FormTextRefusal): string {
  const params = Object.entries(r.params ?? {})
    .map(([k, v]) => `(${fsString(k)}, box ${fsParam(v)})`)
    .join("; ");
  return `Some (${fsString(r.code)}, ${fsString(r.message)}, [${params ? ` ${params} ` : ""}])`;
}

/** `module FormText`. */
export function felizFormTextModule(): string {
  const rules = FORM_TEXT_KINDS.map((k) => {
    const r = formTextRule(k);
    const range = r.range ? `Some (${r.range.min}.0, ${r.range.max}.0)` : "None";
    return `      (${fsString(k)}, { Grammar = Regex(${fsString(r.grammar)}); IsText = ${r.wire === "string"}; Range = ${range}; Refusal = ${refusalLiteral(r.refusal)}; RangeRefusal = ${r.rangeRefusal ? refusalLiteral(r.rangeRefusal) : "None"} })`;
  });
  return [
    "// The parse rule of a form's number and money cells: a blank is the field's",
    "// absence (null when optional, the kind's zero when required); any other text",
    "// must match the kind's grammar and range, or the field shows the refusal and",
    "// the form is not sent.",
    "module FormText =",
    "  open System.Text.RegularExpressions",
    "",
    "  type private Rule =",
    "    { Grammar: Regex",
    "      IsText: bool",
    "      Range: (float * float) option",
    "      Refusal: (string * string * (string * obj) list) option",
    "      RangeRefusal: (string * string * (string * obj) list) option }",
    "",
    "  let private rules : Map<string, Rule> =",
    "    Map.ofList [",
    ...rules,
    "    ]",
    "",
    "  /// A refusal of `text`: the text rides as the `value` its message may name.",
    "  let private refused (refusal: (string * string * (string * obj) list) option) (text: string) =",
    '    refusal |> Option.map (fun (code, message, ps) -> (code, message, ps @ [ ("value", box text) ]))',
    "",
    "  /// The refusal of a cell's text, or None when it parses (a blank parses).",
    "  let refusal (kind: string) (text: string) : (string * string * (string * obj) list) option =",
    "    let r = rules.[kind]",
    "    let t = text.Trim()",
    '    if t = "" then None',
    "    elif not (r.Grammar.IsMatch t) then refused r.Refusal t",
    "    else",
    "      match r.Range with",
    "      | Some (lo, hi) ->",
    "        let n = float t",
    "        if n < lo || n > hi then refused r.RangeRefusal t else None",
    "      | None -> None",
    "",
    "  /// The refusal of the first item of a comma-separated list that does not parse.",
    "  let refusalList (kind: string) (text: string) : (string * string * (string * obj) list) option =",
    "    text.Split(',') |> Array.map (fun s -> s.Trim()) |> Array.filter (fun s -> s <> \"\") |> Array.tryPick (refusal kind)",
    "",
    "  /// The cell's text as its wire value.  Only called once `refusal` passed.",
    "  let encode (kind: string) (optional: bool) (text: string) : JsonValue =",
    "    let r = rules.[kind]",
    "    let t = text.Trim()",
    '    if t = "" && optional then Encode.nil',
    '    elif r.IsText then Encode.string (if t = "" then "0" else t)',
    '    elif t = "" then Encode.int 0',
    '    elif kind = "int" then Encode.int (int t)',
    "    else Encode.float (float t)",
    "",
    "  /// A comma-separated list of numbers as its wire array.",
    "  let encodeList (kind: string) (text: string) : JsonValue =",
    "    Encode.list (text.Split(',') |> Array.toList |> List.map (fun s -> s.Trim()) |> List.filter (fun s -> s <> \"\") |> List.map (encode kind false))",
  ].join("\n");
}

/** The cell expression encoding a parsed cell. */
export function felizTextEncode(k: FelizTextKind, access: string): string {
  return k[2]
    ? `FormText.encodeList ${fsString(k[0])} ${access}`
    : `FormText.encode ${fsString(k[0])} ${k[1]} ${access}`;
}

/** The expression answering a parsed cell's refusal (an option). */
export function felizTextRefusal(k: FelizTextKind, access: string): string {
  return `FormText.${k[2] ? "refusalList" : "refusal"} ${fsString(k[0])} ${access}`;
}
