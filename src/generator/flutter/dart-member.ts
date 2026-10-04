// ---------------------------------------------------------------------------
// Dart identifier spelling for names DERIVED from user model names.
//
// A wire field is emitted as a Dart member of the model class (`final int
// default;`) and read as `row.default` — and `default`, `enum`, `extends`,
// `class`, `switch`, … are RESERVED words in Dart, illegal as any identifier
// (unlike Dart's *built-in* identifiers — `abstract`, `static`, `import`,
// `extern`-likes — which are legal member names and need nothing).  Loom admits
// many of them as field names (`default` was never a Loom keyword; others are
// soft since #3063), so a model that validates `0 error(s)` produced a Flutter
// app `flutter analyze` rejected with `expected_identifier_but_got_keyword`.
//
// Dart has no escaping syntax (no F# double-backtick, no C# `@`), so the Dart
// MEMBER takes a trailing underscore (`default_`) — the conventional spelling
// (openapi-generator's Dart target, protobuf's `default_N`).  The WIRE key is
// unchanged: `fromJson`/`toJson` still read and write `'default'`, so the JSON
// contract every other target speaks is untouched.
//
// The set is Dart's reserved-word list (Dart language spec §21.1.1, "reserved
// words").  (`package-name.ts` keeps its own, wider list: a pubspec `name:` also
// rejects some built-in identifiers.)
// ---------------------------------------------------------------------------

/** Dart's reserved words — never legal as an identifier of any kind. */
export const DART_RESERVED_WORDS: ReadonlySet<string> = new Set([
  "assert",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "do",
  "else",
  "enum",
  "extends",
  "false",
  "final",
  "finally",
  "for",
  "if",
  "in",
  "is",
  "new",
  "null",
  "rethrow",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "var",
  "void",
  "while",
  "with",
]);

/** The members every Dart class inherits from `Object` that a same-named FIELD
 *  cannot coexist with: `toString`/`noSuchMethod` are METHODS (a field of that
 *  name is `conflicting_field_and_method`), `runtimeType` is a `Type` getter (a
 *  `String` field is an `invalid_override`), and `hashCode` is an `int` getter
 *  (an `int` field type-checks but silently replaces the object's hash — and any
 *  other type is an `invalid_override`).  All four are legal Loom field names. */
export const DART_OBJECT_MEMBERS: ReadonlySet<string> = new Set([
  "hashCode",
  "noSuchMethod",
  "runtimeType",
  "toString",
]);

/** `name` as a Dart identifier derived from a user model name — a wire field, a
 *  state cell, a component/page param, a `let` binding, a lambda / match-arm
 *  binder.  A reserved word or an `Object` member takes a trailing underscore
 *  (`default` → `default_`, `toString` → `toString_`); every other name is
 *  returned unchanged, so a model without such a name emits byte-identical
 *  Dart.  ONE spelling for declaration and use alike: every site that declares
 *  the name and every site that reads it goes through here, so the two cannot
 *  disagree.  (An `Object`-member name is harmless as a plain local, but
 *  spelling it the same everywhere is what keeps a component param — a widget
 *  FIELD and a `State` getter — and its body reads in step.) */
export function dartMember(name: string): string {
  return DART_RESERVED_WORDS.has(name) || DART_OBJECT_MEMBERS.has(name) ? `${name}_` : name;
}
