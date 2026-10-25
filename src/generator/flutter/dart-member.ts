import { escapeTargetIdent, escapeTargetMember } from "../../util/target-identifiers.js";

// ---------------------------------------------------------------------------
// Dart identifier spelling for names DERIVED from user model names.
//
// A wire field is emitted as a Dart member of the model class (`final int
// default;`) and read as `row.default` — and `default`, `enum`, `extends`,
// `class`, `switch`, … are RESERVED words in Dart, illegal as any identifier
// (unlike Dart's *built-in* identifiers — `abstract`, `static`, `import`,
// `extern`-likes — which are legal member names and need nothing).  Loom admits
// many of them as field names, and an unescaped one is a Flutter app
// `flutter analyze` rejects with `expected_identifier_but_got_keyword`.
//
// Dart has no escaping syntax (no F# double-backtick, no C# `@`), so the Dart
// MEMBER takes a trailing underscore (`default_`) — the conventional spelling
// (openapi-generator's Dart target, protobuf's `default_N`).  The WIRE key is
// unchanged: `fromJson`/`toJson` still read and write `'default'`, so the JSON
// contract every other target speaks is untouched.
//
// The reserved words and the inherited `Object` members (`toString`,
// `hashCode`, …) live in the shared table, `src/util/target-identifiers.ts`.
// (`package-name.ts` keeps its own, wider list: a pubspec `name:` also rejects
// some built-in identifiers.)
// ---------------------------------------------------------------------------

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
  const member = escapeTargetMember("dart", name);
  return member !== name ? member : escapeTargetIdent("dart", name);
}

/** Members a generated COMPONENT widget class — or its `State` — already
 *  declares or inherits, which a same-named component param (a widget FIELD and
 *  a `State` getter) cannot coexist with.  `key` is `Widget.key` (`Key?`) and
 *  is a `super.key` ctor param besides; `build`/`createState`/`createElement`
 *  are the widget's own methods; `widget`/`context`/`mounted`/`setState`/
 *  `initState`/`dispose`/… are `State` members (overriding `context` with an
 *  `int` getter is an `invalid_override`, a `setState` getter a
 *  `conflicting_field_and_method`); `state` is the generated model field, `ref`
 *  the `ConsumerWidget.build` parameter and `context` the `build` parameter
 *  (either would SHADOW the param inside `build` — a silent wrong read), and
 *  `child` the generated `Slot { }` param.  All are legal Loom param names. */
const FLUTTER_COMPONENT_MEMBERS: ReadonlySet<string> = new Set([
  "activate",
  "build",
  "child",
  "context",
  "createElement",
  "createState",
  "deactivate",
  "debugDescribeChildren",
  "debugFillProperties",
  "didChangeDependencies",
  "didUpdateWidget",
  "dispose",
  "initState",
  "key",
  "mounted",
  "reassemble",
  "ref",
  "setState",
  "state",
  "toDiagnosticsNode",
  "toStringDeep",
  "toStringShallow",
  "toStringShort",
  "widget",
]);

/** `name` as a Dart identifier INSIDE a generated component widget / `State`
 *  class — `dartMember`, plus the trailing underscore for a name that collides
 *  with a Flutter widget/`State` member (`FLUTTER_COMPONENT_MEMBERS`).  Every
 *  component-scoped declaration (param field / ctor / getter, action method,
 *  `let`, binder) and every use — including the CALL SITE's named argument in
 *  the caller's widget tree — spells through here, so they cannot disagree.
 *  Any other name is `dartMember(name)` unchanged (byte-identical). */
export function dartComponentMember(name: string): string {
  return FLUTTER_COMPONENT_MEMBERS.has(name) ? `${name}_` : dartMember(name);
}
