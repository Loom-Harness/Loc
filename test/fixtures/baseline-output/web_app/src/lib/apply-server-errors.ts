// Auto-generated.  Do not edit by hand.

import type { UseFormSetError, FieldValues, Path } from "react-hook-form";
import { t } from "../i18n";
import type { StrictFieldMap } from "./strict-field-map";

interface ProblemDetails {
  title?: string;
  detail?: string;
  code?: string;
  params?: Record<string, unknown>;
  errors?: { pointer: string; message: string; code?: string; params?: Record<string, unknown> }[];
}

export interface ApplyServerErrorsArgs<TPayload, TFormState extends FieldValues> {
  readonly error: unknown;
  readonly setError: UseFormSetError<TFormState>;
  readonly fieldMap: StrictFieldMap<TPayload, TFormState>;
}

export type ServerErrorOutcome =
  | { kind: "applied" }
  | { kind: "global"; title: string }
  | { kind: "unhandled" };

/** The localized text of a refusal: its catalog `code`, falling back to the
 *  English the server sent, its placeholders filled from `params`.  A
 *  message whose placeholders the params cannot fill keeps the English. */
export function localizeProblem(code: string, fallback: string, params?: Record<string, unknown>): string {
  try {
    return t(code, fallback, params as Parameters<typeof t>[2]);
  } catch {
    return fallback;
  }
}

export function applyServerErrors<TPayload, TFormState extends FieldValues>({
  error,
  setError,
  fieldMap,
}: ApplyServerErrorsArgs<TPayload, TFormState>): ServerErrorOutcome {
  // The generated API client throws an `ApiError` carrying `status` and the
  // parsed `body` (an RFC 7807 ProblemDetails on a 422).  Read that shape
  // structurally (no import coupling to the client module).
  const e = error as { status?: number; body?: ProblemDetails };
  if (e?.status !== 422 || !e.body) return { kind: "unhandled" };

  const pd = e.body;
  if (Array.isArray(pd.errors) && pd.errors.length > 0) {
    for (const { pointer, message, code, params } of pd.errors) {
      const flatKey = pointerToFlat(pointer);
      const target = (fieldMap as Record<string, string | undefined>)[flatKey] ?? flatKey;
      setError(target as Path<TFormState>, {
        type: "server",
        message: localizeProblem(code ?? "field.rule", message, params),
      });
    }
    return { kind: "applied" };
  }
  // The refusal's sentence lives in RFC 7807 `detail`; `title` is only the
  // reason phrase ("Unprocessable Entity").  Surfacing the phrase is what made
  // every rejected form read as a status code, so prefer `detail` and fall
  // back to `title`.
  const english = pd.detail || pd.title;
  if (!english) return { kind: "unhandled" };
  return { kind: "global", title: localizeProblem(pd.code ?? "problem.internal", english, pd.params) };
}

const pointerToFlat = (p: string) =>
  p.startsWith("/") ? p.slice(1).split("/").map(decodeURIComponent).join(".") : p;
