// The app's navigation, `lib/nav_menu.dart`: an explicit
// `menu { section "S" { link Page, link "L" -> "url" } }` renders as a row under
// every page's app bar, and a ui with no `menu { }` renders the derived default
// as a navigation drawer every page's app bar opens.
//
// The section/link layout, labels and catalog keys come from the SAME shared
// derivation the JS frontends' sidebars render (`_frontend/menu-emitter.ts`
// `deriveSidebarFromUi`), so a label an author wrote reads identically
// everywhere and its `menu.section.<hash>` / `menu.link.<hash>` key is the one
// the catalog carries.  Under `auth: ui` a link to a page with a `requires` gate
// renders only for a principal the gate admits — the nav mirror of the page's
// own `ForbiddenView`, evaluated by the same `renderFlutterGate`.
//
// The default's links are the ui's routed pages that carry a nav entry — every
// parameterless page not hidden by its `menu { hidden }` metadata (so a
// scaffolded List and Workflow page, but not its New / Detail pages) — grouped
// by the pages' own `menu { section, label }` metadata through the same merge
// the web sidebars use, with the custom pages merged in.  Home is the first
// entry.  An explicit menu keeps the row: the author laid it out as the app's
// primary navigation, and a drawer's links are absent from the tree until it is
// opened.  An external link has no in-app route and the generated app carries no
// URL launcher, so it renders its label with the URL as a tooltip.
//
// Under `auth: ui` either form ends with a Sign out entry, shown while a
// session exists.

import type { PageIR, UiIR } from "../../ir/types/loom-ir.js";
import { type PageNameCtx, pageEmitName } from "../../ir/util/page-kind.js";
import { menuMetaString } from "../../ir/util/page-menu.js";
import { lines } from "../../util/code-builder.js";
import { humanize } from "../../util/naming.js";
import {
  deriveSidebarFromUi,
  isDefaultNavPage,
  type NavEntryVM,
  type NavSectionVM,
} from "../_frontend/menu-emitter.js";
import { sourceText } from "../_i18n/source-text.js";
import { renderFlutterGate } from "./auth-gate.js";
import { dartStringLit } from "./i18n.js";

/** The widget every page's `AppBar(bottom: …)` mounts for an explicit menu. */
const FLUTTER_NAV_MENU_WIDGET = "LoomNavMenu";

/** The widget every page's `Scaffold(drawer: …)` mounts for the derived menu. */
const FLUTTER_NAV_DRAWER_WIDGET = "LoomNavDrawer";

/** How pages mount the navigation: `row` is the explicit `menu { }` under the
 *  app bar, `drawer` the derived default. */
export type FlutterNavKind = "row" | "drawer";

/** The `AppBar(...)` argument that mounts the nav, or "". */
export function navAppBarArg(kind: FlutterNavKind | undefined): string {
  return kind === "row" ? `, bottom: const ${FLUTTER_NAV_MENU_WIDGET}()` : "";
}

/** The `Scaffold(...)` lines that mount the nav. */
export function navScaffoldLines(kind: FlutterNavKind | undefined): string[] {
  return kind === "drawer" ? [`      drawer: const ${FLUTTER_NAV_DRAWER_WIDGET}(),`] : [];
}

/** The default sections handed to `deriveSidebarFromUi`: Home, then one entry per
 *  nav page — each regrouped under its own `menu { section }` by the shared
 *  merge. */
function defaultNavSections(ui: UiIR, nameCtx: PageNameCtx): NavSectionVM[] {
  const entry = (p: PageIR, label: string): NavEntryVM => {
    const to = p.route ?? "";
    return { to, label, testId: `nav-${pageEmitName(p, nameCtx)}`, activeArgs: JSON.stringify(to) };
  };
  const home = ui.pages.find((p) => p.route === "/");
  const entries = [
    ...(home ? [entry(home, "Home")] : []),
    ...ui.pages
      .filter((p) => p.route !== "/" && isDefaultNavPage(p, nameCtx))
      .map((p) => entry(p, menuMetaString(p, "label") ?? humanize(pageEmitName(p, nameCtx)))),
  ];
  return entries.length > 0 ? [{ label: "", entries }] : [];
}

/** The nav `lib/nav_menu.dart` carries for a ui, or undefined when there is none
 *  to render. */
export function renderFlutterNav(
  ui: UiIR | undefined,
  nameCtx: PageNameCtx,
  authUi: boolean,
  i18nEnabled: boolean,
): { kind: FlutterNavKind; source: string } | undefined {
  if (!ui) return undefined;
  const kind: FlutterNavKind = ui.menu ? "row" : "drawer";
  const sections =
    (kind === "row"
      ? deriveSidebarFromUi(ui, nameCtx)
      : deriveSidebarFromUi(ui, nameCtx, authUi, defaultNavSections(ui, nameCtx))) ?? [];
  if (kind === "drawer" && sections.every((s) => s.entries.length === 0)) return undefined;
  const source = renderNavSource(ui, kind, sections, authUi, i18nEnabled);
  return { kind, source };
}

