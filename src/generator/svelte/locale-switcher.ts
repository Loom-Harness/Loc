// ---------------------------------------------------------------------------
// Svelte binding of the shared locale model (`_frontend/i18n-runtime.ts`).
//
// The framework-agnostic store lives in the generated `src/lib/i18n.ts`
// (`getLocale` / `setLocale` / `subscribe`).  This file is the Svelte half:
//
//   - `src/lib/locale.ts` — `locale`: a `readable` store over that module.
//                           A component reads it as `$locale`.
//   - `src/lib/components/LocaleSwitcher.svelte` — a native `<select>` of the
//                           shipped locales, each option labelled with the
//                           locale's OWN name.  Pack-independent on purpose: a
//                           language picker is one control and a native select
//                           needs no design-pack template to stay in step.
//
// Why a remount and not a reactive `t()`: `t()` is a plain function over the
// module-level store, so a template expression that calls it tracks no signal.
// The root layout wraps the routed tree in `{#key $locale}`, which re-renders
// every `t()` call and formatter beneath it under the new locale (server state
// survives in the query cache).  The switcher is part of that tree, so after a
// switch it hands keyboard focus to its successor.
//
// Emitted whenever the ui is i18n-enabled.
// ---------------------------------------------------------------------------

export const SVELTE_LOCALE_STORE_PATH = "src/lib/locale.ts";
export const SVELTE_LOCALE_SWITCHER_PATH = "src/lib/components/LocaleSwitcher.svelte";

export function renderSvelteLocaleStore(): string {
  return `// Auto-generated.  Do not edit by hand.
import { readable } from "svelte/store";
import { getLocale, subscribe } from "./i18n";

/** The active locale. A component reads it as \`$locale\`; a template block that
 *  depends on it runs again when the locale switches. */
export const locale = readable(getLocale(), (set) => {
  set(getLocale());
  return subscribe(() => set(getLocale()));
});
`;
}

export function renderSvelteLocaleSwitcher(): string {
  return `<!-- Auto-generated.  Do not edit by hand. -->
<script lang="ts">
  import { tick } from "svelte";
  import { LOCALES, setLocale } from "$lib/i18n";
  import { locale } from "$lib/locale";

  let { class: className = "" }: { class?: string } = $props();
  const active = $derived(LOCALES.find((l) => l.tag === $locale) ?? LOCALES[0]);
  const SELECTOR = '[data-testid="locale-switcher"]';

  async function onchange(e: Event & { currentTarget: HTMLSelectElement }) {
    const all = [...document.querySelectorAll<HTMLSelectElement>(SELECTOR)];
    const index = all.indexOf(e.currentTarget);
    setLocale(e.currentTarget.value);
    // The routed tree (this control included) remounts under the new locale;
    // return keyboard focus to the control that replaced this one.
    await tick();
    document.querySelectorAll<HTMLSelectElement>(SELECTOR)[Math.max(index, 0)]?.focus();
  }
</script>

{#if LOCALES.length > 1}
  <select
    class={"loom-locale-switcher " + className}
    data-testid="locale-switcher"
    aria-label={active?.name}
    value={$locale}
    {onchange}
  >
    {#each LOCALES as l (l.tag)}
      <option value={l.tag} lang={l.tag} dir={l.dir}>{l.name}</option>
    {/each}
  </select>
{/if}
`;
}
