// What every JavaScript frontend's `Apps` component knows about the gateway's
// list of apps (`GATEWAY_APPS_PATH`): an entry's shape, and which label it
// shows.  The list carries each app's source-language label and, per locale a
// translation exists for, its translated label; the component shows the one for
// the page's language, which the i18n runtime keeps on `<html lang>`, by exact
// tag and then by its primary language, and the source label otherwise.

/** The entry type and `labelOf`, as TypeScript, each line indented by `indent`. */
export function gatewayAppTs(indent = ""): string {
  return [
    "/** One app the gateway serves on this origin. */",
    "interface GatewayApp {",
    "  path: string;",
    "  label: string;",
    "  labels?: Record<string, string>;",
    "}",
    "",
    "/** An app's label in the page's language, or its source-language label. */",
    "function labelOf(a: GatewayApp): string {",
    "  const lang = document.documentElement.lang;",
    '  return a.labels?.[lang] ?? a.labels?.[lang.split("-")[0] ?? ""] ?? a.label;',
    "}",
  ]
    .map((l) => (l === "" ? "" : `${indent}${l}`))
    .join("\n");
}
