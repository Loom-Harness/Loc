// ---------------------------------------------------------------------------
// Shared Pydantic wire-constraint carriers.  Both the aggregate command DTOs
// (`routes-builder.ts`) and the value-object wire models (`http-models.ts`)
// build the SAME two carriers from a set of invariants: a `Field(...)`
// constraint for single-field shapes, and a `@model_validator` refine for the
// cross-field / guarded / messaged rest.  A violation of either surfaces as a
// FastAPI 422 (not the domain's `DomainError` → 400), so a malformed value is
// rejected at the wire with the validation status.  Kept here (not in
// routes-builder) so http-models can reuse it without a `routes-builder ↔
// http-models` import cycle.
// ---------------------------------------------------------------------------

import type { InvariantIR } from "../../../ir/types/loom-ir.js";
import {
  classifyForWire,
  pickErrorPath,
  type SingleFieldPattern,
  singleFieldConstraints,
  singleFieldShape,
} from "../../../ir/validate/invariant-classify.js";
import { lines } from "../../../util/code-builder.js";
import { messageCode } from "../../../util/message-code.js";
import { pythonWireIdent, pythonWireNeedsAlias } from "../../../util/naming.js";
import { pyRef } from "../../_imports/python.js";
import { singleFieldMessage } from "../../zod-refine.js";
import { renderPyExpr, renderPyNegatedGuard } from "../render-expr.js";

// The pydantic carriers, written as `ref()` markers — the importing module's
// block derives from whichever survive into its text.
const FIELD = pyRef("pydantic", "Field");
const FIELD_VALIDATOR = pyRef("pydantic", "field_validator");
const MODEL_VALIDATOR = pyRef("pydantic", "model_validator");
const VALIDATION_ERROR = pyRef("pydantic", "ValidationError");
const VALIDATION_INFO = pyRef("pydantic", "ValidationInfo");
const WRAP_HANDLER = pyRef("pydantic", "ValidatorFunctionWrapHandler");
const INIT_ERROR_DETAILS = pyRef("pydantic_core", "InitErrorDetails");
const PYDANTIC_CUSTOM_ERROR = pyRef("pydantic_core", "PydanticCustomError");

/** One `Field(...)` kwarg plus the wire message its violation answers — the
 *  one node sends for the rule that produced it. */
interface FieldKwarg {
  kw: string;
  message: string;
}

/** Map of `field → Field(...)` constraint string for every single-field,
 *  message-less invariant over one of `available`.  Multiple constraints
 *  on one field (e.g. `email.matches(r) && email.length <= 120`) become a
 *  single `Field(pattern=, max_length=)`. */
export function createFieldConstraints(
  invariants: InvariantIR[],
  available: ReadonlySet<string>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [field, kwargs] of fieldKwargs(invariants, available)) {
    out.set(field, `${FIELD}(${kwargs.map((k) => k.kw).join(", ")})`);
  }
  return out;
}

/** The Pydantic error `type`s a `Field(...)` kwarg denies with.  `min_length` /
 *  `max_length` answer `string_too_*` on a string and `too_*` on a sequence. */
const KWARG_ERROR_TYPES: Readonly<Record<string, readonly string[]>> = {
  ge: ["greater_than_equal"],
  gt: ["greater_than"],
  le: ["less_than_equal"],
  lt: ["less_than"],
  min_length: ["string_too_short", "too_short"],
  max_length: ["string_too_long", "too_long"],
  pattern: ["string_pattern_mismatch"],
};

