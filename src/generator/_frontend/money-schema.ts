// The one owner of the `money` zod schema the decimal.js frontends (React, Vue,
// Svelte) emit into `src/lib/schemas.ts`.  Request forms and read responses
// both parse through it, so it decides what a page holds for a money field.
//
// The wire spells money as a fixed-scale decimal STRING (RS-12: "98.7600").
// decimal.js normalises trailing zeros away — `new Decimal("98.7600")`
// stringifies as "98.76" — so a parsed value handed to the verbatim money
// display (`money-format.ts`, M-T1.25) would print a different number of digits
// than the database stores.  The parsed instance therefore keeps the wire
// string's scale in its own `toString`/`toJSON`: the value a page renders is
// the value the backend sent, digit for digit.  Arithmetic still yields plain
// decimal.js instances (a computed sum has no stored scale to keep), and a form
// value the money input built is passed through untouched.

/** `src/lib/schemas.ts` money block — framework-neutral TypeScript. */
export const MONEY_SCHEMA_TS = `// Auto-generated.  Do not edit by hand.
import Decimal from "decimal.js";
import { z } from "zod";

/**
 * Schema for the \`money\` primitive, on both of its inbound shapes:
 *
 *   - Wire JSON: a decimal-formatted string (\`"123.4500"\`) — parsed
 *     to a \`decimal.js\` Decimal instance that still renders the wire's
 *     own digits (\`"123.4500"\`, not decimal.js's normalised
 *     \`"123.45"\`), so the screen shows what the database stores.
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
  if (!/^-?\\d+(\\.\\d+)?$/.test(s)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: \`Invalid decimal: \${JSON.stringify(s)}\`,
    });
    return z.NEVER;
  }
  try {
    return keepScale(new Decimal(s), s);
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: \`Invalid decimal: \${JSON.stringify(s)}\`,
    });
    return z.NEVER;
  }
});

/** Pin a parsed Decimal's rendering to the scale of the string it was parsed
 *  from: decimal.js drops trailing zeros, the wire's fixed scale keeps them. */
function keepScale(d: Decimal, wire: string): Decimal {
  const dot = wire.indexOf(".");
  const scale = dot < 0 ? 0 : wire.length - dot - 1;
  const text = (): string => d.toFixed(scale);
  Object.defineProperty(d, "toString", { value: text });
  Object.defineProperty(d, "toJSON", { value: text });
  return d;
}
`;
