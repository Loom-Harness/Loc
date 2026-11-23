// Auto-generated.  Do not edit by hand.

import type { UseFormSetError, FieldValues, Path } from "react-hook-form";
import { t } from "../i18n";
import type { StrictFieldMap } from "./strict-field-map";

interface ProblemDetails {
  errors?: { pointer: string; message: string; code?: string; params?: Record<string, unknown> }[];
}

export interface ApplyServerErrorsArgs<TPayload, TFormState extends FieldValues> {
  readonly error: unknown;
  readonly setError: UseFormSetError<TFormState>;
  readonly fieldMap: StrictFieldMap<TPayload, TFormState>;
}

/** Where the form-level message of a failed submit is held: react-hook-form's
 *  `root` error, which the next submit clears.  `FormFailure` renders it. */
export const SUBMIT_FAILURE_ROOT = "root.submit";

export type ServerErrorOutcome = { kind: "fields" } | { kind: "form" };

/** No catalog message is this string: `t` answers it for an absent key. */
const ABSENT_MESSAGE = "\u0000";

/** The catalog key a refusal is localized by: its aggregate's own sentence
 *  (`<type>.problem.<class>`) when the active catalog carries one, else its
 *  `code`. */
export function problemKey(code: string, params?: Record<string, unknown>): string {
  const type = params?.type;
  if (typeof type !== "string" || !code.startsWith("problem.")) return code;
  const specific = `${type}.${code}`;
  return t(specific, ABSENT_MESSAGE) === ABSENT_MESSAGE ? code : specific;
}

/** The localized text of a refusal: its catalog `code` (or its aggregate's
 *  own sentence, `problemKey`), falling back to the English the server sent,
 *  its placeholders filled from `params`.  A message whose placeholders the
 *  params cannot fill keeps the English. */
export function localizeProblem(code: string, fallback: string, params?: Record<string, unknown>): string {
  try {
    return t(problemKey(code, params), fallback, params as Parameters<typeof t>[2]);
  } catch {
    return fallback;
  }
}

/** The problem code each status answers when the body names none. */
const STATUS_PROBLEM_CODE: Readonly<Record<number, string>> = {"401":"problem.unauthenticated","403":"problem.forbidden","404":"problem.not-found","409":"problem.version-conflict","422":"problem.field-invalid"};
/** The code of a status the table does not name. */
const FALLBACK_PROBLEM_CODE = "problem.internal";
/** The English of a code the table can answer, in the active locale. */
function problemEnglish(code: string): string {
  switch (code) {
    case "problem.unauthenticated":
      return t("problem.unauthenticated", "Please sign in.");
    case "problem.forbidden":
      return t("problem.forbidden", "You are not allowed to do this.");
    case "problem.not-found":
      return t("problem.not-found", "Not found");
    case "problem.version-conflict":
      return t("problem.version-conflict", "Someone else changed this. Reload and try again.");
    case "problem.field-invalid":
      return t("problem.field-invalid", "One or more fields are invalid.");
    default:
      return t("problem.internal", "Something went wrong. Request id: {requestId}");
  }
}

/** A message less any sentence whose `{placeholder}` nothing filled (a
 *  refusal the server sent without the `params` its text names). */
function withoutUnfilled(text: string): string {
  const kept = text.split(/(?<=[.!?])\s+/).filter((sentence) => !/\{\w+\}/.test(sentence));
  return kept.length > 0 ? kept.join(" ") : text;
}

/** What a failed submit shows: its field errors (placed by the caller), or ONE
 *  form-level message. */
export type SubmitFailure = { kind: "fields" } | { kind: "form"; message: string };

/** Decide what a failed submit shows.  The error is read structurally: an
 *  `ApiError` (`status`, parsed `body`) or an `HttpErrorResponse`
 *  (`status`, parsed `error`). */
export function classifySubmitFailure(error: unknown): SubmitFailure {
  const e = (error && typeof error === "object" ? error : {}) as { status?: unknown; body?: unknown; error?: unknown };
  if (typeof e.status !== "number" || e.status === 0) {
    return { kind: "form", message: t("chrome.unreachable", "Could not reach the server. Try again.") };
  }
  const raw = e.body !== undefined ? e.body : e.error;
  const pd = (raw && typeof raw === "object" ? raw : {}) as {
    code?: unknown;
    detail?: unknown;
    title?: unknown;
    params?: Record<string, unknown>;
    errors?: unknown;
  };
  if (e.status === 422 && Array.isArray(pd.errors) && pd.errors.length > 0) return { kind: "fields" };
  const code = typeof pd.code === "string" && pd.code ? pd.code : (STATUS_PROBLEM_CODE[e.status] ?? FALLBACK_PROBLEM_CODE);
  const english =
    (typeof pd.detail === "string" && pd.detail) ||
    (typeof pd.title === "string" && pd.title) ||
    problemEnglish(code);
  return { kind: "form", message: withoutUnfilled(localizeProblem(code, english, pd.params)) };
}

/** Show what a failed submit answered: each field error under its field, or
 *  ONE message on the form (`FormFailure`); nothing is shown outside it. */
export function applyServerErrors<TPayload, TFormState extends FieldValues>({
  error,
  setError,
  fieldMap,
}: ApplyServerErrorsArgs<TPayload, TFormState>): ServerErrorOutcome {
  const failure = classifySubmitFailure(error);
  if (failure.kind === "form") {
    setError(SUBMIT_FAILURE_ROOT, { type: "server", message: failure.message });
    return { kind: "form" };
  }
  // The generated API client throws an `ApiError` carrying the parsed `body`
  // (an RFC 7807 ProblemDetails whose `errors` the rule found non-empty).
  const pd = (error as { body?: ProblemDetails }).body ?? {};
  for (const { pointer, message, code, params } of pd.errors ?? []) {
    const flatKey = pointerToFlat(pointer);
    const target = (fieldMap as Record<string, string | undefined>)[flatKey] ?? flatKey;
    setError(target as Path<TFormState>, {
      type: "server",
      message: localizeProblem(code ?? "field.rule", message, params),
    });
  }
  return { kind: "fields" };
}

const pointerToFlat = (p: string) =>
  p.startsWith("/") ? p.slice(1).split("/").map(decodeURIComponent).join(".") : p;
