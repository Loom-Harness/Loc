// The client half of the wire error codes, shared by the Vue, Svelte and
// Angular runtimes (the React twin lives in `react/emit-templates.ts`).  The
// server never translates a response: every refusal and every `errors[]` entry
// carries a catalog `code` plus optional `params`, and `title` / `detail` /
// `message` stay English.  A client renders text through `t(code, english,
// params)`; a zod issue carries its code as `params.loomCode`, else the field
// reason its zod code names.  Without i18n there is no catalog, so `t` is the
// identity on the English.

import { fieldCode } from "../../ir/enrich/wire-policy.js";
import type { InvariantIR } from "../../ir/types/loom-ir.js";

/** The catalog code a CLIENT-side single-field rule renders under: a named
 *  rule's identity key, else `field.rule`.  The client only ever shows a rule
 *  that passed the single-field gate, so an unnamed one is always a field rule
 *  (the server may answer the same rule `problem.domain-floor` when its source
 *  carries an optionality guard). */
export function clientRuleCode(inv: Pick<InvariantIR, "message">): string {
  return inv.message ? inv.message.key : fieldCode("rule");
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
`;
