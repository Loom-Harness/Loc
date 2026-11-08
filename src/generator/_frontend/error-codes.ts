// The client half of the wire error codes, shared by the Vue, Svelte and
// Angular runtimes (the React twin lives in `react/emit-templates.ts`).  The
// server never translates a response: every refusal and every `errors[]` entry
// carries a catalog `code` plus optional `params`, and `title` / `detail` /
// `message` stay English.  A client renders text through `t(code, english,
// params)`; a zod issue carries its code as `params.loomCode`, else the field
// reason its zod code names.  Without i18n there is no catalog, so `t` is the
// identity on the English.

import { type FieldLimitCheck, fieldCode, fieldLimitChecks } from "../../ir/enrich/wire-policy.js";
import type { InvariantIR } from "../../ir/types/loom-ir.js";
import type { SingleFieldPattern } from "../../ir/validate/invariant-classify.js";

/** The catalog code a CLIENT-side single-field rule renders under: a named
 *  rule's identity key, else `field.rule`.  The client only ever shows a rule
 *  that passed the single-field gate, so an unnamed one is always a field rule
 *  (the server may answer the same rule `problem.domain-floor` when its source
 *  carries an optionality guard). */
export function clientRuleCode(inv: Pick<InvariantIR, "message">): string {
  return inv.message ? inv.message.key : fieldCode("rule");
}

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

/** `localizeProblem` + `issueCatalogCode`, the two helpers every TS runtime
 *  shares.  Raw module text (no escaping needed by the caller). */
export const ERROR_CODE_HELPERS_TS = `/** The localized text of a refusal: its catalog \`code\`, falling back to the
 *  English the server sent, its placeholders filled from \`params\`.  A message
 *  whose placeholders the params cannot fill keeps the English. */
export function localizeProblem(code: string, fallback: string, params?: Record<string, unknown>): string {
  try {
    return t(code, fallback, params as Parameters<typeof t>[2]);
  } catch {
    return fallback;
  }
}

/** The zod issue codes that mean the value has the wrong type or shape. */
const TYPE_MISMATCH: ReadonlySet<string> = new Set(["invalid_type", "invalid_value", "invalid_union", "unrecognized_keys"]);

/** The catalog code of a client-side zod issue: the one a Loom check put on it
 *  (\`params.loomCode\`), else the field reason its zod code names. */
export function issueCatalogCode(issue: { code?: string; params?: { loomCode?: string } }): string {
  return issue.params?.loomCode ?? (TYPE_MISMATCH.has(String(issue.code)) ? "field.type-mismatch" : "field.rule");
}

/** The values a client-side zod issue's catalog text fills its placeholders
 *  from: a declared field limit's bound (\`params.loomValues\`, e.g.
 *  \`{ min: 1 }\`), else the issue's own params. */
export function issueCatalogParams(issue: { params?: Record<string, unknown> }): Record<string, unknown> | undefined {
  const values = issue.params?.loomValues;
  return values && typeof values === "object" ? (values as Record<string, unknown>) : issue.params;
}
`;
