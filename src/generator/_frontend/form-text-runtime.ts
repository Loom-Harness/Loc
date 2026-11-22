// The TypeScript rendering of the form text-parse rule (`src/ir/plan/form-text.ts`):
// `src/lib/form-text.ts` in every TypeScript frontend (React, Vue, Svelte,
// Angular).  The grammars, ranges, zeros and refusals are written into the
// module from the plan, so the emitted parser cannot drift from the rule; the
// rule's conformance table (`FORM_TEXT_CASES`) runs over this exact text.
//
// A form field whose input is parsed text holds the TEXT the user typed (a
// number or a `Decimal` is accepted too, for a seed or a caller that already
// has one), and its request schema parses it here: an accepted text becomes
// the wire value, a refused one is a field issue carrying the refusal's
// catalog code, and nothing is sent.

import { FORM_TEXT_KINDS, type FormTextRule, formTextRule } from "../../ir/plan/form-text.js";
import { TS_RUNTIME } from "../_symbols/plan.js";

function ruleLiteral(r: FormTextRule): string {
  const fields = [
    `grammar: /${r.grammar}/`,
    `wire: ${JSON.stringify(r.wire)}`,
    `blankZero: ${JSON.stringify(r.blankZero)}`,
    r.range ? `range: { min: ${r.range.min}, max: ${r.range.max} }` : undefined,
    `refusal: ${JSON.stringify(r.refusal)}`,
    r.rangeRefusal ? `rangeRefusal: ${JSON.stringify(r.rangeRefusal)}` : undefined,
  ].filter((x): x is string => x !== undefined);
  return `  ${r.kind}: { ${fields.join(", ")} },`;
}

/** `src/lib/form-text.ts`.  `host` adds the form library's half: `zod` the
 *  request-schema builders the React, Vue and Svelte forms validate through,
 *  `angular` the reactive-forms validator and the submit-time parse. */