/** A `@field_validator(..., mode="wrap")` that re-words the `Field(...)`
 *  constraint violations `createFieldConstraints` arms with the SAME
 *  sentence node's zod schema denies with — the synthesized
 *  `singleFieldMessage` (e.g. "Billing Email is not in the expected format")
 *  for a shape node chains natively, else node's refine default — ruling D10
 *  (#15d).
 *  Before it a message-less rule answered Pydantic's default text, which for a
 *  `pattern=` leaked the regex onto the wire (`String should match pattern
 *  '^[^@]+@…'`) and diverged from node for every other shape too.
 *
 *  The table is per MODEL (one field name can carry different bounds on two
 *  request DTOs) and keyed by `(field, pydantic error type)`, so only the
 *  constraint errors this table arms are re-worded: a type error
 *  (`string_type`, `int_parsing`) or a nested model's own error (non-empty
 *  relative `loc`) re-raises untouched.  The re-raise keeps the Pydantic
 *  `type` — no `msg.` prefix — so the 422 handler still omits `errors[].code`,
 *  exactly as node omits it for a message-less rule.  `null` when no field
 *  carries a constraint. */
export function createFieldMessageValidator(
  invariants: InvariantIR[],
  available: ReadonlySet<string>,
): string | null {
  const table = fieldKwargs(invariants, available);
  if (table.size === 0) return null;
  const entries: string[] = [];
  for (const [field, kwargs] of table) {
    for (const { kw, message } of kwargs) {
      for (const type of KWARG_ERROR_TYPES[kw.slice(0, kw.indexOf("="))] ?? []) {
        entries.push(
          `                (${JSON.stringify(pythonWireIdent(field))}, ${JSON.stringify(type)}): ${JSON.stringify(message)},`,
        );
      }
    }
  }
  // Pydantic names a field by its python ATTRIBUTE (`lambda_`), never its
  // wire alias (`lambda`) — both in the decorator and in `info.field_name`.
  const fields = [...table.keys()].map((f) => JSON.stringify(pythonWireIdent(f))).join(", ");
  return lines(
    "",
    `    @${FIELD_VALIDATOR}(${fields}, mode="wrap")`,
    "    @classmethod",
    "    def _wire_messages(",
    `        cls, value: object, handler: ${WRAP_HANDLER}, info: ${VALIDATION_INFO}`,
    "    ) -> object:",
    "        try:",
    "            return handler(value)",
    `        except ${VALIDATION_ERROR} as err:`,
    "            messages: dict[tuple[str, str], str] = {",
    ...entries,
    "            }",
    "            for e in err.errors():",
    '                hit = messages.get((info.field_name or "", e["type"]))',
    '                if hit is not None and not e["loc"]:',
    `                    raise ${PYDANTIC_CUSTOM_ERROR}(e["type"], hit) from None`,
    "            raise",
  );
}

/** Per field, the `Field(...)` kwargs every single-field, message-less
 *  invariant over one of `available` contributes — the one source both
 *  `createFieldConstraints` (the check) and `createFieldMessageValidator` (its
 *  wire message) read, so the two cannot disagree on which bound applies. */
function fieldKwargs(
  invariants: InvariantIR[],
  available: ReadonlySet<string>,
): Map<string, FieldKwarg[]> {
  const byField = new Map<string, Array<{ pattern: SingleFieldPattern; message: string }>>();
  for (const inv of invariants) {
    if (!classifyForWire(inv, { available })) continue;
    // A messaged rule carries author text, so it routes through the
    // `@model_validator` refine carrier (which has a message slot) rather
    // than a native `Field(...)` constraint (whose message is Pydantic's
    // default) — mirroring the .NET/Hono carriers.
    if (inv.message) continue;
    const cons = singleFieldConstraints(inv);
    if (!cons) continue;
    // The message node sends for this rule.  Node classifies the WHOLE
    // invariant (`singleFieldShape`, as `takeSingleFieldChain` does): a
    // recognised compound like `seats >= 1 && seats <= 500` is ONE `between`
    // with one sentence, even though Pydantic needs it as two kwargs.  A
    // conjunction node does not recognise (`email.matches(r) && email.length
    // <= 120`) is a zod `.refine` carrying the derived default instead.
    const shape = singleFieldShape(inv);
    const message = shape
      ? singleFieldMessage(shape.field, shape.pattern)
      : `Invariant violated: ${inv.source}`;
    for (const { field, pattern } of cons) {
      if (!available.has(field)) continue;
      byField.set(field, [...(byField.get(field) ?? []), { pattern, message }]);
    }
  }
  const out = new Map<string, FieldKwarg[]>();
  for (const [field, patterns] of byField) {
    const kwargs: FieldKwarg[] = [];
    const seen = new Set<string>();
    for (const { pattern, message } of patterns) {
      for (const kw of pydanticKwargs(pattern)) {
        const key = kw.slice(0, kw.indexOf("="));
        if (seen.has(key)) continue; // first constraint wins on a duplicate key
        seen.add(key);
        kwargs.push({ kw, message });
      }
    }
    if (kwargs.length > 0) out.set(field, kwargs);
  }
  return out;
}