function renderNavSource(
  ui: UiIR,
  kind: FlutterNavKind,
  sections: readonly NavSectionVM[],
  authUi: boolean,
  i18nEnabled: boolean,
): string {
  let usesT = false;
  const text = (label: string, key: string | undefined): string => {
    if (!(i18nEnabled && key)) return dartStringLit(label);
    usesT = true;
    return `t(${dartStringLit(key)}, ${dartStringLit(sourceText(key, label))})`;
  };
  const pageAt = (route: string): PageIR | undefined => ui.pages.find((p) => p.route === route);

  const drawer = kind === "drawer";
  const pad = "        ";
  const textStyle = "style: Theme.of(context).textTheme.labelSmall";
  // Under `auth: ui` the nav watches the session: a Sign out entry shows while
  // one exists, and a link to a `requires`-gated page shows only for a principal
  // the gate admits.
  const children: string[] = [];
  for (const section of sections) {
    if (section.label) {
      const heading = text(section.label, section.labelKey);
      children.push(
        drawer
          ? `${pad}Padding(padding: const EdgeInsets.fromLTRB(16, 16, 16, 4), child: Text(${heading}, ${textStyle})),`
          : `${pad}Padding(padding: const EdgeInsets.symmetric(horizontal: 8), child: Text(${heading}, ${textStyle})),`,
      );
    }
    for (const entry of section.entries) {
      const label = text(entry.label, entry.labelKey);
      if (entry.external) {
        children.push(
          drawer
            ? `${pad}Tooltip(message: ${dartStringLit(entry.href ?? "")}, child: ListTile(title: Text(${label}))),`
            : `${pad}Tooltip(message: ${dartStringLit(entry.href ?? "")}, child: Padding(padding: const EdgeInsets.symmetric(horizontal: 8), child: Text(${label}))),`,
        );
        continue;
      }
      const link = `_navLink(context, ${label}, ${dartStringLit(entry.to)})`;
      const page = pageAt(entry.to);
      if (authUi && page?.requires) {
        children.push(
          `${pad}if (currentUser != null && (${renderFlutterGate(page.requires, "currentUser")})) ${link},`,
        );
      } else {
        children.push(`${pad}${link},`);
      }
    }
  }
  if (authUi) {
    children.push(
      drawer
        ? `${pad}if (currentUser != null) const ListTile(title: Text('Sign out'), onTap: signOut),`
        : `${pad}if (currentUser != null) TextButton(onPressed: signOut, child: const Text('Sign out')),`,
    );
  }

  const widget = drawer ? FLUTTER_NAV_DRAWER_WIDGET : FLUTTER_NAV_MENU_WIDGET;
  const nav = drawer
    ? [
        "/// The ui's navigation drawer: Home, then each section's heading and its links.",
        "/// A link to a `requires`-gated page renders only for a principal the gate",
        "/// admits.",
      ]
    : [
        "/// The ui's `menu { }`: each section's heading, then its links.  A link to a",
        "/// `requires`-gated page renders only for a principal the gate admits.",
      ];
  const body = drawer
    ? [
        "    return Drawer(",
        "      child: ListView(children: <Widget>[",
        ...children,
        "      ]),",
        "    );",
      ]
    : [
        "    return SingleChildScrollView(",
        "      scrollDirection: Axis.horizontal,",
        "      child: Row(children: <Widget>[",
        ...children,
        "      ]),",
        "    );",
      ];
  const linkFn = drawer
    ? [
        "/// One in-app link: a tile that is its own semantics node (wrapping it would",
        "/// merge the drawer's entries into one); it closes the drawer and navigates by",
        "/// the route the `MaterialApp` registers for the page.",
        "Widget _navLink(BuildContext context, String label, String route) => ListTile(",
        "      title: Text(label),",
        "      onTap: () {",
        "        final navigator = Navigator.of(context);",
        "        navigator.pop();",
        "        navigator.pushNamed(route);",
        "      },",
        "    );",
      ]
    : [
        "/// One in-app link: announced as a link, navigating by the route the",
        "/// `MaterialApp` registers for the page.",
        "Widget _navLink(BuildContext context, String label, String route) => Semantics(",
        "      link: true,",
        "      child: TextButton(onPressed: () => Navigator.of(context).pushNamed(route), child: Text(label)),",
        "    );",
      ];

  return `${lines(
    "// Auto-generated.  Do not edit by hand.",
    "import 'package:flutter/material.dart';",
    authUi ? "import 'package:flutter_riverpod/flutter_riverpod.dart';" : undefined,
    "",
    authUi ? "import 'auth.dart';" : undefined,
    usesT ? "import 'i18n.dart';" : undefined,
    "",
    ...nav,
    `class ${widget} extends ${authUi ? "ConsumerWidget" : "StatelessWidget"}${drawer ? "" : " implements PreferredSizeWidget"} {`,
    `  const ${widget}({super.key});`,
    "",
    ...(drawer
      ? []
      : ["  @override", "  Size get preferredSize => const Size.fromHeight(48);", ""]),
    "  @override",
    `  Widget build(BuildContext context${authUi ? ", WidgetRef ref" : ""}) {`,
    authUi ? "    final currentUser = ref.watch(sessionProvider).value;" : undefined,
    ...body,
    "  }",
    "}",
    "",
    ...linkFn,
  )}\n`;
}
