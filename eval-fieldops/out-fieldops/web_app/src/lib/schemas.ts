// Auto-generated.  Do not edit by hand.
import Decimal from "decimal.js";
import { z } from "zod";

/**
 * Schema for the `money` primitive, on both of its inbound shapes:
 *
 *   - Wire JSON: a decimal-formatted string (`"123.4500"`) — parsed
 *     to a `decimal.js` Decimal instance.
 *   - Form state: an already-constructed Decimal — the money input
 *     control converts on change, so the zod resolver sees the
 *     instance, not a string.  Passed through unchanged.
 *
 * Format violations and parse failures both surface as typed Zod
 * issues — invalid input becomes a form-level error attached to the
 * field, not an uncaught throw.
 */
export const moneySchema = z.union([z.instanceof(Decimal), z.string()]).transform((s, ctx) => {
  if (s instanceof Decimal) return s;
  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid decimal: ${JSON.stringify(s)}`,
    });
    return z.NEVER;
  }
  try {
    return new Decimal(s);
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid decimal: ${JSON.stringify(s)}`,
    });
    return z.NEVER;
  }
});
