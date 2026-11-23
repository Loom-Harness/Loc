// The Angular `Apps` component — the gateway's apps, fetched at run time (see
// `react/apps.ts` for why the list is fetched, not generated).  Each link is a
// plain `href`, outside the router.  Emitted to `src/lib/apps.ts` when a page
// or layout renders `Apps {}`.

import { GATEWAY_APPS_PATH } from "../../util/api-base.js";
import { gatewayAppTs } from "../_frontend/gateway-apps.js";

export const ANGULAR_APPS_PATH = "src/lib/apps.ts";

/** The standalone component's class, which a page's or layout's import names. */
export const ANGULAR_APPS_CLASS = "Apps";

export function renderAngularApps(i18nEnabled: boolean): string {
  return `// Auto-generated.  Do not edit by hand.
import { Component, signal } from "@angular/core";
${i18nEnabled ? 'import { t } from "./locale";\n' : ""}
${gatewayAppTs()}

/** The apps the gateway in front of this app serves, one link each.  Renders
 *  nothing outside a gateway. */
@Component({
  selector: "app-apps",
  template: \`
    @if (apps().length > 0) {
      <nav class="app-apps" [attr.aria-label]="name" data-testid="apps">
        @for (a of apps(); track a.path) {
          <a [href]="a.path" data-testid="apps-link">{{ label(a) }}</a>
        }
      </nav>
    }
  \`,
})
export class Apps {
  protected readonly apps = signal<GatewayApp[]>([]);
  protected label(a: GatewayApp): string {
    return labelOf(a);
  }
  protected get name(): string {
    return ${i18nEnabled ? `t("chrome.apps", "Apps")` : `"Apps"`};
  }
  constructor() {
    fetch(${JSON.stringify(GATEWAY_APPS_PATH)})
      .then((r) => (r.ok ? r.json() : []))
      .then((list: unknown) => {
        if (Array.isArray(list)) this.apps.set(list as GatewayApp[]);
      })
      .catch(() => {});
  }
}
`;
}
