// The value-object equality runtime for the Flutter frontend —
// `lib/value_equals.dart`.
//
// A value object compares by VALUE.  The generated Dart wire models
// (`dart-model-emit.ts`) are plain classes with no `operator ==`, so Dart's
// `==` on two of them is `identical` — two parcels shipped to the same address
// compare unequal.  A page-body `==` / `!=` between value objects therefore
// renders `loomValueEquals(a, b)` (`flutter-target.ts`), and this helper
// compares the models' JSON encodings: every model's `toJson()` writes its
// fields in declaration order, nested models and lists included, so two values
// of one type encode identically exactly when their fields agree.  Money rides
// as the wire's fixed-scale string on this target (a money literal is padded
// to the same scale — `dartMoneyLiteral`), so equal amounts encode equally.
//
// Emitted ON DEMAND, like `lib/money.dart`: `index.ts` scans every rendered file
// for the call and emits both the file and the matching per-file import.

import { lines } from "../../util/code-builder.js";

/** `lib/value_equals.dart` — emitted only for a ui whose Dart calls it. */
export function renderFlutterValueEqualsRuntime(): string {
  return `${lines(
    "// Auto-generated.  Do not edit by hand.",
    "",
    "import 'dart:convert';",
    "",
    "/// Loom value equality — value objects compare by their fields, not by",
    "/// identity.  The generated models encode their fields in declaration",
    "/// order, so equal values have equal JSON encodings.",
    "bool loomValueEquals(Object? a, Object? b) =>",
    "    identical(a, b) || jsonEncode(a) == jsonEncode(b);",
  )}\n`;
}
