// Auto-generated.  Do not edit by hand.
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
