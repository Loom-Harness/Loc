// ---------------------------------------------------------------------------
// Svelte binding of the shared locale model (`_frontend/i18n-runtime.ts`).
//
// The framework-agnostic store lives in the generated `src/lib/i18n.ts`
// (`getLocale` / `setLocale` / `subscribe`).  This file is the Svelte half:
//
//   - `src/lib/locale.svelte.ts` — a runes module: `current` is a `$state`
//                           seeded from `getLocale()` and kept current through
//                           `subscribe`; it exports the `current`-reading `t` and
//                           `getLocale` that generated code calls.
//   - `src/lib/components/LocaleSwitcher.svelte` — a native `<select>` of the
//                           shipped locales, each option labelled with the
//                           locale's OWN name.  Pack-independent on purpose: a
//                           language picker is one control and a native select
//                           needs no design-pack template to stay in step.
//
// How a switch reaches the `t(...)` calls.  `t()` in the shared runtime is a
// plain function over a module-level store, so a template expression that calls
// it tracks no signal.  The adapter's `t` / `getLocale` read the `$state` FIRST,
// then delegate: a template expression (or `$derived`) that calls either one
// subscribes to it and re-runs in place when `subscribe` updates it.  Nothing
// remounts, so form input, focus, scroll and component state survive a switch.
// The app is Svelte 5 (runes; `toast.svelte.ts` is the same shape), so a runes
// module is the native fit.  Every page, component, layout, shell, data-grid
// child and pack format helper imports `t` / `getLocale` from
// `$lib/locale.svelte`, never from `i18n`.
//
// Emitted whenever the ui is i18n-enabled.
// ---------------------------------------------------------------------------

export const SVELTE_LOCALE_STORE_PATH = "src/lib/locale.svelte.ts";
export const SVELTE_LOCALE_SWITCHER_PATH = "src/lib/components/LocaleSwitcher.svelte";

export function renderSvelteLocaleStore(): string {
  return `// Auto-generated.  Do not edit by hand.
import { getLocale as baseGetLocale, subscribe, t as baseT } from "./i18n";

let current = $state(baseGetLocale());
// Lives as long as the app: the store is module-level, so is this subscription.
subscribe(() => {
  current = baseGetLocale();
});

/** The active locale. Reading it while a template or \`$derived\` runs makes that
 *  consumer run again when the locale switches. */
export function getLocale(): string {
  return current;
}

/** \`t\` that re-runs its caller on a locale switch (see \`getLocale\`). */
export function t(
  key: string,
  defaultMessage: string,
  values?: Parameters<typeof baseT>[2],
): string {
  void current;
  return baseT(key, defaultMessage, values);
}
`;
}

export function renderSvelteLocaleSwitcher(): string {
  return `<!-- Auto-generated.  Do not edit by hand. -->
<script lang="ts">
  import { LOCALES, setLocale } from "$lib/i18n";
  import { getLocale } from "$lib/locale.svelte";

  let { class: className = "" }: { class?: string } = $props();
  const active = $derived(LOCALES.find((l) => l.tag === getLocale()) ?? LOCALES[0]);
  function onchange(e: Event & { currentTarget: HTMLSelectElement }) {
    setLocale(e.currentTarget.value);
  }
</script>

{#if LOCALES.length > 1}
  <select
    class={"loom-locale-switcher " + className}
    data-testid="locale-switcher"
    aria-label={active?.name}
    value={getLocale()}
    {onchange}
  >
    {#each LOCALES as l (l.tag)}
      <option value={l.tag} lang={l.tag} dir={l.dir}>{l.name}</option>
    {/each}
  </select>
{/if}
`;
}
