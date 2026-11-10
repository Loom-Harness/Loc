// The C# spelling of the `wirePolicy` fact (`src/ir/enrich/wire-policy.ts`).
// The fact owns every refusal's status, title, fixed detail and sentence; this
// module owns only how an ASP.NET emitter writes them as C# source, so every
// .NET site (EF and Dapper alike) renders the same refusal the same way.

import {
  aggregateProblemParams,
  errorVariantCode,
  errorVariantResponse,
  FIND_ABSENT_DETAIL,
  fieldFixedMessage,
  fieldSentenceSuffix,
  fieldValuePrefix,
  type WireRejectionClass,
  wireCode,
  wireFixedDetail,
  wireParams,
  wireSentence,
  wireStatus,
  wireTitle,
} from "../../ir/enrich/wire-policy.js";
import type { ExprIR } from "../../ir/types/loom-ir.js";
import { ruleParamRefs } from "../../ir/util/rule-params.js";

type Overrides = Readonly<Record<string, number>>;

/** The wire `code` of a rejection class, as a C# string literal. */
export function csCode(cls: WireRejectionClass): string {
  return csLit(wireCode(cls));
}

/** The C# dictionary literal carrying the VALUES of the identifiers `rule`
 *  reads (`ruleParamRefs`) — a named rule's wire `params` — or undefined when
 *  it reads none.  `render` spells one reference at the throw site. */
export function csRuleParams(
  rule: { expr: ExprIR; guard?: ExprIR },
  render: (e: ExprIR) => string,
): string | undefined {
  const refs = ruleParamRefs(rule);
  if (refs.length === 0) return undefined;
  return `new System.Collections.Generic.Dictionary<string, object?> { ${refs
    .map(({ name, ref }) => `[${csLit(name)}] = ${render(ref)}`)
    .join(", ")} }`;
}

/** The `Extensions = { ["code"] = … }` initializer member of a problem body
 *  for a rejection class — the catalog key a client localizes it by.  With
 *  `typeKey` (a refusal answered for one aggregate), a class that carries
 *  `params.type` gets it too. */
export function csCodeInit(cls: WireRejectionClass, typeKey?: string): string {
  const params = typeKey === undefined ? undefined : aggregateProblemParams(cls, typeKey);
  const paramsInit =
    params === undefined
      ? ""
      : `, ["params"] = new System.Collections.Generic.Dictionary<string, object?> { ${Object.entries(
          params,
        )
          .map(([k, v]) => `[${csLit(k)}] = ${csLit(v)}`)
          .join(", ")} }`;
  return `Extensions = { ["code"] = ${csCode(cls)}${paramsInit} }`;
}

/** The members of an app-wide exception filter that read the aggregate a
 *  request addresses off its path (`/api/<segment>/…`) — the `[segment,
 *  params.type]` table (`aggregateRouteTypes`) and `TypeParams(context)`,
 *  which answers `{ ["type"] = … }` or null for a route of no aggregate. */
export function csAggregateTypeParamsMembers(
  routeTypes: readonly (readonly [string, string])[],
): string {
  return `    // The aggregate each \`/api/<segment>\` route serves: a refusal answered for
    // one carries its identity key as \`params.type\`.
    private static readonly System.Collections.Generic.Dictionary<string, string> AggregateTypes = new()
    {
${routeTypes.map(([seg, type]) => `        [${csLit(seg)}] = ${csLit(type)},`).join("\n")}
    };

    private static System.Collections.Generic.Dictionary<string, object?>? TypeParams(ExceptionContext context)
    {
        var segments = (context.HttpContext.Request.Path.Value ?? "").Split('/', System.StringSplitOptions.RemoveEmptyEntries);
        var at = segments.Length > 0 && segments[0] == "api" ? 1 : 0;
        return segments.Length > at && AggregateTypes.TryGetValue(segments[at], out var type)
            ? new System.Collections.Generic.Dictionary<string, object?> { ["type"] = type }
            : null;
    }
`;
}

/** The trailing `params` argument of an app-wide filter's `Problem(…)` call
 *  for `cls`: `, TypeParams(context)` for a class that carries `params.type`
 *  (when the filter has the table), else nothing. */
export function csTypeParamsArg(cls: WireRejectionClass, hasTable: boolean): string {
  return hasTable && wireParams(cls).includes("type") ? ", TypeParams(context)" : "";
}

/** Statements giving the ProblemDetails local `problemVar` a DECLARED error
 *  variant's `code` (`<Ctx>.<Error>.message`) and its record fields as
 *  `params` (left out for a record with none).  `fields` pairs each wire key
 *  with the C# accessor of its value. */
export function csErrorVariantExt(
  ctx: { readonly name: string },
  tag: string,
  problemVar: string,
  fields: readonly { readonly json: string; readonly accessor: string }[],
  indent: string,
): string[] {
  const out = [
    `${indent}${problemVar}.Extensions["code"] = ${csLit(errorVariantCode(ctx.name, tag))};`,
  ];
  if (fields.length > 0) {
    out.push(
      `${indent}${problemVar}.Extensions["params"] = new System.Collections.Generic.Dictionary<string, object?> { ${fields
        .map((f) => `[${csLit(f.json)}] = ${f.accessor}`)
        .join(", ")} };`,
    );
  }
  return out;
}

/** A C# string literal.  JSON string escapes are valid C# escapes for the
 *  printable text the fact carries. */
export function csLit(text: string): string {
  return JSON.stringify(text);
}

/** The `title` of a rejection class, as a C# string literal. */
export function csTitle(cls: WireRejectionClass, overrides?: Overrides): string {
  return csLit(wireTitle(cls, overrides));
}

/** The fixed `detail` of a rejection class, as a C# string literal. */
export function csFixedDetail(cls: WireRejectionClass): string {
  return csLit(wireFixedDetail(cls));
}

