// The Python spelling of the `wirePolicy` fact (`src/ir/enrich/wire-policy.ts`).
// The fact owns every refusal's status, title, fixed detail and sentence; this
// module owns only how a FastAPI emitter writes them as Python source, so every
// python site renders the same refusal the same way.

import {
  errorVariantCode,
  errorVariantResponse,
  reasonPhrase,
  type WireRejectionClass,
  wireSentence,
  wireStatus,
} from "../../ir/enrich/wire-policy.js";
import type { BoundedContextIR, ExprIR } from "../../ir/types/loom-ir.js";
import { ruleParamRefs } from "../../ir/util/rule-params.js";

/** A Python f-string for a sentence detail, the subject given as f-string
 *  CONTENT (`{id}`): `pySentence("not-found", "Order {id}")` →
 *  `f"Order {id} not found"`. */
export function pySentence(cls: WireRejectionClass, subject: string): string {
  const { prefix, suffix } = wireSentence(cls);
  const tail = suffix === "" ? "" : ` ${suffix}`;
  return `f${JSON.stringify(`${prefix}${subject}${tail}`)}`;
}

/** `raise <Exc>(f"<Agg> {id} not found")` — the by-id read's absence (RS-27).
 *  `idExpr` is the Python expression holding the id. */
export function pyNotFoundRaise(excRef: string, aggName: string, idExpr: string): string {
  return `raise ${excRef}(${pySentence("not-found", `${aggName} {${idExpr}}`)})`;
}

/** One OpenAPI `responses={…}` entry for a problem status:
 *  `404: {"model": ProblemDetails, "description": "Not Found"}`. */
export function pyProblemResponseEntry(status: number, problemDetailsRef: string): string {
  return `${status}: {"model": ${problemDetailsRef}, "description": ${JSON.stringify(reasonPhrase(status))}}`;
}

/** The `return JSONResponse({...problem...}, status_code=…)` lines answering a
 *  declared `error` variant (RS-19/RS-30): `application/problem+json` at its
 *  mapped status, its `/errors/<kebab>` type, its humanized name as title and
 *  detail.  `bodyHead` is Python dict content placed before the problem members
 *  (`**result, ` or a `"resource": …, ` extension). */
export function pyErrorVariantReturn(opts: {
  ctx: Pick<BoundedContextIR, "name" | "payloads">;
  /** Spells one field of the error record (`result["available"]`). */
  fieldValue: (field: string) => string;
  tag: string;
  overrides?: Readonly<Record<string, number>>;
  jsonResponseRef: string;
  bodyHead: string;
  indent: string;
}): string[] {
  const r = errorVariantResponse(opts.tag, opts.overrides);
  const i = opts.indent;
  return [
    `${i}return ${opts.jsonResponseRef}(`,
    `${i}    {${opts.bodyHead}"type": ${JSON.stringify(r.type)}, "title": ${JSON.stringify(r.title)}, "status": ${r.status}, "detail": ${JSON.stringify(r.detail)}, "instance": request.url.path, ${pyErrorVariantExt(opts.ctx, opts.tag, opts.fieldValue)}},`,
    `${i}    status_code=${r.status},`,
    `${i}    media_type=${JSON.stringify(r.contentType)},`,
    `${i})`,
  ];
}

/** `raise <Exc>(f"<Agg> {<idExpr>} was modified by another request")` — the
 *  optimistic-concurrency 409's sentence (RS-40). */
export function pyConflictRaise(excRef: string, aggName: string, idExpr: string): string {
  return `raise ${excRef}(${pySentence("version-conflict", `${aggName} {${idExpr}}`)})`;
}

/** The `"code": …, "params": {…}` members of a DECLARED error variant's problem
 *  body, as Python dict content: its `<Ctx>.<Error>.message` code and the error
 *  record's own fields as `params` (left out for a record with none). */
function pyErrorVariantExt(
  ctx: Pick<BoundedContextIR, "name" | "payloads">,
  tag: string,
  fieldValue: (field: string) => string,
): string {
  const payload = ctx.payloads.find((p) => p.name === tag && p.kind === "error");
  const code = `"code": ${JSON.stringify(errorVariantCode(ctx.name, tag))}`;
  const fields = payload?.fields ?? [];
  if (fields.length === 0) return code;
  const params = fields.map((f) => `${JSON.stringify(f.name)}: ${fieldValue(f.name)}`).join(", ");
  return `${code}, "params": {${params}}`;
}

/** The Python dict literal carrying the VALUES of the identifiers `rule` reads
 *  (`ruleParamRefs`) — a named rule's wire `params` — or undefined when it
 *  reads none.  `render` spells one reference at the raise site. */
export function pyRuleParams(
  rule: { expr: ExprIR; guard?: ExprIR },
  render: (e: ExprIR) => string,
): string | undefined {
  const refs = ruleParamRefs(rule);
  if (refs.length === 0) return undefined;
  return `{${refs.map(({ name, ref }) => `${JSON.stringify(name)}: ${render(ref)}`).join(", ")}}`;
}
