// The Java spelling of the `wirePolicy` fact (`src/ir/enrich/wire-policy.ts`).
// The fact owns every refusal's status, title, fixed detail and sentence; this
// module owns only how a Spring emitter writes them as Java source, so every
// java site renders the same refusal the same way.

import {
  errorVariantResponse,
  fieldSentenceSuffix,
  type IngressJsonType,
  ingressFor,
  type WireRejectionClass,
  wireSentence,
} from "../../ir/enrich/wire-policy.js";
import type { WirePrimitive } from "../../ir/types/wire-types.js";

/** A Java string literal.  JSON string escapes are valid Java ones for the
 *  printable text the fact carries. */
export function javaLit(text: string): string {
  return JSON.stringify(text);
}

/** A Java string-concatenation expression for a sentence detail, the subject
 *  given as a Java EXPRESSION:
 *  `javaSentence("not-found", '"Order " + id')` → `"Order " + id + " not found"`. */
export function javaSentence(cls: WireRejectionClass, subjectExpr: string): string {
  const { prefix, suffix } = wireSentence(cls);
  return [
    prefix === "" ? null : javaLit(prefix),
    subjectExpr,
    suffix === "" ? null : javaLit(` ${suffix}`),
  ]
    .filter((p): p is string => p !== null)
    .join(" + ");
}

/** The Java expression for an absent required field's `errors[].message`:
 *  `"<field> is required"`, the field being the last key of the RFC 6901
 *  `pointerExpr`.  `lastKey` is the advice's helper. */
export function javaMissingFieldMessage(pointerExpr: string): string {
  return `lastKey(${pointerExpr}) + ${javaLit(` ${fieldSentenceSuffix("missing")}`)}`;
}

/** The lines answering a declared `error` variant (RS-19/RS-30):
 *  `application/problem+json` at its mapped status, its `/errors/<kebab>`
 *  type, its humanized name as title and detail, `props` as extension members.
 *  `emit` finishes the arm (`yield …` / `return …`). */
export function javaErrorVariantLines(opts: {
  tag: string;
  overrides?: Readonly<Record<string, number>>;
  problemType: string;
  mediaType: string;
  indent: string;
  /** Java statements (no indent) adding extension members to `problem`. */
  props?: readonly string[];
  emit: "yield" | "return";
}): string[] {
  const r = errorVariantResponse(opts.tag, opts.overrides);
  const i = opts.indent;
  return [
    `${i}var problem = ${opts.problemType}.forStatus(${r.status});`,
    `${i}problem.setTitle(${javaLit(r.title)});`,
    `${i}problem.setType(URI.create(${javaLit(r.type)}));`,
    `${i}problem.setDetail(${javaLit(r.detail)});`,
    ...(opts.props ?? []).map((p) => `${i}${p}`),
    `${i}${opts.emit} ResponseEntity.status(${r.status}).contentType(${opts.mediaType}.APPLICATION_PROBLEM_JSON).body(problem);`,
  ];
}

// ---------------------------------------------------------------------------
// Ingress — Jackson's coercion table, derived from `ingressFor`
// ---------------------------------------------------------------------------

/** The Jackson `LogicalType` that deserializes a request field of each wire
 *  primitive.  A primitive absent here is bound by a dedicated deserializer
 *  (uuid, dates, json, File) that has no scalar coercion to switch off. */
const JACKSON_LOGICAL_TYPE: Partial<Record<WirePrimitive, string>> = {
  int: "Integer",
  long: "Integer",
  decimal: "Float",
  money: "Textual",
  string: "Textual",
  bool: "Boolean",
};

/** The scalar JSON shapes (`CoercionInputShape`) a field refuses: every shape
 *  that is not the JSON type `ingressFor` accepts.  A JSON number is both
 *  `Integer` and `Float`; `Boolean` into a numeric slot is already a type
 *  error in Jackson, so a number slot lists only the `String` shape. */
function rejectedShapes(json: IngressJsonType): string[] {
  switch (json) {
    case "number":
      return ["String"];
    case "string":
      return ["Integer", "Float", "Boolean"];
    case "boolean":
      return ["String", "Integer", "Float"];
    default:
      return [];
  }
}

/** One `withCoercionConfig` group per Jackson logical type: the shapes to
 *  `Fail`, in a stable order.  A logical type shared by two primitives
 *  (`Integer`: int/long; `Textual`: string/money) must agree on the shapes. */
export function javaIngressCoercions(): { logical: string; reject: string[] }[] {
  const out = new Map<string, string[]>();
  for (const p of Object.keys(JACKSON_LOGICAL_TYPE) as WirePrimitive[]) {
    const logical = JACKSON_LOGICAL_TYPE[p]!;
    const reject = rejectedShapes(ingressFor(p).json);
    const prev = out.get(logical);
    if (prev && prev.join() !== reject.join())
      throw new Error(`wirePolicy: java logical type '${logical}' has two ingress rules`);
    out.set(logical, reject);
  }
  return [...out].map(([logical, reject]) => ({ logical, reject }));
}
