// The client half of the wire error codes, shared by the Vue, Svelte and
// Angular runtimes (the React twin lives in `react/emit-templates.ts`).  The
// server never translates a response: every refusal and every `errors[]` entry
// carries a catalog `code` plus optional `params`, and `title` / `detail` /
// `message` stay English.  A client renders text through `t(code, english,
// params)`; a zod issue carries its code as `params.code`, else the field
// reason its zod code names.  Without i18n there is no catalog, so `t` is the
// identity on the English.

import type { InvariantIR } from "../../ir/types/loom-ir.js";
import type { SingleFieldPattern } from "../../ir/util/invariant-classify.js";
import { type FieldLimitCheck, fieldCode, fieldLimitChecks } from "../../ir/util/wire-policy.js";
import { WIRE_ERROR_MESSAGES } from "../_i18n/wire-error-text.js";
import { TS_RUNTIME } from "../_symbols/plan.js";
import { chromeKey, FORM_CHROME } from "../_walker/i18n-chrome.js";
import {
  FALLBACK_PROBLEM_CODE,
  STATUS_PROBLEM_CODE,
  UNREACHABLE_CHROME,
} from "./submit-failure.js";

/** One client-side check a single-field rule implies, with the catalog code
 *  and params its message renders under. */
export interface ClientLimitCheck {
  check: FieldLimitCheck;
  code: string;
  params: Readonly<Record<string, number>>;
}

/** The client checks a single-field rule's pattern implies, one per side of
 *  its limit (`fieldLimitChecks`): an unnamed rule's side renders under its
 *  `field.<reason>` code with the bound as params; a named rule's every side
 *  under the rule's own identity key, with no params. */
export function clientLimitChecks(
  inv: Pick<InvariantIR, "message">,
  pattern: SingleFieldPattern,
): ClientLimitCheck[] {
  return fieldLimitChecks(pattern).map((check) =>
    inv.message
      ? { check, code: inv.message.key, params: {} }
      : { check, code: fieldCode(check.reason), params: check.params },
  );
}

/** The `t` binding of an emitted runtime: the app's shim under i18n, else an
 *  identity that returns the English fallback. */
export function errorCodeTBinding(i18n: boolean, shimImport: string): string {
  return i18n
    ? `import { t } from "${shimImport}";\n`
    : `
/** No catalog in this app: the server's English is the text. */
const t = (_code: string, fallback: string, _params?: Record<string, unknown>): string => fallback;
`;
}

/** `problemKey` — the two-step lookup every TS runtime's `localizeProblem`
 *  reads a refusal's catalog key through: a refusal that concerns one
 *  aggregate carries its identity key as `params.type`, and the catalog MAY
 *  carry a whole sentence for that aggregate (`<type>.problem.<class>`,
 *  `aggregateProblemKey`); absent one, the generic `problem.<class>` stands.
 *  The probe is `t` with no values and a default no message can equal, so it
 *  reads the active locale's catalog and nothing else.  Raw module text. */
export const PROBLEM_KEY_TS = `/** No catalog message is this string: \`t\` answers it for an absent key. */
const ABSENT_MESSAGE = "\\u0000";

/** The catalog key a refusal is localized by: its aggregate's own sentence
 *  (\`<type>.problem.<class>\`) when the active catalog carries one, else its
 *  \`code\`. */
export function problemKey(code: string, params?: Record<string, unknown>): string {
  const type = params?.type;
  if (typeof type !== "string" || !code.startsWith("problem.")) return code;
  const specific = \`\${type}.\${code}\`;
  return t(specific, ABSENT_MESSAGE) === ABSENT_MESSAGE ? code : specific;
}
`;

/** `localizeProblem` + `issueCatalogCode`, the two helpers every TS runtime
 *  shares.  Raw module text (no escaping needed by the caller). */
export const ERROR_CODE_HELPERS_TS = `${PROBLEM_KEY_TS}
/** The localized text of a refusal: its catalog \`code\` (or its aggregate's
 *  own sentence, \`problemKey\`), falling back to the English the server sent,
 *  its placeholders filled from \`params\`.  A message whose placeholders the
 *  params cannot fill keeps the English. */
export function localizeProblem(code: string, fallback: string, params?: Record<string, unknown>): string {
  try {
    return t(problemKey(code, params), fallback, params as Parameters<typeof t>[2]);
  } catch {
    return fallback;
  }
}

/** The zod issue codes that mean the value has the wrong type or shape. */
const TYPE_MISMATCH: ReadonlySet<string> = new Set(["invalid_type", "invalid_value", "invalid_union", "unrecognized_keys"]);

/** The catalog code of a client-side zod issue: the one a Loom check put on it
 *  (\`params.${TS_RUNTIME.issueCode}\`), else the field reason its zod code names. */
export function issueCatalogCode(issue: { code?: string; params?: { ${TS_RUNTIME.issueCode}?: string } }): string {
  return issue.params?.${TS_RUNTIME.issueCode} ?? (TYPE_MISMATCH.has(String(issue.code)) ? "field.type-mismatch" : "field.rule");
}

/** The values a client-side zod issue's catalog text fills its placeholders
 *  from: a declared field limit's bound (\`params.${TS_RUNTIME.issueValues}\`, e.g.
 *  \`{ min: 1 }\`), else the issue's own params. */
export function issueCatalogParams(issue: { params?: Record<string, unknown> }): Record<string, unknown> | undefined {
  const values = issue.params?.${TS_RUNTIME.issueValues};
  return values && typeof values === "object" ? (values as Record<string, unknown>) : issue.params;
}
`;

