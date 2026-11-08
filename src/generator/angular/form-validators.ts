import type { InvariantIR } from "../../ir/types/loom-ir.js";
import type { SingleFieldPattern } from "../../ir/validate/invariant-classify.js";
import { tsCodePointLength } from "../_expr/code-point.js";
import { asRegexLiteral } from "../_expr/regex-literal.js";
import { type ClientLimitCheck, clientLimitChecks } from "../_frontend/error-codes.js";
import type { WalkContext } from "../_walker/walker-core.js";
import { takeSingleFieldChain } from "../zod-refine.js";
import { type AngularFormControlSpec, addNg } from "./form-fields.js";

// ---------------------------------------------------------------------------
// Angular Reactive-Forms validator derivation.
//
// The JSX/markup frontends (React/Vue/Svelte) fold an aggregate's
// wire-translatable `invariant`s into the `Create<Agg>Request` zod schema as
// native chains (`z.number().min(N)`, `z.string().regex(/…/)`, …) so the form
// validates client-side without a server round-trip.  Angular's typed
// Reactive Forms carry validation as `ValidatorFn[]` on each `FormControl`
// instead of a schema — so this module maps the SAME recognised single-field
// shapes onto `Validators.*` calls, keyed by field name.
//
// Fidelity is guaranteed by reuse, not re-implementation: the classification +
// single-field detection go through the shared `takeSingleFieldChain` gate
// (the exact one `emitObjectWithRefines` uses for zod), so Angular admits a
// constraint iff the other frontends do.  Money / `now()` / conversions /
// cross-field rules stay server-only here too (they never pass the gate).
// ---------------------------------------------------------------------------

/** Build the per-field `Validators.*` map an aggregate's invariants imply,
 *  over the fields the form actually carries (`available`).  Returns an empty
 *  map when no invariant translates — callers then emit byte-identical
 *  validator-free `FormControl`s. */
export function angularValidatorMap(
  invariants: readonly InvariantIR[],
  available: ReadonlySet<string>,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [field, validators] of fieldValidators(invariants, available)) {
    out.set(
      field,
      validators.map((v) => v.call),
    );
  }
  return out;
}

/** The catalog message of one Angular validator error: the control error key
 *  it sets, and the code + params its text renders under. */
export interface AngularFieldMessage {
  errorKey: string;
  code: string;
  params: Readonly<Record<string, number>>;
}

/** Each constrained field's messages, one per validator in the order they
 *  run — a declared limit's side renders under its `field.<limit>` code with
 *  its bound, a named rule under its identity key.  Same admission gate as
 *  {@link angularValidatorMap}, so the two maps have the same keys.  The
 *  field's inline message renders through `t(code, english, params)` when the
 *  form RENDERS. */
export function angularRuleCodes(
  invariants: readonly InvariantIR[],
  available: ReadonlySet<string>,
): Map<string, AngularFieldMessage[]> {
  const out = new Map<string, AngularFieldMessage[]>();
  for (const [field, validators] of fieldValidators(invariants, available)) {
    out.set(
      field,
      validators.map(({ errorKey, limit }) => ({
        errorKey,
        code: limit.code,
        params: limit.params,
      })),
    );
  }
  return out;
}

/** One emitted validator: its call and the control error key it sets. */
interface AngularValidator {
  call: string;
  errorKey: string;
  limit: ClientLimitCheck;
}

/** Every constrained field's validators, through the shared
 *  `takeSingleFieldChain` gate and `clientLimitChecks` mapping. */
function fieldValidators(
  invariants: readonly InvariantIR[],
  available: ReadonlySet<string>,
): Map<string, AngularValidator[]> {
  const out = new Map<string, AngularValidator[]>();
  const ctx = { available };
  for (const inv of invariants) {
    const taken = takeSingleFieldChain(inv, ctx);
    if (!taken) continue;
    const list = out.get(taken.field) ?? [];
    list.push(...validatorsForPattern(inv, taken.pattern));
    out.set(taken.field, list);
  }
  return out;
}

/** One `len-*` bound as an inline `ValidatorFn` that counts CODE POINTS.
 *
 *  NOT `Validators.minLength/maxLength`: those read `control.value.length` —
 *  UTF-16 code units — while the `minLength`/`maxLength` this same constraint
 *  publishes in the server's JSON Schema are defined in code points, and every
 *  other emitter already counts code points (`src/generator/_expr/code-point.ts`).
 *  Angular emits no zod schema, so this is the ONLY client-side length check on
 *  that frontend: with the built-ins, `"😀😀😀😀😀"` (5 code points, 10 units)
 *  was blocked by a `maxLength(8)` the server itself calls valid, and `"😀X"`
 *  (2 code points, 3 units) sailed through a `minLength(3)` into a server 422.
 *
 *  The code-point count comes from {@link tsCodePointLength}, the same
 *  definition the zod `.refine` chains use, so the two cannot drift.  Empty /
 *  absent values short-circuit to `null`, matching the built-ins' own
 *  empty-skip (emptiness is `Validators.required`'s job, not a length rule's). */
