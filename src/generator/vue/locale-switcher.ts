// ---------------------------------------------------------------------------
// Vue binding of the shared locale model (`_frontend/i18n-runtime.ts`).
//
// The framework-agnostic store lives in the generated `src/i18n.ts`
// (`getLocale` / `setLocale` / `subscribe`).  This file is the Vue half:
//
//   - `src/lib/locale.ts`  — `useLocale()`: one module-level `ref` seeded from
//                            `getLocale()` and kept current through `subscribe`.
//   - `src/components/LocaleSwitcher.vue` — a native `<select>` of the shipped
//                            locales, each option labelled with the locale's OWN
//                            name.  Pack-independent on purpose: a language
//                            picker is one control and a native select needs no
//                            design-pack template to stay in step across packs.
//
// Why a remount and not a reactive `t()`: `t()` is a plain function over the
// module-level store, so a template that calls it records no reactive
// dependency.  The shell reads `useLocale()` and keys the routed `<router-view>`
// on it, which re-renders the shell's own `t()` calls and remounts the routed
// tree under the new locale (server state survives in the vue-query cache).
//
// Emitted whenever the ui is i18n-enabled.
// ---------------------------------------------------------------------------

export const VUE_LOCALE_COMPOSABLE_PATH = "src/lib/locale.ts";
export const VUE_LOCALE_SWITCHER_PATH = "src/components/LocaleSwitcher.vue";

export function renderVueLocaleComposable(): string {
  return `// Auto-generated.  Do not edit by hand.
import { ref, type Ref } from "vue";
import { getLocale, subscribe } from "../i18n";

const locale = ref(getLocale());
// Lives as long as the app: the store is module-level, so is this subscription.
subscribe(() => {
  locale.value = getLocale();
});

/** The active locale, as a ref. Reading \`.value\` in a template or computed makes
 *  it re-run when the locale switches. */
export function useLocale(): Readonly<Ref<string>> {
  return locale;
}
`;
}

export function renderVueLocaleSwitcher(): string {
  return `<!-- Auto-generated.  Do not edit by hand. -->
<script setup lang="ts">
import { computed } from "vue";
import { LOCALES, setLocale } from "../i18n";
import { useLocale } from "../lib/locale";

const locale = useLocale();
const active = computed(() => LOCALES.find((l) => l.tag === locale.value) ?? LOCALES[0]);
function onChange(e: Event) {
  setLocale((e.target as HTMLSelectElement).value);
}
</script>

<template>
  <select
    v-if="LOCALES.length > 1"
    class="loom-locale-switcher"
    data-testid="locale-switcher"
    :aria-label="active?.name"
    :value="locale"
    @change="onChange"
  >
    <option v-for="l in LOCALES" :key="l.tag" :value="l.tag" :lang="l.tag" :dir="l.dir">{{ l.name }}</option>
  </select>
</template>
`;
}