export function formTextModuleTs(host: "zod" | "angular" | "none"): string {
  const zod = host === "zod";
  const rules = FORM_TEXT_KINDS.map((k) => ruleLiteral(formTextRule(k))).join("\n");
  const out = [
    "// Auto-generated.  Do not edit by hand.",
    "//",
    "// The parse rule of a form's text inputs: a blank is the field's absence",
    "// (`null` when optional, the kind's zero when required), any other text must",
    "// match the kind's grammar and range or is refused in its field.",
    ...(zod ? [`import { z } from "zod";`] : []),
    ...(host === "angular"
      ? [`import type { AbstractControl, ValidationErrors, ValidatorFn } from "@angular/forms";`]
      : []),
    "",
    `export type FormTextKind = ${FORM_TEXT_KINDS.map((k) => JSON.stringify(k)).join(" | ")};`,
    "",
    "/** Why a text is refused: the wire code the server answers for the same value. */",
    "export interface FormTextRefusal {",
    "  code: string;",
    "  message: string;",
    "  params?: Record<string, number | string>;",
    "}",
    "",
    "export type FormTextOutcome = { ok: true; value: number | string | null } | { ok: false; refusal: FormTextRefusal };",
    "",
    "interface Rule {",
    "  grammar: RegExp;",
    `  wire: "number" | "string";`,
    "  blankZero: number | string;",
    "  range?: { min: number; max: number };",
    "  refusal: FormTextRefusal;",
    "  rangeRefusal?: FormTextRefusal;",
    "}",
    "",
    "const RULES: Record<FormTextKind, Rule> = {",
    rules,
    "};",
    "",
    "/** Parse one input's text.  A number (a seed, a caller's value) is read as",
    " *  the text it spells. */",
    "export function parseFormText(kind: FormTextKind, input: unknown, optional: boolean): FormTextOutcome {",
    "  const rule = RULES[kind];",
    `  const text = input === null || input === undefined ? "" : String(input).trim();`,
    `  if (text === "") return { ok: true, value: optional ? null : rule.blankZero };`,
    "  if (!rule.grammar.test(text)) return refused(rule.refusal, text);",
    `  if (rule.wire === "string") return { ok: true, value: text };`,
    "  const n = Number(text);",
    "  if (rule.range && (n < rule.range.min || n > rule.range.max || !Number.isSafeInteger(n))) {",
    "    return refused(rule.rangeRefusal ?? rule.refusal, text);",
    "  }",
    "  if (!Number.isFinite(n)) return refused(rule.refusal, text);",
    "  return { ok: true, value: n };",
    "}",
    "",
    "/** A refusal of `text`: the text rides as the `value` its message may name. */",
    "function refused(refusal: FormTextRefusal, text: string): FormTextOutcome {",
    "  return { ok: false, refusal: { ...refusal, params: { ...refusal.params, value: text } } };",
    "}",
    "",
    "/** The text an input shows for a held value: a number or a `Decimal` spelled",
    " *  out, a blank for an absent one. */",
    "export function formTextOf(v: unknown): string {",
    `  return v === null || v === undefined ? "" : String(v);`,
    "}",
  ];
  if (zod) {
    out.push(
      "",
      "/** Refuse a text in its field: the refusal's catalog code rides the issue. */",
      "export function refuseFormText(ctx: z.RefinementCtx, refusal: FormTextRefusal): never {",
      "  ctx.addIssue({",
      `    code: "custom",`,
      "    message: refusal.message,",
      `    params: { ${TS_RUNTIME.issueCode}: refusal.code, ...(refusal.params ? { ${TS_RUNTIME.issueValues}: refusal.params } : {}) },`,
      "  });",
      "  return z.NEVER;",
      "}",
      "",
      "const held = z.union([z.string(), z.number()]);",
      "",
      "/** A required number field: its text, parsed by the rule. */",
      `export function formNumber(kind: Exclude<FormTextKind, "money">): z.ZodType<number, string | number> {`,
      "  return held.transform((v, ctx): number => {",
      "    const r = parseFormText(kind, v, false);",
      "    return r.ok ? (r.value as number) : refuseFormText(ctx, r.refusal);",
      "  });",
      "}",
      "",
      "/** An optional number field: a blank is `null`, a key the form does not",
      " *  carry stays absent. */",
      "export function formNumberOpt(",
      `  kind: Exclude<FormTextKind, "money">,`,
      "): z.ZodType<number | null | undefined, string | number | null | undefined> {",
      "  return z",
      "    .union([held, z.null()])",
      "    .transform((v, ctx): number | null => {",
      "      const r = parseFormText(kind, v, true);",
      "      return r.ok ? (r.value as number | null) : refuseFormText(ctx, r.refusal);",
      "    })",
      "    .optional();",
      "}",
      "",
      "/** A list of numbers typed as comma-separated text: each item parsed by the",
      " *  rule, and the list refused at its own field when one item does not parse. */",
      "export function formNumberList(",
      `  kind: Exclude<FormTextKind, "money">,`,
      "): z.ZodType<number[], (string | number)[]> {",
      "  return z.array(held).transform((items, ctx): number[] => {",
      "    const out: number[] = [];",
      "    for (const item of items) {",
      "      const r = parseFormText(kind, item, false);",
      "      if (!r.ok) return refuseFormText(ctx, r.refusal);",
      "      out.push(r.value as number);",
      "    }",
      "    return out;",
      "  });",
      "}",
    );
  }
  if (host === "angular") out.push(...ANGULAR_HALF);
  return `${out.join("\n")}\n`;
}

/** The reactive-forms half: a control holds the typed text, its validator
 *  refuses what the rule refuses (the error key names the refusal's code), and
 *  the submit parses the form's raw value by a plan of its parsed fields. */
