// The Elixir spelling of the `wirePolicy` fact (`src/ir/enrich/wire-policy.ts`).
// The fact owns every refusal's status, title, fixed detail, sentence, field
// message and ingress JSON type; this module owns only how a Phoenix emitter
// writes them as Elixir source, so every elixir site renders the same refusal
// the same way.

import {
  errorVariantCode,
  errorVariantResponse,
  fieldCode,
  fieldFixedMessage,
  fieldSentenceSuffix,
  fieldValuePrefix,
  frameworkReasonPhrase,
  type IngressJsonType,
  ingressFor,
  reasonPhrase,
  type WireRejectionClass,
  wireCode,
  wireFixedDetail,
  wireRejection,
  wireSentence,
  wireStatus,
  wireTitle,
} from "../../ir/enrich/wire-policy.js";
import type { TypeIR } from "../../ir/types/loom-ir.js";
import { wireTypeInfo } from "../../ir/types/wire-types.js";

/** The per-api `httpStatus <Error> -> <Code>` map. */
export type StatusOverrides = Readonly<Record<string, number>> | undefined;

/** An Elixir string literal.  JSON string escapes are valid Elixir ones for the
 *  printable text the fact carries. */
export function exLit(text: string): string {
  return JSON.stringify(text);
}

/** The status a rejection class answers with, as an Elixir integer literal. */
export function exStatus(cls: WireRejectionClass, overrides?: StatusOverrides): number {
  return wireStatus(cls, overrides);
}

/** The `title` a rejection class answers with, as an Elixir string literal. */
export function exTitle(cls: WireRejectionClass, overrides?: StatusOverrides): string {
  return exLit(exTitleText(cls, overrides));
}

/** The `title` text itself, for an emitter that quotes it elsewhere.  The two
 *  routing-tier classes are titled by the framework-fault responder, whose table
 *  also knows 405 (`wireTitle` answers the OpenAPI table's generic `Error`). */
export function exTitleText(cls: WireRejectionClass, overrides?: StatusOverrides): string {
  return ROUTING_CLASSES.has(cls)
    ? frameworkReasonPhrase(wireStatus(cls, overrides))
    : wireTitle(cls, overrides);
}

const ROUTING_CLASSES: ReadonlySet<WireRejectionClass> = new Set([
  "no-route",
  "method-not-allowed",
]);

/** The fixed `detail` of a class, as an Elixir string literal. */
export function exFixedDetail(cls: WireRejectionClass): string {
  return exLit(wireFixedDetail(cls));
}

/** An Elixir string for a sentence detail, the subject given as Elixir string
 *  CONTENT (interpolation allowed):
 *  `exSentence("not-found", "#{kind} #{id}")` → `"#{kind} #{id} not found"`. */
export function exSentence(cls: WireRejectionClass, subject: string): string {
  const { prefix, suffix } = wireSentence(cls);
  const tail = suffix === "" ? "" : ` ${suffix}`;
  return exLit(`${prefix}${subject}${tail}`);
}

/** A class resolved at an already-resolved status.  The emitters that receive
 *  the resolved `httpStatus` rather than the override map read a rung's title
 *  and detail through it, so the title still follows the fact (a class whose
 *  title is its status's reason phrase follows the status; a fixed one does
 *  not). */
export function exRejectionAt(cls: WireRejectionClass, status: number) {
  const base = wireRejection(cls);
  return base.resolves === undefined ? base : wireRejection(cls, { [base.resolves]: status });
}

/** Which rejection class each rung of the denial ladder answers with. */
export type DenialRung = "forbidden" | "precondition" | "disallowed" | "notFound";

export const RUNG_CLASS: Readonly<Record<DenialRung, WireRejectionClass>> = {
  forbidden: "forbidden",
  precondition: "domain-floor",
  disallowed: "state-gate",
  notFound: "not-found",
};

/** `ProblemDetails.problem_response(conn, <status>, <title>, <detail>, <code>)`
 *  for a class — the status and title come from the fact, the `code` is the
 *  class's catalog key (`wireCode`); `detailExpr` is an Elixir expression (a
 *  bound variable, or an already-quoted literal). */
