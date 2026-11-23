// The Flutter `Apps` widget — the gateway's apps, fetched at run time (see
// `react/apps.ts` for why the list is fetched, not generated).  Each app loads
// in place through `url_launcher`, since it is another app on this origin.
// It shows each app's label in the active locale when the app ships i18n, and
// the source-language label otherwise.  Emitted to `lib/apps.dart` when a page
// renders `Apps {}`.

import { GATEWAY_APPS_PATH } from "../../util/api-base.js";
import { lines } from "../../util/code-builder.js";

export const FLUTTER_APPS_PATH = "lib/apps.dart";

/** Whether Dart text builds the `Apps` widget, so its file needs the import. */
export function usesApps(dart: string): boolean {
  return /(?<![A-Za-z0-9_$.])Apps\(\)/.test(dart);
}

export function renderFlutterApps(i18nEnabled: boolean): string {
  return `${lines(
    "// Auto-generated.  Do not edit by hand.",
    "import 'dart:convert';",
    "",
    "import 'package:flutter/material.dart';",
    "import 'package:http/http.dart' as http;",
    "import 'package:url_launcher/url_launcher.dart';",
    i18nEnabled ? "\nimport 'i18n.dart';" : undefined,
    "",
    "/// The apps the gateway in front of this app serves, one link each.",
    "/// Renders nothing outside a gateway.",
    "class Apps extends StatefulWidget {",
    "  const Apps({super.key});",
    "",
    "  @override",
    "  State<Apps> createState() => _AppsState();",
    "}",
    "",
    "class _AppsState extends State<Apps> {",
    "  List<Map<String, dynamic>> _apps = const [];",
    "",
    "  @override",
    "  void initState() {",
    "    super.initState();",
    "    _load();",
    "  }",
    "",
    "  Future<void> _load() async {",
    "    try {",
    `      final res = await http.get(Uri.base.resolve(${JSON.stringify(GATEWAY_APPS_PATH).replace(/"/g, "'")}));`,
    "      if (res.statusCode != 200) return;",
    "      final list = jsonDecode(res.body);",
    "      if (list is List && mounted) {",
    "        setState(() => _apps = list.whereType<Map<String, dynamic>>().toList());",
    "      }",
    "    } catch (_) {",
    "      // Outside a gateway there is no list: render nothing.",
    "    }",
    "  }",
    "",
    "  String _labelOf(Map<String, dynamic> a) {",
    i18nEnabled
      ? lines(
          "    final labels = a['labels'];",
          "    if (labels is Map) {",
          "      final lang = activeLocale();",
          "      final l = labels[lang] ?? labels[lang.split('-').first];",
          "      if (l is String) return l;",
          "    }",
        )
      : undefined,
    "    return a['label'] as String;",
    "  }",
    "",
    "  @override",
    "  Widget build(BuildContext context) {",
    "    if (_apps.isEmpty) return const SizedBox.shrink();",
    "    return Semantics(",
    "      container: true,",
    `      label: ${i18nEnabled ? "t('chrome.apps', 'Apps')" : "'Apps'"},`,
    "      child: Wrap(spacing: 8, children: <Widget>[",
    "        for (final a in _apps)",
    "          TextButton(",
    "            onPressed: () => launchUrl(",
    "              Uri.base.resolve(a['path'] as String),",
    "              webOnlyWindowName: '_self',",
    "            ),",
    "            child: Text(_labelOf(a)),",
    "          ),",
    "      ]),",
    "    );",
    "  }",
    "}",
  )}\n`;
}