/** A C# interpolated string for a sentence detail, the subject given as
 *  interpolated-string CONTENT (`{id}`): `csSentence("not-found", "Order {id}")`
 *  → `$"Order {id} not found"`. */
export function csSentence(cls: WireRejectionClass, subject: string): string {
  const { prefix, suffix } = wireSentence(cls);
  const tail = suffix === "" ? "" : ` ${suffix}`;
  // Not escaped: the subject is C# interpolation content (it may hold quoted
  // sub-expressions), and the fact's own sentence text carries no `"` or `\`.
  return `$"${prefix}${subject}${tail}"`;
}

/** `new AggregateNotFoundException($"<subject> not found")` — the by-id read's
 *  absence (RS-27).  `subject` is interpolated-string content; `ns` qualifies
 *  the exception type when the call site has no `using` for it. */
export function csNotFoundException(ns: string | null, subject: string): string {
  const type =
    ns === null
      ? "AggregateNotFoundException"
      : `global::${ns}.Domain.Common.AggregateNotFoundException`;
  return `new ${type}(${csSentence("not-found", subject)})`;
}

/** `new AggregateNotFoundException("not_found")` — a FIND's absence: the
 *  machine token, deliberately not the by-id sentence (RS-27 scope). */
export function csFindAbsentException(ns: string | null = null): string {
  const type =
    ns === null
      ? "AggregateNotFoundException"
      : `global::${ns}.Domain.Common.AggregateNotFoundException`;
  return `new ${type}(${csLit(FIND_ABSENT_DETAIL)})`;
}

/** `[ProducesResponseType(typeof(ProblemDetails), <status>)]` for an
 *  already-resolved status. */
function csProducesStatus(status: number, indent = "    "): string {
  return `${indent}[ProducesResponseType(typeof(ProblemDetails), ${status})]`;
}

/** The same attribute for a rejection class, at the status the fact resolves. */
export function csProducesProblem(
  cls: WireRejectionClass,
  overrides?: Overrides,
  indent = "    ",
): string {
  return csProducesStatus(wireStatus(cls, overrides), indent);
}

/** The `ProblemDetails` initializer of a `field-invalid` refusal (RS-29):
 *  about:blank, the validation-failed title and detail, 422.  `instanceExpr`
 *  is the C# expression for `Instance`.  The first line carries no indent. */
export function csFieldInvalidProblem(
  instanceExpr: string,
  indent: string,
  variable?: string,
): string {
  const head =
    variable === undefined ? "new ProblemDetails" : `var ${variable} = new ProblemDetails`;
  return [
    head,
    `{`,
    `    Type = "about:blank",`,
    `    Title = ${csTitle("field-invalid")},`,
    `    Status = ${wireStatus("field-invalid")},`,
    `    Detail = ${csFixedDetail("field-invalid")},`,
    `    Instance = ${instanceExpr},`,
    `    ${csCodeInit("field-invalid")},`,
    `};`,
  ]
    .map((l, i) => (i === 0 ? l : `${indent}${l}`))
    .join("\n");
}

/** `new ObjectResult(<problemExpr>) { StatusCode = …, ContentTypes = … }` at a
 *  status the fact resolved.  The first line carries no indent. */
function csObjectResult(problemExpr: string, status: number, indent: string): string {
  return [
    `new ObjectResult(${problemExpr})`,
    `{`,
    `    StatusCode = ${status},`,
    `    ContentTypes = { "application/problem+json" },`,
    `}`,
  ]
    .map((l, i) => (i === 0 ? l : `${indent}${l}`))
    .join("\n");
}

/** The `field-invalid` refusal's `ObjectResult`. */
export function csFieldInvalidResult(problemExpr: string, indent: string): string {
  return csObjectResult(problemExpr, wireStatus("field-invalid"), indent);
}

/** The text after the field name in the absent-required-field message
 *  (`"<field> is required"`), as a C# string literal with its leading space. */
export function csMissingSuffixLit(): string {
  return csLit(` ${fieldSentenceSuffix("missing")}`);
}

/** The `errors[].message` of a value of the wrong JSON type for its field
 *  (`type-mismatch`).  The fact leaves this wording to each framework; the
 *  framework's own sentence names an internal CLR type, so .NET sends this. */
export function csTypeMismatchMessage(): string {
  return "Invalid value";
}

/** The refusal message of a body `X id` that is not a uuid (`malformed-id`). */
export function csMalformedIdMessage(): string {
  return fieldFixedMessage("malformed-id");
}

/** The refusal message of an `int` literal outside int32 (RS-42). */
export function csIntegerRangeMessage(): string {
  return fieldFixedMessage("integer-range");
}

/** The refusal message of a `money` value whose integer part overflows the column. */
export function csMoneyRangeMessage(): string {
  return fieldValuePrefix("money-range");
}

const RESOLVED_CLASS: Readonly<Record<string, WireRejectionClass>> = {
  ReferencedInUse: "referenced-in-use",
  DomainError: "domain-floor",
  Forbidden: "forbidden",
  NotFound: "not-found",
  Disallowed: "state-gate",
  UniquenessConflict: "unique-conflict",
  ConcurrencyConflict: "version-conflict",
};

/** The status resolver `errorStatuses` takes: a stdlib rung name resolved
 *  through the fact's rejection class and the context's `httpStatus` map. */
export function wireStatusResolver(overrides?: Overrides): (name: string) => number {
  return (name) => {
    const cls = RESOLVED_CLASS[name];
    // A name with no rejection class is a declared `error` variant: its status
    // is the fact's variant mapping (the override, else the stdlib default).
    return cls === undefined
      ? errorVariantResponse(name, overrides).status
      : wireStatus(cls, overrides);
  };
}