export function exProblemResponse(
  cls: WireRejectionClass,
  detailExpr: string,
  overrides?: StatusOverrides,
  problemModule = "ProblemDetails",
): string {
  return `${problemModule}.problem_response(conn, ${exStatus(cls, overrides)}, ${exTitle(cls, overrides)}, ${detailExpr}, ${exCode(cls)})`;
}

/** The wire `code` of a rejection class, as an Elixir string literal. */
export function exCode(cls: WireRejectionClass): string {
  return exLit(wireCode(cls));
}

/** The wire `code` of a field reason, as an Elixir string literal. */
export function exFieldCode(reason: Parameters<typeof fieldCode>[0]): string {
  return exLit(fieldCode(reason));
}

/** The wire `code` of a declared error variant, as an Elixir string literal. */
export function exErrorVariantCode(ctx: string | undefined, name: string): string {
  return exLit(errorVariantCode(ctx, name));
}

/** The sanitized catch-all for a fault no rung modelled: the 500 with its fixed
 *  `internal` detail, never the fault's own text. */
export function exInternalFallback(problemModule = "ProblemDetails"): string {
  return exProblemResponse("internal", exFixedDetail("internal"), undefined, problemModule);
}

/** The fixed message of a field reason (`malformed-id`, `integer-range`), as an
 *  Elixir string literal. */
export function exFieldMessage(reason: Parameters<typeof fieldFixedMessage>[0]): string {
  return exLit(fieldFixedMessage(reason));
}

/** The text before `: <json value>` in a value-sentence reason. */
export function exValuePrefix(reason: Parameters<typeof fieldValuePrefix>[0]): string {
  return fieldValuePrefix(reason);
}

/** The text after the field name of an absent required field. */
export function exMissingSuffix(): string {
  return fieldSentenceSuffix("missing");
}

/** The HTTP reason phrase of a status — an OpenAPI response `description`. */
export function exReasonPhrase(status: number): string {
  return reasonPhrase(status);
}

/** A declared `error` variant's response, resolved against the api's
 *  `httpStatus` overrides. */
export function exErrorVariant(tag: string, overrides?: StatusOverrides) {
  return errorVariantResponse(tag, overrides);
}

// ---------------------------------------------------------------------------
// Ingress — the JSON type a request field accepts
// ---------------------------------------------------------------------------

/** The Elixir guard accepting exactly the JSON type `ingressFor` names for a
 *  request value.  Ecto's `cast/3` would coerce across JSON types (`"5"` for an
 *  `:integer`, `12.5` for a `:decimal`, `"true"` for a `:boolean`), so a field
 *  whose JSON type the fact names is checked on the raw value first. */
const GUARD: Readonly<Record<Exclude<IngressJsonType, "object" | "any">, string>> = {
  number: "is_integer(v) or is_float(v)",
  string: "is_binary(v)",
  boolean: "is_boolean(v)",
};

/** A request field the controller edge checks, by its wire key. */
export interface StrictIngressField {
  key: string;
  json: Exclude<IngressJsonType, "object" | "any">;
}

/** The fields among `fields` whose Ecto cast is laxer than the fact's ingress:
 *  the scalar primitives (not collections) that name a JSON number, a JSON
 *  string a number could be coerced into (`money`), or a JSON boolean. */
export function strictIngressFields(
  fields: readonly { name: string; type: TypeIR }[],
): StrictIngressField[] {
  const out: StrictIngressField[] = [];
  for (const f of fields) {
    const info = wireTypeInfo(f.type, "request");
    if (info.refKind !== "primitive" || info.isCollection || info.primitive === undefined) continue;
    const p = info.primitive;
    if (p !== "int" && p !== "long" && p !== "decimal" && p !== "money" && p !== "bool") continue;
    const json = ingressFor(p).json;
    if (json === "object" || json === "any") continue;
    out.push({ key: f.name, json });
  }
  return out;
}

/** The Elixir `case` clauses of `ProblemDetails.type_mismatch?/2`, one per JSON
 *  type a field can be pinned to. */
export function exIngressGuardClauses(): string {
  return (Object.keys(GUARD) as (keyof typeof GUARD)[])
    .map((json) => `  defp json_type_ok?("${json}", v), do: ${GUARD[json]}`)
    .join("\n");
}
