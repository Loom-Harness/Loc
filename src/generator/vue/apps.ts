// The Vue `Apps` component — the gateway's apps, fetched at run time (see
// `react/apps.ts` for why the list is fetched, not generated).  Emitted to
// `src/components/Apps.vue` when a page or layout renders `Apps {}`.

import { GATEWAY_APPS_PATH } from "../../util/api-base.js";
import { gatewayAppTs } from "../_frontend/gateway-apps.js";

export const VUE_APPS_PATH = "src/components/Apps.vue";

export function renderVueApps(i18nEnabled: boolean): string {
  return `<!-- Auto-generated.  Do not edit by hand. -->
<script setup lang="ts">
import { onMounted, ref } from "vue";
${i18nEnabled ? 'import { t } from "../lib/locale";\n' : ""}
${gatewayAppTs()}

const apps = ref<GatewayApp[]>([]);
onMounted(async () => {
  try {
    const r = await fetch(${JSON.stringify(GATEWAY_APPS_PATH)});
    const list: unknown = r.ok ? await r.json() : [];
    if (Array.isArray(list)) apps.value = list as GatewayApp[];
  } catch {
    // Outside a gateway there is no list: render nothing.
  }
});
</script>

<template>
  <nav v-if="apps.length > 0" class="app-apps" :aria-label="${i18nEnabled ? `t('chrome.apps', 'Apps')` : "'Apps'"}" data-testid="apps">
    <a v-for="a in apps" :key="a.path" :href="a.path" data-testid="apps-link">{{ labelOf(a) }}</a>
  </nav>
</template>
`;
}
