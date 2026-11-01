// The Python spelling of the `wirePolicy` fact (`src/ir/enrich/wire-policy.ts`).
// The fact owns every refusal's status, title, fixed detail and sentence; this
// module owns only how a FastAPI emitter writes them as Python source, so every
// python site renders the same refusal the same way.

import {
  errorVariantResponse,
  reasonPhrase,
  type WireRejectionClass,
  wireSentence,
  wireStatus,
} from "../../ir/enrich/wire-policy.js";

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
    `${i}    {${opts.bodyHead}"type": ${JSON.stringify(r.type)}, "title": ${JSON.stringify(r.title)}, "status": ${r.status}, "detail": ${JSON.stringify(r.detail)}, "instance": request.url.path},`,
    `${i}    status_code=${r.status},`,
    `${i}    media_type=${JSON.stringify(r.contentType)},`,
    `${i})`,
  ];
}

const RESOLVED_CLASS: Readonly<Record<string, WireRejectionClass>> = {
  ReferencedInUse: "referenced-in-use",
  DomainError: "domain-floor",
  Forbidden: "forbidden",
  NotFound: "not-found",
};

/** The status resolver `errorStatuses` takes: a stdlib rung name resolved
 *  through the fact's rejection class and the context's `httpStatus` map. */
export function wireStatusResolver(
  overrides?: Readonly<Record<string, number>>,
): (name: string) => number {
  return (name) => {
    const cls = RESOLVED_CLASS[name];
    if (cls === undefined) throw new Error(`wirePolicy: no rejection class for rung '${name}'`);
    return wireStatus(cls, overrides);
  };
}

/** `raise <Exc>(f"<Agg> {<idExpr>} was modified by another request")` — the
 *  optimistic-concurrency 409's sentence (RS-40). */
export function pyConflictRaise(excRef: string, aggName: string, idExpr: string): string {
  return `raise ${excRef}(${pySentence("version-conflict", `${aggName} {${idExpr}}`)})`;
}
