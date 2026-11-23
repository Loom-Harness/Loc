// The Dart rendering of the form text-parse rule (`src/ir/plan/form-text.ts`):
// `lib/form_text.dart` in a Flutter app.  A number or money input's validator
// asks `FormText.refusal` and its submit value is `FormText.wire`, both reading
// the grammars, ranges and zeros written here from the plan.

import { FORM_TEXT_KINDS, type FormTextRefusal, formTextRule } from "../../ir/plan/form-text.js";
import { dartString } from "./dart-expr.js";

/** The project path of the module. */
export const FORM_TEXT_DART_PATH = "lib/form_text.dart";

function refusalLiteral(r: FormTextRefusal): string {
  const params = Object.entries(r.params ?? {})
    .map(([k, v]) => `${dartString(k)}: ${v}`)
    .join(", ");
  return `FormTextRefusal(${dartString(r.code)}, ${dartString(r.message)}, <String, Object>{${params}})`;
}

/** `lib/form_text.dart`. */
export function flutterFormTextModule(): string {
  const rules = FORM_TEXT_KINDS.map((k) => {
    const r = formTextRule(k);
    const range = r.range ? `${r.range.min}, ${r.range.max}` : "null, null";
    return `  ${dartString(k)}: _Rule(RegExp(r'${r.grammar}'), ${r.wire === "string"}, ${range}, ${refusalLiteral(r.refusal)}, ${r.rangeRefusal ? refusalLiteral(r.rangeRefusal) : "null"}),`;
  });
  return [
    "// Auto-generated.  Do not edit by hand.",
    "//",
    "// The parse rule of a form's number and money inputs: a blank is the field's",
    "// absence (null when optional, the kind's zero when required); any other text",
    "// must match the kind's grammar and range, or the field shows the refusal and",
    "// the form is not sent.",
    "",
    "/// Why a text is refused: the wire code the server answers for the same value.",
    "class FormTextRefusal {",
    "  const FormTextRefusal(this.code, this.message, this.params);",
    "  final String code;",
    "  final String message;",
    "  final Map<String, Object> params;",
    "}",
    "",
    "class _Rule {",
    "  const _Rule(this.grammar, this.isText, this.min, this.max, this.refusal, this.rangeRefusal);",
    "  final RegExp grammar;",
    "  final bool isText;",
    "  final num? min;",
    "  final num? max;",
    "  final FormTextRefusal refusal;",
    "  final FormTextRefusal? rangeRefusal;",
    "}",
    "",
    "final Map<String, _Rule> _rules = <String, _Rule>{",
    ...rules,
    "};",
    "",
    "class FormText {",
    "  /// The refusal of an input's text, or null when it parses (a blank parses).",
    "  static FormTextRefusal? refusal(String kind, String? text) {",
    "    final r = _rules[kind]!;",
    "    final t = (text ?? '').trim();",
    "    if (t.isEmpty) return null;",
    "    if (!r.grammar.hasMatch(t)) return _refused(r.refusal, t);",
    "    if (r.min != null) {",
    "      final n = num.parse(t);",
    "      if (n < r.min! || n > r.max!) return _refused(r.rangeRefusal ?? r.refusal, t);",
    "    }",
    "    return null;",
    "  }",
    "",
    "  /// A refusal of `text`: the text rides as the `value` its message may name.",
    "  static FormTextRefusal _refused(FormTextRefusal r, String text) =>",
    "      FormTextRefusal(r.code, r.message, <String, Object>{...r.params, 'value': text});",
    "",
    "  /// The input's text as its wire value.  Only called once `refusal` passed.",
    "  static Object? wire(String kind, bool optional, String? text) {",
    "    final r = _rules[kind]!;",
    "    final t = (text ?? '').trim();",
    "    if (t.isEmpty) return optional ? null : (r.isText ? '0' : 0);",
    "    if (r.isText) return t;",
    "    return kind == 'decimal' ? double.parse(t) : int.parse(t);",
    "  }",
    "}",
    "",
  ].join("\n");
}