function pydanticKwargs(p: SingleFieldPattern): string[] {
  switch (p.kind) {
    case "min":
      // Exclusive (`weight > 0.5` on a decimal/money field) → pydantic's `gt=`;
      // inclusive keeps `ge=`.
      return [p.exclusive ? `gt=${p.n}` : `ge=${p.n}`];
    case "max":
      return [p.exclusive ? `lt=${p.n}` : `le=${p.n}`];
    case "between":
      return [`ge=${p.lo}`, `le=${p.hi}`];
    case "len-min":
      return [`min_length=${p.n}`];
    case "len-max":
      return [`max_length=${p.n}`];
    case "len-eq":
      return [`min_length=${p.n}`, `max_length=${p.n}`];
    case "len-range":
      return [`min_length=${p.lo}`, `max_length=${p.hi}`];
    case "regex":
      return [`pattern=${pyRawRegex(p.pattern)}`];
  }
}

/** Render a regex source as a Python raw-string literal (backslashes are
 *  regex escapes, not string escapes).  Falls back to a JSON string only if
 *  the source contains both quote kinds (regexes effectively never do). */
function pyRawRegex(src: string): string {
  if (!src.includes('"')) return `r"${src}"`;
  if (!src.includes("'")) return `r'${src}'`;
  return JSON.stringify(src);
}

/** Splice a derived `Field(...)` onto a request-field declaration, folding any
 *  existing default (`= None` / `= False`) into `Field(default=…, …)` so the
 *  field's optionality is preserved.
 *
 *  `name` is the WIRE name.  A wire name that is a python keyword (`def`)
 *  cannot be the attribute, so the attribute is the escaped
 *  `pythonWireIdent` spelling (`def_`) and the wire key is kept by an
 *  explicit `alias="def"` folded into the same `Field(...)` (eval item 6,
 *  ruling D2).  Every other name is byte-identical. */
