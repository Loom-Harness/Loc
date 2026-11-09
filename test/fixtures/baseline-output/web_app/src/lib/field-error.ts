// Auto-generated.  Do not edit by hand.
import { t } from "../i18n";

/** A field error as react-hook-form holds it, plus the catalog code a Loom
 *  check put on it (`zod-resolver.ts`). */
interface LoomFieldError {
  type?: string | number;
  message?: string;
  loomCode?: string;
  /** A field limit's bound (`{ min: 1 }`), the values its text names. */
  loomValues?: Record<string, unknown>;
}

/** The zod issue codes that mean the value has the wrong type or shape. */
const TYPE_MISMATCH: ReadonlySet<string> = new Set(["invalid_type", "invalid_value", "invalid_union", "unrecognized_keys"]);

/** A field error's text in the active locale, computed when the form RENDERS:
 *  the issue's catalog code (a Loom check's own, else the field reason its zod
 *  code names), falling back to the English message.  A server error was
 *  localized when it was applied (`applyServerErrors`), so it renders as-is. */
export function fieldErrorText(error: unknown): string | undefined {
  const e = error as LoomFieldError | undefined;
  if (!e?.message) return undefined;
  if (e.type === "server") return e.message;
  const code = e.loomCode ?? (TYPE_MISMATCH.has(String(e.type)) ? "field.type-mismatch" : "field.rule");
  try {
    return t(code, e.message, e.loomValues as Parameters<typeof t>[2]);
  } catch {
    return e.message;
  }
}
