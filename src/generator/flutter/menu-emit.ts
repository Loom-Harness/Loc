// The ui's explicit `menu { section "S" { link Page, link "L" -> "url" } }` —
// `lib/nav_menu.dart`, a row under every page's app bar.
//
// The section/link layout, labels and catalog keys come from the SAME shared
// derivation the JS frontends' sidebars render (`_frontend/menu-emitter.ts`
// `deriveSidebarFromUi`), so a label an author wrote reads identically
// everywhere and its `menu.section.<hash>` / `menu.link.<hash>` key is the one
// the catalog carries.  Under `auth: ui` a link to a page with a `requires` gate
// renders only for a principal the gate admits — the nav mirror of the page's
// own `ForbiddenView`, evaluated by the same `renderFlutterGate`.
//
// A row of links rather than a `Drawer`: a drawer's links are absent from the
// tree until it is opened, and the menu is the app's primary navigation.  An
// external link has no in-app route and the generated app carries no URL
// launcher, so it renders its label with the URL as a tooltip.

import type { PageIR, UiIR } from "../../ir/types/loom-ir.js";
import type { PageNameCtx } from "../../ir/util/page-kind.js";
import { lines } from "../../util/code-builder.js";
import { deriveSidebarFromUi } from "../_frontend/menu-emitter.js";
import { renderFlutterGate } from "./auth-gate.js";
import { dartStringLit } from "./i18n.js";

/** The widget every page's `AppBar(bottom: …)` mounts when the ui has a menu. */
export const FLUTTER_NAV_MENU_WIDGET = "LoomNavMenu";

/** `lib/nav_menu.dart`, or "" when the ui declares no explicit `menu { }`. */
export function renderFlutterNavMenu(
  ui: UiIR | undefined,
  nameCtx: PageNameCtx,
  authUi: boolean,
  i18nEnabled: boolean,
): string {
  if (!ui?.menu) return "";
  const sections = deriveSidebarFromUi(ui, nameCtx) ?? [];
  let usesT = false;
  const text = (label: string, key: string | undefined): string => {
    if (!(i18nEnabled && key)) return dartStringLit(label);
    usesT = true;
    return `t(${dartStringLit(key)}, ${dartStringLit(label)})`;
  };
  const pageAt = (route: string): PageIR | undefined => ui.pages.find((p) => p.route === route);

  let gated = false;
  const children: string[] = [];
  for (const section of sections) {
    if (section.label) {
      children.push(
        `        Padding(padding: const EdgeInsets.symmetric(horizontal: 8), child: Text(${text(section.label, section.labelKey)}, style: Theme.of(context).textTheme.labelSmall)),`,
      );
    }
    for (const entry of section.entries) {
      const label = text(entry.label, entry.labelKey);
      if (entry.external) {
        children.push(
          `        Tooltip(message: ${dartStringLit(entry.href ?? "")}, child: Padding(padding: const EdgeInsets.symmetric(horizontal: 8), child: Text(${label}))),`,
        );
        continue;
      }
      const link = `_navLink(context, ${label}, ${dartStringLit(entry.to)})`;
      const page = pageAt(entry.to);
      if (authUi && page?.requires) {
        gated = true;
        children.push(
          `        if (currentUser != null && (${renderFlutterGate(page.requires, "currentUser")})) ${link},`,
        );
      } else {
        children.push(`        ${link},`);
      }
    }
  }

  return `${lines(
    "// Auto-generated.  Do not edit by hand.",
    "import 'package:flutter/material.dart';",
    gated ? "import 'package:flutter_riverpod/flutter_riverpod.dart';" : undefined,
    "",
    gated ? "import 'auth.dart';" : undefined,
    usesT ? "import 'i18n.dart';" : undefined,
    "",
    "/// The ui's `menu { }`: each section's heading, then its links.  A link to a",
    "/// `requires`-gated page renders only for a principal the gate admits.",
    `class ${FLUTTER_NAV_MENU_WIDGET} extends ${gated ? "ConsumerWidget" : "StatelessWidget"} implements PreferredSizeWidget {`,
    `  const ${FLUTTER_NAV_MENU_WIDGET}({super.key});`,
    "",
    "  @override",
    "  Size get preferredSize => const Size.fromHeight(48);",
    "",
    "  @override",
    `  Widget build(BuildContext context${gated ? ", WidgetRef ref" : ""}) {`,
    gated ? "    final currentUser = ref.watch(sessionProvider).value;" : undefined,
    "    return SingleChildScrollView(",
    "      scrollDirection: Axis.horizontal,",
    "      child: Row(children: <Widget>[",
    ...children,
    "      ]),",
    "    );",
    "  }",
    "}",
    "",
    "/// One in-app link: announced as a link, navigating by the route the",
    "/// `MaterialApp` registers for the page.",
    "Widget _navLink(BuildContext context, String label, String route) => Semantics(",
    "      link: true,",
    "      child: TextButton(onPressed: () => Navigator.of(context).pushNamed(route), child: Text(label)),",
    "    );",
  )}\n`;
}