const ANGULAR_HALF: readonly string[] = [
  "",
  "/** The control error key a refusal sets. */",
  "export function formTextErrorKey(refusal: FormTextRefusal): string {",
  `  return refusal.code === "field.integer-range" ? "formTextRange" : "formText";`,
  "}",
  "",
  "/** Refuse a control's text (or, for a list, any of its items) by the rule. */",
  "export function formTextValidator(kind: FormTextKind, optional: boolean, list = false): ValidatorFn {",
  "  return (c: AbstractControl): ValidationErrors | null => {",
  "    const items: unknown[] = list ? ((c.value ?? []) as unknown[]) : [c.value];",
  "    for (const item of items) {",
  "      const r = parseFormText(kind, item, optional);",
  "      if (!r.ok) return { [formTextErrorKey(r.refusal)]: r.refusal };",
  "    }",
  "    return null;",
  "  };",
  "}",
  "",
  '/** A parsed field (`[kind, optional]`, a list adds `"list"`), a nested group\'s',
  " *  plan, or a row array's plan (`[rowPlan]`). */",
  "export type FormTextPlan = {",
  `  [field: string]: readonly [FormTextKind, boolean] | readonly [FormTextKind, boolean, "list"] | FormTextPlan | readonly [FormTextPlan];`,
  "};",
  "",
  "function parseLeaf(kind: FormTextKind, optional: boolean, v: unknown): unknown {",
  "  const r = parseFormText(kind, v, optional);",
  "  return r.ok ? r.value : v;",
  "}",
  "",
  "/** The form's raw value with every parsed field turned into its wire value.",
  " *  The validators have refused every text the rule refuses, so each parse",
  " *  here succeeds. */",
  "export function parseFormValue<T = never>(value: unknown, plan: FormTextPlan): T {",
  "  return parseNode(value, plan) as T;",
  "}",
  "",
  "function parseNode(value: unknown, plan: FormTextPlan): unknown {",
  `  if (value === null || typeof value !== "object") return value;`,
  "  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };",
  "  for (const [field, p] of Object.entries(plan)) {",
  "    if (!(field in out)) continue;",
  "    const v = out[field];",
  `    if (Array.isArray(p) && typeof p[0] === "string") {`,
  "      const [kind, optional, list] = p as readonly [FormTextKind, boolean, string?];",
  "      out[field] = list ? ((v ?? []) as unknown[]).map((i) => parseLeaf(kind, false, i)) : parseLeaf(kind, optional, v);",
  "    } else if (Array.isArray(p)) {",
  "      out[field] = Array.isArray(v) ? v.map((row) => parseNode(row, p[0] as FormTextPlan)) : v;",
  "    } else {",
  "      out[field] = parseNode(v, p as FormTextPlan);",
  "    }",
  "  }",
  "  return out;",
  "}",
];

/** Add the imports a schema module's parsed-text fields need, after its zod
 *  import: `formNumber` / `formNumberOpt` from `formTextSpec`, `moneyText` /
 *  `moneyTextOpt` from `schemasSpec`.  Read off the module text, so a module
 *  imports exactly the builders its schemas call. */
export function withFormTextImports(
  src: string,
  formTextSpec: string,
  schemasSpec: string,
): string {
  const used = (name: string) => new RegExp(`\\b${name}\\b`).test(src);
  const lines: string[] = [];
  const numbers = ["formNumber", "formNumberOpt", "formNumberList"].filter((n) =>
    new RegExp(`\\b${n}\\(`).test(src),
  );
  if (numbers.length > 0) lines.push(`import { ${numbers.join(", ")} } from "${formTextSpec}";`);
  const money = ["moneyText", "moneyTextOpt"].filter(used);
  if (money.length > 0) lines.push(`import { ${money.join(", ")} } from "${schemasSpec}";`);
  // A module whose money fields all moved to the form builders no longer reads
  // the read schema; its import goes with it.
  const moneyImport = `import { moneySchema } from "${schemasSpec}";\n`;
  if (src.includes(moneyImport) && (src.match(/\bmoneySchema\b/g) ?? []).length === 1) {
    src = src.replace(moneyImport, "");
  }
  if (lines.length === 0) return src;
  const zodImport = `import { z } from "zod";`;
  if (!src.includes(zodImport))
    throw new Error("withFormTextImports: the module has no zod import");
  return src.replace(zodImport, `${zodImport}\n${lines.join("\n")}`);
}
