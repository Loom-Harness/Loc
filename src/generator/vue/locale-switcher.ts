// ---------------------------------------------------------------------------
// Vue binding of the shared locale model (`_frontend/i18n-runtime.ts`).
//
// The framework-agnostic store lives in the generated `src/i18n.ts`
// (`getLocale` / `setLocale` / `subscribe`).  This file is the Vue half:
//
//   - `src/lib/locale.ts`  — the `locale` ref (seeded from `getLocale()`, kept
//                            current through `subscribe`), `useLocale()`, and the
//                            ref-reading `t` / `getLocale` generated code calls.
//   - `src/components/LocaleSwitcher.vue` — a native `<select>` of the shipped
//                            locales, each option labelled with the locale's OWN
//                            name.  Pack-independent on purpose: a language
//                            picker is one control and a native select needs no
//                            design-pack template to stay in step across packs.
//
// How a switch reaches the `t(...)` calls.  `t()` in the shared runtime is a
// plain function over a module-level store, so a template that calls it records
// no reactive dependency.  The adapter's `t` / `getLocale` read the `locale` ref
// FIRST, then delegate: a template render (or computed) that calls either one
// tracks the ref and re-runs in place when `subscribe` updates it.  Nothing
// remounts, so form input, focus, scroll and component state survive a switch.
// Every generated page, component, layout, shell, data-grid child and pack
// format helper imports `t` / `getLocale` from this module, never from `i18n`.
//
// Emitted whenever the ui is i18n-enabled.
// ---------------------------------------------------------------------------

export const VUE_LOCALE_COMPOSABLE_PATH = "src/lib/locale.ts";
export const VUE_LOCALE_SWITCHER_PATH = "src/components/LocaleSwitcher.vue";

export function renderVueLocaleComposable(): string {
  return `// Auto-generated.  Do not edit by hand.
import { ref, type Ref } from "vue";
import { getLocale as baseGetLocale, subscribe, t as baseT } from "../i18n";

const locale = ref(baseGetLocale());
// Lives as long as the app: the store is module-level, so is this subscription.
subscribe(() => {
  locale.value = baseGetLocale();
});

/** The active locale, as a ref. */
export function useLocale(): Readonly<Ref<string>> {
  return locale;
}

/** The active locale. Reading it while a template or computed runs makes that
 *  consumer run again when the locale switches. */
export function getLocale(): string {
  return locale.value;
}

/** \`t\` that re-runs its caller on a locale switch (see \`getLocale\`). */
export function t(
  key: string,
  defaultMessage: string,
  values?: Parameters<typeof baseT>[2],
): string {
  void locale.value;
  return baseT(key, defaultMessage, values);
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
