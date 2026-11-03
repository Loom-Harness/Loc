// ---------------------------------------------------------------------------
// Server-error messages — the catalog English of every wire `code`.
//
// A problem body's `code` (`problem.<class>`) and each `errors[]` entry's
// (`field.<reason>`) is the catalog key a client localizes it by:
// `t(pd.code, pd.detail, pd.params)`.  Every backend answers the code from
// `wireCode` / `fieldCode` (`src/ir/enrich/wire-policy.ts`), and every catalog
// carries the English here — merged into the frontend and system catalogs by
// `_walker/i18n-chrome.ts` (`chromeMergedWhenEnabled`) — so the two cannot
// drift.  A leaf module so the backends' rule text (`rule-text.ts`) reads it
// without importing the walker.
//
// Each text is a WHOLE generic sentence with no noun: the server cannot name
// the aggregate in a translatable way, and an inline field error already sits
// under its labelled field, so a field text never names the field.  The only
// holes are the data `params` the reason carries (`fieldParams` / `wireParams`).
// ---------------------------------------------------------------------------

import {
  type FieldRejectionReason,
  fieldCode,
  WIRE_REJECTION_CLASSES,
  type WireRejectionClass,
  wireCode,
} from "../../ir/enrich/wire-policy.js";
import { sourceText } from "./source-text.js";

const PROBLEM_TEXT: Readonly<Record<WireRejectionClass, string>> = {
  "no-route": "Not found",
  "method-not-allowed": "This action is not supported.",
  "unsupported-media-type": "The request could not be read.",
  "malformed-body": "The request could not be read.",
  "malformed-if-match": "The request could not be read.",
  "field-invalid": "One or more fields are invalid.",
  forbidden: "You are not allowed to do this.",
  "not-found": "Not found",
  "state-gate": "Not allowed in the current state.",
  // Also the text of an unnamed domain-floor rule (`rule-text.ts`).
  "domain-floor": "Business rule violated",
  "version-conflict": "Someone else changed this. Reload and try again.",
  "unique-conflict": "This already exists.",
  "dangling-reference": "Something this refers to does not exist.",
  "referenced-in-use": "This is still in use and cannot be deleted.",
  "not-implemented": "This is not available yet.",
  internal: "Something went wrong. Request id: {requestId}",
  unauthenticated: "Please sign in.",
};

const FIELD_TEXT: Readonly<Record<FieldRejectionReason, string>> = {
  missing: "Required",
  "malformed-id": "Invalid id",
  "integer-range": "Must be between {min} and {max}",
  "money-grammar": "Invalid decimal {value}",
  "money-range": "Amount out of range",
  // Also the text of an unnamed single-field rule (`rule-text.ts`).
  rule: "Invalid value",
  "type-mismatch": "Invalid value",
};

/** Every `problem.<class>` / `field.<reason>` key → its English. */
export const WIRE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    WIRE_REJECTION_CLASSES.map((cls) => [wireCode(cls), PROBLEM_TEXT[cls]] as const),
  ),
  ...Object.fromEntries(
    (Object.keys(FIELD_TEXT) as FieldRejectionReason[]).map(
      (reason) => [fieldCode(reason), FIELD_TEXT[reason]] as const,
    ),
  ),
};

/** The source-language text of a wire error code (`problem.*` / `field.*`). */
export function wireErrorMessage(code: string): string {
  const text = WIRE_ERROR_MESSAGES[code];
  if (text === undefined) throw new Error(`wire-error-text: unknown wire error code "${code}"`);
  return sourceText(code, text);
}
