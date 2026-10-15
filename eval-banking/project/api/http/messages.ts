// Auto-generated.  Validation-message catalog (Loom i18n).
//
// Keys are the stable content-hash codes the wire validators attach to a
// messaged `invariant` / `check` / `precondition` (`errors[].code`), identical
// to the keys in the system's `.loom/messages.en.json` and on every other
// backend.  A locale with no entry for a code falls back to the authored
// source-language text, so an untranslated message still reads correctly.
import { requestContext } from "../obs/als";

/** Source-language catalog, keyed by locale then by message code. */
const MESSAGES: Record<string, Record<string, string>> = {
  en: {
    "msg.38janj": "Daily withdrawal limit exceeded",
    "msg.3nv9hm": "Target account is not active",
    "msg.felbiy": "Source account is not active",
    "msg.ga83c6": "Balance must be zero to close",
    "msg.lmijhy": "Amount must be positive",
    "msg.mrfg0x": "Account is not active",
    "msg.p55wf6": "Insufficient funds",
  },
};

/** Normalise an Accept-Language header value to a lookup tag: the first
 *  listed language, without its `;q=` weight, lowercased.  The ambient
 *  RequestContext carries the header VERBATIM (it is the
 *  request-stable input, not a catalog-shaped one), so the normalisation
 *  belongs here rather than at the boundary that sets it. */
function lookupTags(locale: string): string[] {
  const first = (locale.split(",")[0] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!first) return [];
  const primary = first.split("-")[0] ?? first;
  return primary === first ? [first] : [first, primary];
}

/** Resolve a message `code` for the current request's locale, falling back to
 *  `fallback` (the authored source-language text) when the code is absent,
 *  unknown, or untranslated for that locale. */
export function localizeMessage(code: string | undefined, fallback: string): string {
  if (!code) return fallback;
  const locale = requestContext()?.locale ?? "en";
  for (const tag of lookupTags(locale)) {
    const hit = MESSAGES[tag]?.[code];
    if (hit !== undefined) return hit;
  }
  return fallback;
}