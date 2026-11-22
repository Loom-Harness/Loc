// Auto-generated.  Do not edit by hand.
//
// The parse rule of a form's text inputs: a blank is the field's absence
// (`null` when optional, the kind's zero when required), any other text must
// match the kind's grammar and range or is refused in its field.
import { z } from "zod";

export type FormTextKind = "int" | "long" | "decimal" | "money";

/** Why a text is refused: the wire code the server answers for the same value. */
export interface FormTextRefusal {
  code: string;
  message: string;
  params?: Record<string, number | string>;
}

export type FormTextOutcome = { ok: true; value: number | string | null } | { ok: false; refusal: FormTextRefusal };

interface Rule {
  grammar: RegExp;
  wire: "number" | "string";
  blankZero: number | string;
  range?: { min: number; max: number };
  refusal: FormTextRefusal;
  rangeRefusal?: FormTextRefusal;
}

const RULES: Record<FormTextKind, Rule> = {
  int: { grammar: /^-?[0-9]+$/, wire: "number", blankZero: 0, range: { min: -2147483648, max: 2147483647 }, refusal: {"code":"field.type-mismatch","message":"Invalid value"}, rangeRefusal: {"code":"field.integer-range","message":"Must be between {min} and {max}","params":{"min":-2147483648,"max":2147483647}} },
  long: { grammar: /^-?[0-9]+$/, wire: "number", blankZero: 0, range: { min: -9007199254740991, max: 9007199254740991 }, refusal: {"code":"field.type-mismatch","message":"Invalid value"}, rangeRefusal: {"code":"field.integer-range","message":"Must be between {min} and {max}","params":{"min":-9007199254740991,"max":9007199254740991}} },
  decimal: { grammar: /^-?[0-9]+(\.[0-9]+)?$/, wire: "number", blankZero: 0, refusal: {"code":"field.type-mismatch","message":"Invalid value"} },
  money: { grammar: /^-?[0-9]+(\.[0-9]+)?$/, wire: "string", blankZero: "0", refusal: {"code":"field.money-grammar","message":"Invalid decimal {value}"} },
};

/** Parse one input's text.  A number (a seed, a caller's value) is read as
 *  the text it spells. */
export function parseFormText(kind: FormTextKind, input: unknown, optional: boolean): FormTextOutcome {
  const rule = RULES[kind];
  const text = input === null || input === undefined ? "" : String(input).trim();
  if (text === "") return { ok: true, value: optional ? null : rule.blankZero };
  if (!rule.grammar.test(text)) return refused(rule.refusal, text);
  if (rule.wire === "string") return { ok: true, value: text };
  const n = Number(text);
  if (rule.range && (n < rule.range.min || n > rule.range.max || !Number.isSafeInteger(n))) {
    return refused(rule.rangeRefusal ?? rule.refusal, text);
  }
  if (!Number.isFinite(n)) return refused(rule.refusal, text);
  return { ok: true, value: n };
}

/** A refusal of `text`: the text rides as the `value` its message may name. */
function refused(refusal: FormTextRefusal, text: string): FormTextOutcome {
  return { ok: false, refusal: { ...refusal, params: { ...refusal.params, value: text } } };
}

/** The text an input shows for a held value: a number or a `Decimal` spelled
 *  out, a blank for an absent one. */
export function formTextOf(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

/** Refuse a text in its field: the refusal's catalog code rides the issue. */
export function refuseFormText(ctx: z.RefinementCtx, refusal: FormTextRefusal): never {
  ctx.addIssue({
    code: "custom",
    message: refusal.message,
    params: { code: refusal.code, ...(refusal.params ? { values: refusal.params } : {}) },
  });
  return z.NEVER;
}

const held = z.union([z.string(), z.number()]);

/** A required number field: its text, parsed by the rule. */
export function formNumber(kind: Exclude<FormTextKind, "money">): z.ZodType<number, string | number> {
  return held.transform((v, ctx): number => {
    const r = parseFormText(kind, v, false);
    return r.ok ? (r.value as number) : refuseFormText(ctx, r.refusal);
  });
}

/** An optional number field: a blank is `null`, a key the form does not
 *  carry stays absent. */
export function formNumberOpt(
  kind: Exclude<FormTextKind, "money">,
): z.ZodType<number | null | undefined, string | number | null | undefined> {
  return z
    .union([held, z.null()])
    .transform((v, ctx): number | null => {
      const r = parseFormText(kind, v, true);
      return r.ok ? (r.value as number | null) : refuseFormText(ctx, r.refusal);
    })
    .optional();
}

/** A list of numbers typed as comma-separated text: each item parsed by the
 *  rule, and the list refused at its own field when one item does not parse. */
export function formNumberList(
  kind: Exclude<FormTextKind, "money">,
): z.ZodType<number[], (string | number)[]> {
  return z.array(held).transform((items, ctx): number[] => {
    const out: number[] = [];
    for (const item of items) {
      const r = parseFormText(kind, item, false);
      if (!r.ok) return refuseFormText(ctx, r.refusal);
      out.push(r.value as number);
    }
    return out;
  });
}
