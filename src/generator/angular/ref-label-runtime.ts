// `src/lib/ref-label.ts` — the Angular twin of the React per-cell reference
// label (`react/ref-label-runtime.ts` carries the rationale).  A standalone
// component: `injectQuery` needs an injection context, which a template cell
// does not have, and its options closure tracks the two input signals so a
// re-bound id refetches.  The projected content is the fallback: the pack's
// truncated-id label renders while loading, on error, and when the record has
// no non-empty `display`.

export const ANGULAR_REF_LABEL_PATH = "src/lib/ref-label.ts";

/** The class a page registers in its standalone `imports: []`. */
export const ANGULAR_REF_LABEL_CLASS = "LoomRefLabel";

export const ANGULAR_REF_LABEL = `// Auto-generated.  Do not edit by hand.
import { HttpClient } from "@angular/common/http";
import { Component, computed, inject, input } from "@angular/core";
import { injectQuery } from "@tanstack/angular-query-experimental";
import { firstValueFrom } from "rxjs";
import { API_BASE_URL } from "../api/config";

/** Labels a cross-aggregate reference with the referenced record's
 *  \`display\`; shows the projected content (the truncated id) until — or
 *  unless — there is one. */
@Component({
  selector: "loom-ref-label",
  template: \`@if (label(); as l) {<ng-container>{{ l }}</ng-container>} @else {<ng-content />}\`,
})
export class LoomRefLabel {
  readonly path = input.required<string>();
  readonly refId = input.required<string>();
  private readonly http = inject(HttpClient);
  private readonly ref = injectQuery(() => ({
    queryKey: ["loom-ref-label", this.path(), this.refId()] as const,
    enabled: !!this.refId(),
    queryFn: () =>
      firstValueFrom(
        this.http.get<{ display?: unknown } | null>(
          \`\${API_BASE_URL}\${this.path()}\${encodeURIComponent(this.refId())}\`,
        ),
      ),
  }));
  protected readonly label = computed(() => {
    const d = this.ref.data()?.display;
    return typeof d === "string" && d !== "" ? d : undefined;
  });
}
`;
