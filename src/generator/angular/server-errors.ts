// The Angular frontend's server-error mapper — `src/lib/server-errors.ts` in
// every generated Angular project.  The twin of the React projects'
// `apply-server-errors.ts`, the Vue `lib/form.ts` and the Svelte
// `lib/forms.svelte.ts` decoders: a rejected submit's RFC 7807 422 lands its
// `errors[]` entries on the form controls their JSON `pointer`s name.
//
// Angular forms are Reactive `FormGroup`s, so "landing on a field" is
// `control.setErrors({ server: message })` + `markAsTouched()` — the control
// goes invalid and touched, which is exactly the condition the field's inline
// message slot is gated on (`form-fields.ts` renders `errors?.['server']` in
// it).  The next edit re-runs the control's validators, which replaces the
// server error.  An entry with no pointer, a pointer naming no control of the
// form, and any non-422 failure are form-level: the submit handler rethrows
// them to the app's `LoomErrorHandler` banner, the place every other unhandled
// Angular failure already surfaces.

/** `src/lib/server-errors.ts` — framework-specific (`@angular/forms`) but
 *  pack-agnostic; emitted into every Angular project. */
export const ANGULAR_SERVER_ERRORS_TS = `// Auto-generated.  Do not edit by hand.
import type { AbstractControl } from "@angular/forms";

/** The part of a \`FormGroup\` the mapper needs: control lookup by dot-path. */
export interface ServerErrorForm {
  get(path: string): AbstractControl | null;
}

export type ServerErrorOutcome =
  | { kind: "fields" }
  | { kind: "global"; title: string }
  | { kind: "unhandled" };

/** Land a thrown \`ApiError\`'s ProblemDetails \`errors[]\` on \`form\`'s controls.
 *  Returns "fields" when every entry landed on a control, "global" with the
 *  first message no control could take, and "unhandled" for a failure that
 *  carries no \`errors[]\` at all. */
export function applyServerErrors(error: unknown, form: ServerErrorForm): ServerErrorOutcome {
  const body = error && typeof error === "object" ? (error as { body?: unknown }).body : undefined;
  const entries =
    body && typeof body === "object" ? (body as { errors?: unknown }).errors : undefined;
  if (!Array.isArray(entries)) return { kind: "unhandled" };
  let placed = false;
  let formLevel: string | undefined;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const { pointer, message } = entry as { pointer?: unknown; message?: unknown };
    if (typeof message !== "string" || message.length === 0) continue;
    const path = typeof pointer === "string" ? pointerToPath(pointer) : "";
    const control = path ? form.get(path) : null;
    if (control) {
      control.setErrors({ server: message });
      control.markAsTouched();
      placed = true;
    } else {
      formLevel ??= message;
    }
  }
  if (formLevel !== undefined) return { kind: "global", title: formLevel };
  return placed ? { kind: "fields" } : { kind: "unhandled" };
}

/** The submit handlers' catch: field errors stay on the form; anything a field
 *  cannot show is rethrown to the app-level error handler. */
export function placeServerErrors(error: unknown, form: ServerErrorForm): void {
  const outcome = applyServerErrors(error, form);
  if (outcome.kind === "fields") return;
  throw outcome.kind === "global" ? new Error(outcome.title) : error;
}

/** A JSON pointer (RFC 6901) as the form's dot-path; "" for the whole document. */
function pointerToPath(pointer: string): string {
  if (!pointer.startsWith("/")) return pointer;
  return pointer
    .slice(1)
    .split("/")
    .map((seg) => decodeURIComponent(seg).replaceAll("~1", "/").replaceAll("~0", "~"))
    .join(".");
}
`;
