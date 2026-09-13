// The out-of-tree navigation bridge — `lib/nav.dart`.
//
// `navigate(<Page>)` is the documented home for navigation (docs/actions.md
// §navigate; the lambda form is refused by `loom.effect-in-lambda`), and the
// place it is written is a named page `action` — which on Flutter is projected
// into a Riverpod `Notifier` method.  That is the problem this file solves: a
// Notifier is NOT in the widget tree, so it has no `BuildContext`, and
// `Navigator.of(context)` / `Navigator.pushNamed(context, …)` — the form the
// view seam emits — cannot be written there at all.  Before this bridge the
// statement was dropped as a Dart comment while every other frontend navigated
// (ledger row `F2-CFE-1`).
//
// The fix is Flutter's own supported answer to "navigate from outside the
// widget tree": a `GlobalKey<NavigatorState>` handed to `MaterialApp`, whose
// `currentState` is the live navigator. `main.dart` installs the key
// (`navigatorKey: appNavigatorKey`) exactly when some emitted Dart calls
// `navigateTo(`, so an app that never navigates from an action is byte-identical
// to before.
//
// The push is null-safe (`?.`) rather than asserting: the only moment
// `currentState` is null is before the first frame, when no action can have run.

import { lines } from "../../util/code-builder.js";

/** The marker every emitted call to the bridge carries.  Both the per-file
 *  import decision and the "emit `lib/nav.dart` at all" decision sniff for it,
 *  the same use-driven rule the modal / chart / money runtimes follow — so the
 *  file and the imports pointing at it can never disagree. */
export const FLUTTER_NAV_MARKER = "navigateTo(";

/** `lib/nav.dart` — emitted only for a ui that navigates from an action body. */
export function renderFlutterNavRuntime(): string {
  return `${lines(
    "// Auto-generated.  Do not edit by hand.",
    "import 'package:flutter/material.dart';",
    "",
    "/// The app's navigator, reachable from outside the widget tree.",
    "///",
    "/// Installed on `MaterialApp(navigatorKey: appNavigatorKey)` by `main.dart`.",
    "final GlobalKey<NavigatorState> appNavigatorKey = GlobalKey<NavigatorState>();",
    "",
    "/// Push a named route from code that has no `BuildContext` — a Riverpod",
    "/// `Notifier` method (a page `action`, a store action) or a component",
    "/// action.  The route names are the same keys `MaterialApp.routes` /",
    "/// `onGenerateRoute` serve, so this and the in-tree",
    "/// `Navigator.pushNamed(context, …)` reach the same pages.",
    "void navigateTo(String route, {Object? arguments}) {",
    "  appNavigatorKey.currentState?.pushNamed(route, arguments: arguments);",
    "}",
  )}\n`;
}
