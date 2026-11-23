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

import {
  ERROR_CODE_HELPERS_TS,
  errorCodeTBinding,
  submitFailureTs,
} from "../_frontend/error-codes.js";

/** `src/lib/server-errors.ts` — framework-specific (`@angular/forms`) but
 *  pack-agnostic; emitted into every Angular project.
 *
 *  The server never translates a response: every refusal and `errors[]` entry
 *  carries a catalog `code` (+ `params`), and the mapper renders it through
 *  `t(code, english, params)` — the app's catalog under i18n, the English the
 *  server sent otherwise. */
export function angularServerErrorsTs(i18n: boolean): string {
  return ANGULAR_SERVER_ERRORS_TEMPLATE.replace("/*{{T_BINDING}}*/", () =>
    errorCodeTBinding(i18n, "./locale"),
  ).replace("/*{{HELPERS}}*/", () => `${ERROR_CODE_HELPERS_TS}\n${submitFailureTs(i18n)}`);
}

const ANGULAR_SERVER_ERRORS_TEMPLATE = `// Auto-generated.  Do not edit by hand.
import type { AbstractControl } from "@angular/forms";
/*{{T_BINDING}}*/
/*{{HELPERS}}*/
/** The part of a \`FormGroup\` the mapper needs: control lookup by dot-path. */
export interface ServerErrorForm {
  get(path: string): AbstractControl | null;
}

/** Show what a failed submit answered.  A 422's \`errors[]\` entries land on
 *  \`form\`'s controls by their pointers; the returned text is the ONE message
 *  the form shows for everything else: a refusal's catalog text, the unreachable
 *  sentence, or the first \`errors[]\` entry no control could take.  Null when
 *  every field error found its control. */
export function placeServerErrors(error: unknown, form: ServerErrorForm): string | null {
  const failure = classifySubmitFailure(error);
  if (failure.kind === "form") return failure.message;
  const entries = (problemBodyOf(error) as { errors?: unknown[] } | undefined)?.errors ?? [];
  let formLevel: string | null = null;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const { pointer, message, code, params } = entry as {
      pointer?: unknown;
      message?: unknown;
      code?: unknown;
      params?: Record<string, unknown>;
    };
    if (typeof message !== "string" || message.length === 0) continue;
    const path = typeof pointer === "string" ? pointerToPath(pointer) : "";
    const control = path ? form.get(path) : null;
    if (control) {
      control.setErrors({
        server: localizeProblem(typeof code === "string" ? code : "field.rule", message, params),
      });
      control.markAsTouched();
    } else {
      formLevel ??= localizeProblem(typeof code === "string" ? code : "problem.internal", message, params);
    }
  }
  return formLevel;
}

/** The ProblemDetails body a failed call carries.  The services call through
 *  \`HttpClient\`, whose \`HttpErrorResponse\` holds the parsed payload in
 *  \`error\`; the fetch client's \`ApiError\` holds it in \`body\`. */
function problemBodyOf(error: unknown): unknown {
  if (!error || typeof error !== "object") return undefined;
  const e = error as { body?: unknown; error?: unknown };
  return e.body !== undefined ? e.body : e.error;
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
