// The TypeScript spelling of the `wirePolicy` fact's sentences
// (`src/ir/enrich/wire-policy.ts`).  The fact owns the words; this module owns
// only how a node/Hono emitter interpolates a runtime subject into them, so
// every node site renders the same sentence the same way.

import {
  errorVariantCode,
  type WireRejectionClass,
  wireSentence,
} from "../../ir/enrich/wire-policy.js";
import type { BoundedContextIR, ExprIR } from "../../ir/types/loom-ir.js";
import { ruleParamRefs } from "../../ir/util/rule-params.js";

/** A TypeScript template literal for a sentence detail, the subject given as
 *  template-literal CONTENT (`Order \${id}`):
 *  `tsSentence("not-found", "Order \${id}")` → `` `Order ${id} not found` ``. */
export function tsSentence(cls: WireRejectionClass, subject: string): string {
  const { prefix, suffix } = wireSentence(cls);
  const tail = suffix === "" ? "" : ` ${suffix}`;
  return `\`${prefix}${subject}${tail}\``;
}

/** `throw new AggregateNotFoundError(`<Agg> ${id} not found`);` — the by-id
 *  read's absence (RS-27).  `idExpr` is the TS expression holding the id. */
export function tsNotFoundThrow(aggName: string, idExpr: string): string {
  return `throw new AggregateNotFoundError(${tsSentence("not-found", `${aggName} \${${idExpr}}`)});`;
}

/** The TS object literal carrying the VALUES of the identifiers `rule` reads
 *  (`ruleParamRefs`) — a named rule's wire `params` — or undefined when it
 *  reads none.  `render` spells one reference at the throw site. */
export function tsRuleParams(
  rule: { expr: ExprIR; guard?: ExprIR },
  render: (e: ExprIR) => string,
): string | undefined {
  const refs = ruleParamRefs(rule);
  if (refs.length === 0) return undefined;
  return `{ ${refs.map(({ name, ref }) => `${JSON.stringify(name)}: ${render(ref)}`).join(", ")} }`;
}

/** The `code` / `params` extension members of a DECLARED error variant's
 *  problem body, as TS object-literal entries:
 *  `code: "<Ctx>.<Error>.message", params: { available: v.available }`.
 *  `fieldValue` spells one of the error record's fields; `params` is left out
 *  for a record with none. */
export function tsErrorVariantExt(
  ctx: Pick<BoundedContextIR, "name" | "payloads">,
  tag: string,
  fieldValue: (field: string) => string,
): string {
  const payload = ctx.payloads.find((p) => p.name === tag && p.kind === "error");
  const code = `code: ${JSON.stringify(errorVariantCode(ctx.name, tag))}`;
  const fields = payload?.fields ?? [];
  if (fields.length === 0) return code;
  const params = fields.map((f) => `${JSON.stringify(f.name)}: ${fieldValue(f.name)}`).join(", ");
  return `${code}, params: { ${params} }`;
}
