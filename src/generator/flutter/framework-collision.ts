// A domain type named like a framework export — `aggregate Provider`.
//
// Every page, form and read file imports both `models.dart` (the domain
// classes) and `package:flutter_riverpod/flutter_riverpod.dart`, and riverpod
// exports a `Provider` class too.  A file that names one of them is then
// `ambiguous_import` and `flutter build` fails.  The generated code never
// references riverpod's BARE `Provider` (it builds `FutureProvider` /
// `StateProvider` / `NotifierProvider`), so the domain class wins by hiding the
// riverpod one on every riverpod import.  Conditional on an actual collision,
// so a model without one is byte-identical.

/** Riverpod exports the generated Dart never references by their bare name. */
import { rewrite } from "../../util/emission-sink.js";

const RIVERPOD_UNREFERENCED: readonly string[] = ["Provider"];

const RIVERPOD_IMPORT = "import 'package:flutter_riverpod/flutter_riverpod.dart';";

/** Hide each riverpod export a `models.dart` class shadows, in every emitted
 *  Dart file.  Mutates `out` in place. */
export function hideShadowedRiverpodNames(out: Map<string, string>): void {
  const models = out.get("lib/models.dart");
  if (!models) return;
  const declared = new Set([...models.matchAll(/^(?:final )?class (\w+)\b/gm)].map((m) => m[1]!));
  const hidden = RIVERPOD_UNREFERENCED.filter((n) => declared.has(n));
  if (hidden.length === 0) return;
  const replacement = `import 'package:flutter_riverpod/flutter_riverpod.dart' hide ${hidden.join(", ")};`;
  for (const [path, content] of out) {
    if (path.endsWith(".dart") && content.includes(RIVERPOD_IMPORT)) {
      rewrite(out, path, content.split(RIVERPOD_IMPORT).join(replacement));
    }
  }
}