export function withFieldConstraint(
  name: string,
  decl: string,
  fieldExpr: string | undefined,
): string {
  const attr = pythonWireIdent(name);
  const alias = pythonWireNeedsAlias(name) ? `alias=${JSON.stringify(name)}` : null;
  const expr = alias
    ? fieldExpr
      ? `${FIELD}(${fieldExpr.slice(`${FIELD}(`.length, -1)}, ${alias})`
      : `${FIELD}(${alias})`
    : fieldExpr;
  if (!expr) return `    ${attr}: ${decl}`;
  const eq = decl.indexOf(" = ");
  if (eq === -1) return `    ${attr}: ${decl} = ${expr}`;
  const type = decl.slice(0, eq);
  const dflt = decl.slice(eq + 3);
  const inner = expr.slice(`${FIELD}(`.length, -1);
  return `    ${attr}: ${type} = ${FIELD}(default=${dflt}, ${inner})`;
}

/** A Pydantic `@model_validator(mode="after")` enforcing the wire-scoped
 *  invariants that are NOT single-field shapes (cross-field comparisons like
 *  `handle != email`, or guarded predicates) — the refine fallback the other
 *  backends emit (Hono's `.refine`, Phoenix's `validate fn`).  Single-field
 *  invariants are handled by `Field(...)` constraints; this raises ValueError
 *  → FastAPI 422 for the rest, so a violation surfaces as 422 (not the
 *  domain's DomainError → 400).  Predicates render against the request DTO's
 *  verbatim camelCase fields (`self.handle`). */
export function createModelValidator(
  invariants: InvariantIR[],
  available: ReadonlySet<string>,
  cls: string,
): string | null {
  const refines = invariants.filter(
    (inv) =>
      classifyForWire(inv, { available }) && (inv.message != null || !singleFieldConstraints(inv)),
  );
  if (refines.length === 0) return null;
  const checks = refines.map((inv) => {
    const pred = renderPyExpr(inv.expr, { thisName: "self", wireField: true });
    // The FAILING condition.  A guarded rule keeps the `not (<guard-neg> or
    // <pred>)` shape; an unguarded one negates the predicate directly through
    // `renderPyNegatedGuard`, so a `.contains(...)` rule emits `x not in y`
    // rather than the ruff-E713 `not (x in y)`.
    const fails = inv.guard
      ? `not (${renderPyNegatedGuard(inv.guard, { thisName: "self", wireField: true })} or (${pred}))`
      : renderPyNegatedGuard(inv.expr, { thisName: "self", wireField: true });
    // Every rule raises a PydanticCustomError, never a bare ValueError: a
    // ValueError's wire message is prefixed "Value error, " — on a body node
    // answers with the rule's own sentence.  A MESSAGED rule's error `type` is
    // its stable content-hash code (surfaced as `errors[].code`, the i18n key);
    // a message-LESS one is `invariant`, which carries no code — the handler
    // surfaces only `msg.` types — and node's refine default text
    // (`Invariant violated: <src>`, D-MESSAGELESS-RULE-WIRE-MESSAGE).
    //
    // The FIELD the error points at is the other half of that contract, and an
    // error raised from a `model_validator` carries NO `loc` — so `errors[]`
    // answered `pointer: ""` where Hono's refine (which passes `path`) answered
    // `/amount`. `ValidationError.from_exception_data` is the one Pydantic API
    // that lets a raise name its own `loc`, so a rule with a derivable field
    // points at it on python too, messaged or not. A rule with no derivable
    // field (a genuine cross-field comparison) keeps the bare raise, which is
    // also what Hono does — it omits `path` in exactly the same case.
    const path = pickErrorPath(inv);
    // `input` is a REQUIRED key of the `InitErrorDetails` TypedDict (mypy
    // --strict says so), and the offending value is the honest thing to put
    // there — it never reaches the wire (the 422 handler projects only
    // pointer/message/code), but it is what shows up in a raw pydantic error in
    // the logs.  `None` when the path isn't a field this request body carries.
    const input = path && available.has(path) ? `self.${path}` : "None";
    const text = inv.message ? inv.message.text : `Invariant violated: ${inv.source}`;
    const errorType = inv.message ? messageCode(inv.message.text) : "invariant";
    const custom = `${PYDANTIC_CUSTOM_ERROR}(${JSON.stringify(errorType)}, ${JSON.stringify(text)})`;
    const raise = path
      ? `raise ${VALIDATION_ERROR}.from_exception_data(\n                ${JSON.stringify(cls)},\n                [\n                    ${INIT_ERROR_DETAILS}(\n                        type=${custom},\n                        loc=(${JSON.stringify(path)},),\n                        input=${input},\n                    )\n                ],\n            )`
      : `raise ${custom}`;
    return lines(`        if ${fails}:`, `            ${raise}`);
  });
  return lines(
    "",
    `    @${MODEL_VALIDATOR}(mode="after")`,
    `    def _check_invariants(self) -> "${cls}":`,
    ...checks,
    "        return self",
  );
}