/** `classifySubmitFailure` — the client half of the submit-failure rule
 *  (`submit-failure.ts`), for every TS runtime that already carries `t` and
 *  `localizeProblem` (`ERROR_CODE_HELPERS_TS`).  The status → code table and
 *  the codes' English are interpolated from the rule, never retyped.  An error
 *  with no HTTP status (a fetch that threw, an `HttpErrorResponse` of status 0)
 *  is the unreachable sentence; a 422 whose body names field errors is
 *  `fields`; every other answer is the problem code's localized text.  Raw
 *  module text. */
export function submitFailureTs(i18n: boolean): string {
  const unreachableEnglish = FORM_CHROME[chromeKey(UNREACHABLE_CHROME)] ?? "";
  const unreachable = i18n
    ? `t(${JSON.stringify(chromeKey(UNREACHABLE_CHROME))}, ${JSON.stringify(unreachableEnglish)})`
    : JSON.stringify(unreachableEnglish);
  // The English of each code the table can answer.  Under i18n each reads
  // through the catalog (the active locale's text, keyed by its code); without
  // one it is the plain English.
  const englishOf = (code: string): string => WIRE_ERROR_MESSAGES[code] ?? "";
  const answerable = [...new Set(Object.values(STATUS_PROBLEM_CODE))].filter(
    (code) => code !== FALLBACK_PROBLEM_CODE,
  );
  const problemEnglish = i18n
    ? `/** The English of a code the table can answer, in the active locale. */
function problemEnglish(code: string): string {
  switch (code) {
${answerable
  .map(
    (code) =>
      `    case ${JSON.stringify(code)}:\n      return t(${JSON.stringify(code)}, ${JSON.stringify(englishOf(code))});`,
  )
  .join("\n")}
    default:
      return t(${JSON.stringify(FALLBACK_PROBLEM_CODE)}, ${JSON.stringify(englishOf(FALLBACK_PROBLEM_CODE))});
  }
}`
    : `/** The English of each code the table can answer. */
const PROBLEM_ENGLISH: Readonly<Record<string, string>> = ${JSON.stringify(
        Object.fromEntries(
          [...answerable, FALLBACK_PROBLEM_CODE].map((code) => [code, englishOf(code)]),
        ),
      )};
const problemEnglish = (code: string): string =>
  PROBLEM_ENGLISH[code] ?? PROBLEM_ENGLISH[FALLBACK_PROBLEM_CODE];`;
  return `/** The problem code each status answers when the body names none. */
const STATUS_PROBLEM_CODE: Readonly<Record<number, string>> = ${JSON.stringify(STATUS_PROBLEM_CODE)};
/** The code of a status the table does not name. */
const FALLBACK_PROBLEM_CODE = ${JSON.stringify(FALLBACK_PROBLEM_CODE)};
${problemEnglish}

/** A message less any sentence whose \`{placeholder}\` nothing filled (a
 *  refusal the server sent without the \`params\` its text names). */
function withoutUnfilled(text: string): string {
  const kept = text.split(/(?<=[.!?])\\s+/).filter((sentence) => !/\\{\\w+\\}/.test(sentence));
  return kept.length > 0 ? kept.join(" ") : text;
}

/** What a failed submit shows: its field errors (placed by the caller), or ONE
 *  form-level message. */
export type SubmitFailure = { kind: "fields" } | { kind: "form"; message: string };

/** Decide what a failed submit shows.  The error is read structurally: an
 *  \`ApiError\` (\`status\`, parsed \`body\`) or an \`HttpErrorResponse\`
 *  (\`status\`, parsed \`error\`). */
export function classifySubmitFailure(error: unknown): SubmitFailure {
  const e = (error && typeof error === "object" ? error : {}) as { status?: unknown; body?: unknown; error?: unknown };
  if (typeof e.status !== "number" || e.status === 0) {
    return { kind: "form", message: ${unreachable} };
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
`;
}
