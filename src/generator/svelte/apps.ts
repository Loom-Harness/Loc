// The Svelte `Apps` component — the gateway's apps, fetched at run time (see
// `react/apps.ts` for why the list is fetched, not generated).  Each link
// leaves this app, so it carries `data-sveltekit-reload`.  Emitted to
// `src/lib/components/Apps.svelte` when a page or layout renders `Apps {}`.

import { GATEWAY_APPS_PATH } from "../../util/api-base.js";
import { gatewayAppTs } from "../_frontend/gateway-apps.js";

export const SVELTE_APPS_PATH = "src/lib/components/Apps.svelte";

export function renderSvelteApps(i18nEnabled: boolean): string {
  return `<!-- Auto-generated.  Do not edit by hand. -->
<script lang="ts">
  import { onMount } from "svelte";
${i18nEnabled ? '  import { t } from "$lib/locale.svelte";\n' : ""}
${gatewayAppTs("  ")}

  let apps = $state<GatewayApp[]>([]);
  onMount(async () => {
    try {
      const r = await fetch(${JSON.stringify(GATEWAY_APPS_PATH)});
      const list: unknown = r.ok ? await r.json() : [];
      if (Array.isArray(list)) apps = list as GatewayApp[];
    } catch {
      // Outside a gateway there is no list: render nothing.
    }
  });
</script>

{#if apps.length > 0}
  <nav class="app-apps" aria-label={${i18nEnabled ? `t("chrome.apps", "Apps")` : `"Apps"`}} data-testid="apps">
    {#each apps as a (a.path)}
      <a href={a.path} data-sveltekit-reload data-testid="apps-link">{labelOf(a)}</a>
    {/each}
  </nav>
{/if}
`;
}
