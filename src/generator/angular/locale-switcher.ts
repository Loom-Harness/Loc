// ---------------------------------------------------------------------------
// Angular binding of the shared locale model (`_frontend/i18n-runtime.ts`).
//
// The framework-agnostic store lives in the generated `src/lib/i18n.ts`
// (`getLocale` / `setLocale` / `subscribe`).  This file is the Angular half:
//
//   - `src/lib/locale.ts`            — `locale`: a module-level signal seeded from
//                                      `getLocale()` and set from `subscribe`.
//   - `src/lib/locale-switcher.ts`   — the standalone `LocaleSwitcher` component
//                                      (`<loom-locale-switcher />`): a native
//                                      `<select>` of the shipped locales, each
//                                      option labelled with the locale's OWN name.
//                                      Pack-independent on purpose: a language
//                                      picker is one control and a native select
//                                      needs no design-pack template.
//
// How a switch reaches the `t(...)` calls: a template's `{{ t(key, default) }}`
// is a plain method call re-evaluated on every change-detection pass of a
// default-strategy component, and no generated component opts out
// (`ChangeDetectionStrategy.OnPush` is never emitted).  What a plain call cannot
// do is ASK for a pass: `setLocale` may run outside the zone or in a zoneless
// app.  So the app shell reads the `locale` signal in its template; a signal
// change marks that view dirty and schedules change detection however the
// switch originated, and the pass re-evaluates every `t()` beneath the shell.
// No remount: form input and page state survive a language change.
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
import { getLocale, subscribe } from "./i18n";

/** The active locale. Reading it in a template makes that view re-check when the
 *  locale switches. */
export const locale = signal(getLocale());
// Lives as long as the app: the store is module-level, so is this subscription.
subscribe(() => locale.set(getLocale()));
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
