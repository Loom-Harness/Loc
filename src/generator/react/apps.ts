// The React `Apps` component — the gateway's apps, fetched at run time.
//
// The list is the gateway's own (`GATEWAY_APPS_PATH`, answered at the
// origin's root whatever path this app is served under), so this ui never
// names another, and outside a gateway the fetch fails and the component
// renders nothing.  Each link leaves this app's router, so it is a plain
// same-tab `<a href>`.  Pack-independent on purpose, like `LocaleSwitcher`.
//
// Emitted to `src/lib/apps.tsx` when a page or layout renders `Apps {}`.

import { GATEWAY_APPS_PATH } from "../../util/api-base.js";
import { gatewayAppTs } from "../_frontend/gateway-apps.js";

export function renderAppsModule(i18nEnabled: boolean): string {
  const name = i18nEnabled ? `t("chrome.apps", "Apps")` : `"Apps"`;
  return `// Auto-generated.  Do not edit by hand.
import { useEffect, useState } from "react";
${i18nEnabled ? 'import { t } from "../i18n";\n' : ""}
${gatewayAppTs()}

/** The apps the gateway in front of this app serves, one link each.  Renders
 *  nothing outside a gateway. */
export function Apps() {
  const [apps, setApps] = useState<GatewayApp[]>([]);
  useEffect(() => {
    let live = true;
    fetch(${JSON.stringify(GATEWAY_APPS_PATH)})
      .then((r) => (r.ok ? r.json() : []))
      .then((list: GatewayApp[]) => {
        if (live && Array.isArray(list)) setApps(list);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  if (apps.length === 0) return null;
  return (
    <nav className="app-apps" aria-label={${name}} data-testid="apps">
      {apps.map((a) => (
        <a key={a.path} href={a.path} data-testid="apps-link">
          {labelOf(a)}
        </a>
      ))}
    </nav>
  );
}
`;
}
