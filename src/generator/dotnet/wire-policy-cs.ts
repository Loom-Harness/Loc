// The C# spelling of the `wirePolicy` fact (`src/ir/enrich/wire-policy.ts`).
// The fact owns every refusal's status, title, fixed detail and sentence; this
// module owns only how an ASP.NET emitter writes them as C# source, so every
// .NET site (EF and Dapper alike) renders the same refusal the same way.

import {
  errorVariantResponse,
  FIND_ABSENT_DETAIL,
  fieldFixedMessage,
  fieldSentenceSuffix,
  fieldValuePrefix,
  type WireRejectionClass,
  wireFixedDetail,
  wireSentence,
  wireStatus,
  wireTitle,
} from "../../ir/enrich/wire-policy.js";

type Overrides = Readonly<Record<string, number>>;

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
