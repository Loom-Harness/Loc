// ---------------------------------------------------------------------------
// React binding of the shared locale model (`_frontend/i18n-runtime.ts`).
//
// The framework-agnostic store lives in the generated `src/i18n.ts`
// (`getLocale` / `setLocale` / `subscribe`); this file is the React half:
//
//   - `useLocale()`   — `useSyncExternalStore` over that store.  A component that
//                       calls it re-renders on a switch; the app shell calls it
//                       once at the root, which re-renders every routed page and
//                       so every `t()` / formatter call beneath it.
//   - `LocaleSwitcher` — a native `<select>` of the shipped locales, each option
//                       labelled with the locale's OWN name (computed when the
//                       app is generated).  Pack-independent on purpose: a
//                       language picker is one control, and a native select needs
//                       no design-pack template to stay in sync across packs.
//
// Emitted whenever the ui is i18n-enabled, to `src/lib/locale-switcher.tsx`.
// ---------------------------------------------------------------------------

export function renderLocaleSwitcherModule(): string {
  return `// Auto-generated.  Do not edit by hand.
import { useSyncExternalStore } from "react";
import { LOCALES, getLocale, setLocale, subscribe } from "../i18n";

/** The active locale. Re-renders the caller when the locale switches. */
export function useLocale(): string {
  return useSyncExternalStore(subscribe, getLocale, getLocale);
}

/** Language picker over the shipped locales. Renders nothing for a
 *  single-language app. */
export function LocaleSwitcher() {
  const locale = useLocale();
  if (LOCALES.length < 2) return null;
  const active = LOCALES.find((l) => l.tag === locale) ?? LOCALES[0];
  return (
    <select
      className="loom-locale-switcher"
      data-testid="locale-switcher"
      aria-label={active?.name}
      value={locale}
      onChange={(e) => setLocale(e.target.value)}
    >
      {LOCALES.map((l) => (
        <option key={l.tag} value={l.tag} lang={l.tag} dir={l.dir}>
          {l.name}
        </option>
      ))}
    </select>
  );
}
`;
}
