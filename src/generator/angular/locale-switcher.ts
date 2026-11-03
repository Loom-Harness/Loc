// ---------------------------------------------------------------------------
// Angular binding of the shared locale model (`_frontend/i18n-runtime.ts`).
//
// The framework-agnostic store lives in the generated `src/lib/i18n.ts`
// (`getLocale` / `setLocale` / `subscribe` / `t`).  This file is the Angular half:
//
//   - `src/lib/locale.ts`          — the `locale` signal (seeded from
//                                    `getLocale()`, set from `subscribe`) and the
//                                    signal-reading `t` / `getLocale` every
//                                    component template, effect and format helper
//                                    calls.
//   - `src/lib/locale-switcher.ts` — the standalone `LocaleSwitcher` component
//                                    (`<loom-locale-switcher />`): a native
//                                    `<select>` of the shipped locales, each
//                                    option labelled with the locale's OWN name.
//                                    Pack-independent on purpose: a language
//                                    picker is one control and a native select
//                                    needs no design-pack template.
//
// How a switch reaches the `t(...)` calls.  Angular 22 components default to
// OnPush, so a template that calls the plain `t` is not checked again after the
// locale changes — the call has no input that moved.  `t` in `locale.ts` reads
// the `locale` signal first; reading a signal while a template (or an `effect`)
// executes registers it as a dependency, so every view that rendered a string
// is marked dirty when `subscribe` sets the signal, however the switch began
// (a zone event, a zoneless callback, `setLocale` from a store).  The same read
// in `getLocale` makes the pack format helpers (dates, numbers, the Yes/No
// cells) follow the locale.  Nothing remounts: form input and page state
// survive a language change.
//
// Emitted whenever the ui is i18n-enabled.
// ---------------------------------------------------------------------------

export const ANGULAR_LOCALE_SIGNAL_PATH = "src/lib/locale.ts";
export const ANGULAR_LOCALE_SWITCHER_PATH = "src/lib/locale-switcher.ts";

/** The class a page registers in its standalone `imports: []`. */
export const ANGULAR_LOCALE_SWITCHER_CLASS = "LocaleSwitcher";

export function renderAngularLocaleSignal(): string {
  return `// Auto-generated.  Do not edit by hand.
import { signal } from "@angular/core";
import * as i18n from "./i18n";

/** The active locale, as a signal. */
export const locale = signal(i18n.getLocale());
// Lives as long as the app: the store is module-level, so is this subscription.
i18n.subscribe(() => locale.set(i18n.getLocale()));

/** The active locale. Reading it while a template, \`computed\` or \`effect\` runs
 *  makes that consumer run again when the locale switches. */
export function getLocale(): string {
  return locale();
}

/** \`t\` that re-runs its caller on a locale switch (see \`getLocale\`). */
export function t(
  key: string,
  defaultMessage: string,
  values?: Parameters<typeof i18n.t>[2],
): string {
  locale();
  return i18n.t(key, defaultMessage, values);
}
`;
}

export function renderAngularLocaleSwitcher(): string {
  return `// Auto-generated.  Do not edit by hand.
import { Component, computed } from "@angular/core";
import { LOCALES, setLocale } from "./i18n";
import { locale } from "./locale";

/** Language picker over the shipped locales. Renders nothing for a
 *  single-language app. */
@Component({
  selector: "loom-locale-switcher",
  template: \`
    @if (locales.length > 1) {
      <select
        class="loom-locale-switcher"
        data-testid="locale-switcher"
        [attr.aria-label]="active()?.name"
        (change)="onChange($event)"
      >
        @for (l of locales; track l.tag) {
          <option [value]="l.tag" [selected]="l.tag === locale()" [attr.lang]="l.tag" [attr.dir]="l.dir">{{ l.name }}</option>
        }
      </select>
    }
  \`,
  styles: [\`select { font: inherit; padding: 4px 8px; border-radius: 6px; }\`],
})
export class LocaleSwitcher {
  protected readonly locales = LOCALES;
  protected readonly locale = locale;
  protected readonly active = computed(() => LOCALES.find((l) => l.tag === locale()) ?? LOCALES[0]);
  protected onChange(e: Event): void {
    setLocale((e.target as HTMLSelectElement).value);
  }
}
`;
}
