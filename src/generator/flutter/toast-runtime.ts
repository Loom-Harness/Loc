// The out-of-tree toast bridge — `lib/toast.dart`.
//
// The exact twin of `nav-runtime.ts`, for the exact same reason.  `toast(…)` is
// a view effect written in a named page / component `action` (docs/actions.md),
// and on Flutter an action projects into a Riverpod `Notifier` method — which
// is NOT in the widget tree, so it has no `BuildContext`, so
// `ScaffoldMessenger.of(context)` cannot be written there at all.  Before this
// bridge the statement was refused at phase ⑦
// (`loom.flutter-action-body-unsupported#view-effect`) while every other
// frontend rendered it; before THAT it was emitted as a Dart comment, so the
// button was wired and silently did nothing.
//
// The fix is Flutter's own supported answer to "show a snack bar from outside
// the widget tree", and it is the same shape `navigate` already uses: a
// `GlobalKey<ScaffoldMessengerState>` handed to `MaterialApp`, whose
// `currentState` is the live messenger.  `main.dart` installs the key
// (`scaffoldMessengerKey: appScaffoldMessengerKey`) exactly when some emitted
// Dart calls `showToast(`, so an app that never toasts from an action is
// byte-identical to before.
//
// The show is null-safe (`?.`) rather than asserting, for the same reason the
// navigator push is: the only moment `currentState` is null is before the first
// frame, when no action can have run.
//
// NOT the only toast path in an emitted app, and deliberately so.  A realtime
// `on <channel>.<Event>(e) { toast(…) }` handler runs inside `LoomRealtime`, a
// real `ConsumerStatefulWidget` on `MaterialApp.builder`, and keeps its
// in-tree `ScaffoldMessenger.maybeOf(context)` — an in-tree effect should not
// route through a global key just because an out-of-tree one has to.  Both
// reach the same messenger; the difference is only how they find it.

import { lines } from "../../util/code-builder.js";

/** The marker every emitted call to the bridge carries.  Both the per-file
 *  import decision and the "emit `lib/toast.dart` at all" decision sniff for
 *  it — the same use-driven rule `FLUTTER_NAV_MARKER` and the modal / chart /
 *  money runtimes follow, so the file and the imports pointing at it can never
 *  disagree. */
export const FLUTTER_TOAST_MARKER = "showToast(";

/** `lib/toast.dart` — emitted only for a ui that toasts from an action body. */
export function renderFlutterToastRuntime(): string {
  return `${lines(
    "// Auto-generated.  Do not edit by hand.",
    "import 'package:flutter/material.dart';",
    "",
    "/// The app's scaffold messenger, reachable from outside the widget tree.",
    "///",
    "/// Installed on `MaterialApp(scaffoldMessengerKey: appScaffoldMessengerKey)`",
    "/// by `main.dart`.",
    "final GlobalKey<ScaffoldMessengerState> appScaffoldMessengerKey =",
    "    GlobalKey<ScaffoldMessengerState>();",
    "",
    "/// Show a transient message from code that has no `BuildContext` — a",
    "/// Riverpod `Notifier` method (a page `action`, a store action) or a",
    "/// component action.  The argument is `Object?` rather than `String` so the",
    "/// same coercion the other frontends get for free (JS string interpolation)",
    "/// applies here: a `toast(count)` shows the number rather than failing to",
    "/// compile.",
    "void showToast(Object? message) {",
    "  final messenger = appScaffoldMessengerKey.currentState;",
    "  if (messenger == null) return;",
    "  messenger",
    "    ..hideCurrentSnackBar()",
    "    ..showSnackBar(SnackBar(content: Text('$message')));",
    "}",
  )}\n`;
}
