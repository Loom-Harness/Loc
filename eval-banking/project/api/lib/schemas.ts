// Auto-generated.  Do not edit by hand.
import Decimal from "decimal.js";
import { z } from "@hono/zod-openapi";

/**
 * Wire schema for the `money` primitive.
 *
 * Inbound JSON: a decimal-formatted string (`"123.4500"`).  Parses
 * to a `decimal.js` Decimal instance.  Format violations and parse
 * failures both surface as typed Zod issues — invalid input becomes
 * a 400 with the field name attached, not an uncaught throw.
 */
export const moneySchema = z.string().transform((s: string, ctx: any) => {
  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid decimal: ${JSON.stringify(s)}`,
    });
    return z.NEVER;
  }
  // RANGE, not format: the grammar above already passed, and what is left is a
  // magnitude question the COLUMN answers.  Without this a 40-digit price is a
  // well-formed decimal string every parser accepts, so it reached
  // NUMERIC(19,4) and the DATABASE refused it
  // — a 500 for a client fault (M-T6.60 divergence 3).  Counted on the digits
  // rather than computed, so a value too large to hold is never constructed.
  if (s.replace(/^-/, "").split(".")[0]!.replace(/^0+(?=\d)/, "").length > 15) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Money out of range: ${JSON.stringify(s)}`,
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