function codePointLengthValidator(cmp: ">=" | "<=", n: number): string {
  const key = cmp === ">=" ? "minlength" : "maxlength";
  const len = tsCodePointLength("String(c.value)");
  return `((c: AbstractControl) => c.value == null || c.value === "" || ${len} ${cmp} ${n} ? null : { ${key}: { requiredLength: ${n} } })`;
}

/** The subset of a partitioned form's flat fields this helper reads/writes. */
interface FlatFields {
  flatControls: AngularFormControlSpec[];
  flatNames: readonly string[];
  flatMarkup: readonly string[];
}

/** Fold `invariants` (over `available` fields) into per-field `Validators.*` on
 *  a form's flat controls, and return the field markup with an inline error
 *  appended after each validated field.  Registers the `Validators` import when
 *  any constraint lands; a form with no wire-translatable invariant is a no-op
 *  (controls untouched, markup returned verbatim), so validator-free forms stay
 *  byte-identical.  Shared by the create / operation / modal form renderers. */
export function applyAngularValidators(
  parts: FlatFields,
  invariants: readonly InvariantIR[],
  available: ReadonlySet<string>,
  formVar: string,
  ns: string,
  ctx: WalkContext,
): string[] {
  const validatorMap = angularValidatorMap(invariants, available);
  if (validatorMap.size > 0) {
    // Register only what the emitted calls actually name: a form whose sole
    // constraint is a `len-*` bound emits inline `ValidatorFn`s and never
    // spells `Validators`, and an unused import is a `tsc` error under the
    // generated project's `noUnusedLocals`.
    const all = [...validatorMap.values()].flat();
    if (all.some((v) => v.startsWith("Validators."))) {
      addNg(ctx, "@angular/forms", "Validators");
    }
    if (all.some((v) => v.includes("AbstractControl"))) {
      addNg(ctx, "@angular/forms", "AbstractControl");
    }
    for (const c of parts.flatControls) {
      const v = validatorMap.get(c.name);
      if (v) c.validators = v;
    }
  }
  // The per-field MESSAGE is rendered with its control, by
  // `partitionAngularFields` / `withFieldError` — not appended here.  It has to
  // be: on the material pack the message belongs INSIDE the
  // `<mat-form-field>`, which is the only placement `MatFormField` associates
  // with the input (`aria-describedby`), and only the field renderer knows
  // whether the markup it produced is a form field at all.  This function
  // therefore owns the CONTROLS (validators + imports) and nothing else; the
  // two halves agree by sharing `angularValidatorMap`, which the caller passes
  // to the partition as `errorFields`.
  void ns;
  void formVar;
  return [...parts.flatMarkup];
}

/** Map one recognised single-field pattern onto its Angular validators, one
 *  per side of the limit (`clientLimitChecks`) — the direct twin of
 *  `chainSingleFieldNative` (zod).  An exact length is a `minlength` +
 *  `maxlength` pair under the one `field.length` code. */
function validatorsForPattern(inv: InvariantIR, p: SingleFieldPattern): AngularValidator[] {
  return clientLimitChecks(inv, p).flatMap((limit): AngularValidator[] => {
    const n = limit.check.bound ?? 0;
    switch (limit.check.reason) {
      case "min":
      case "greater-than":
        // Angular has no exclusive numeric validator; an exclusive bound
        // (`weight > 0.5` on a decimal) falls back to the inclusive `min`, the
        // closest built-in, still under its own code.  The server floor
        // enforces the strict bound.
        return [{ call: `Validators.min(${n})`, errorKey: "min", limit }];
      case "max":
      case "less-than":
        return [{ call: `Validators.max(${n})`, errorKey: "max", limit }];
      case "min-length":
        return [{ call: codePointLengthValidator(">=", n), errorKey: "minlength", limit }];
      case "max-length":
        return [{ call: codePointLengthValidator("<=", n), errorKey: "maxlength", limit }];
      case "length":
        return [
          { call: codePointLengthValidator(">=", n), errorKey: "minlength", limit },
          { call: codePointLengthValidator("<=", n), errorKey: "maxlength", limit },
        ];
      case "pattern":
        // The pattern is a JS-compatible regex source (parse-time validated via
        // `new RegExp`).  Rendered through the SAME `asRegexLiteral` hardening
        // the zod chain uses, so an empty / dangling-backslash / multi-line
        // source falls back to `new RegExp("…")` instead of emitting a `//`
        // that comments out the rest of the line.
        return [
          {
            call: `Validators.pattern(${asRegexLiteral(limit.check.regex ?? "")})`,
            errorKey: "pattern",
            limit,
          },
        ];
      default: {
        const unknown: never = limit.check.reason;
        throw new Error(`angular form-validators: unhandled field limit ${String(unknown)}`);
      }
    }
  });
}
