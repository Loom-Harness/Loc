// What a form does with a submit that fails.  Decided once here and rendered
// by every frontend:
//
//   - `fields`: the server answered 422 with field errors (`errors[]`).  Each
//     error renders under its field.
//   - `form`: the server answered any other refusal — 403, 404, 409, a 422 with
//     no field errors, a 5xx.  The form shows ONE message, the catalog text of
//     the problem body's `code` (else the code of its status), localized and
//     filled from the body's `params`; the server's English is the fallback.
//   - `unreachable`: no answer at all (the network failed).  The form shows
//     the `chrome.unreachable` sentence.
//
// The message renders inside the form (`role="alert"`, test id
// `<form>-error`), is cleared when the next submit starts, and never reaches
// an app-wide crash banner or a toast.

import { wireCode } from "../../ir/util/wire-policy.js";

/** A failed submit's outcome. */
export type SubmitFailureKind = "fields" | "form" | "unreachable";

/** The problem code a status answers when the body names none. */
export const STATUS_PROBLEM_CODE: Readonly<Record<number, string>> = {
  401: wireCode("unauthenticated"),
  403: wireCode("forbidden"),
  404: wireCode("not-found"),
  409: wireCode("version-conflict"),
  422: wireCode("field-invalid"),
};

/** The code of a status no row above names (every 5xx and the rest). */
export const FALLBACK_PROBLEM_CODE = wireCode("internal");

/** The chrome key of the sentence a form shows when the server never
 *  answered. */
export const UNREACHABLE_CHROME = "unreachable";

/** The test id suffix of a form's message element (`<form>-error`). */
export const FORM_ERROR_TESTID_SUFFIX = "-error";

/** One case the rule is held to on every target. */
export interface SubmitFailureCase {
  /** The HTTP status, or `null` when the request got no answer. */
  readonly status: number | null;
  /** The problem body's `code`, when it carries one. */
  readonly bodyCode?: string;
  /** The body carries field errors. */
  readonly fieldErrors?: boolean;
  readonly expect: { kind: SubmitFailureKind; code?: string };
}

/** The rule, evaluated: the reference every target's runtime is held to. */
export function submitFailure(c: Omit<SubmitFailureCase, "expect">): {
  kind: SubmitFailureKind;
  code?: string;
} {
  if (c.status === null) return { kind: "unreachable" };
  if (c.status === 422 && c.fieldErrors) return { kind: "fields" };
  return {
    kind: "form",
    code: c.bodyCode ?? STATUS_PROBLEM_CODE[c.status] ?? FALLBACK_PROBLEM_CODE,
  };
}

export const SUBMIT_FAILURE_CASES: readonly SubmitFailureCase[] = [
  { status: null, expect: { kind: "unreachable" } },
  { status: 422, fieldErrors: true, expect: { kind: "fields" } },
  {
    status: 422,
    bodyCode: "problem.domain-floor",
    expect: { kind: "form", code: "problem.domain-floor" },
  },
  { status: 422, expect: { kind: "form", code: "problem.field-invalid" } },
  {
    status: 403,
    bodyCode: "problem.forbidden",
    expect: { kind: "form", code: "problem.forbidden" },
  },
  { status: 403, expect: { kind: "form", code: "problem.forbidden" } },
  { status: 404, expect: { kind: "form", code: "problem.not-found" } },
  {
    status: 409,
    bodyCode: "problem.unique-conflict",
    expect: { kind: "form", code: "problem.unique-conflict" },
  },
  { status: 409, expect: { kind: "form", code: "problem.version-conflict" } },
  { status: 500, bodyCode: "problem.internal", expect: { kind: "form", code: "problem.internal" } },
  { status: 503, expect: { kind: "form", code: "problem.internal" } },
  { status: 401, expect: { kind: "form", code: "problem.unauthenticated" } },
];
