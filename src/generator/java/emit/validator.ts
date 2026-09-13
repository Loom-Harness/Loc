import {
  emitsRestCreate,
  forCreateInput,
  isRequiredCreateInput,
} from "../../../ir/enrich/wire-projection.js";
import type {
  EnrichedAggregateIR,
  ExprIR,
  InvariantIR,
  TypeIR,
  ValueObjectIR,
} from "../../../ir/types/loom-ir.js";
import { walkExprDeep } from "../../../ir/util/walk.js";
import {
  type ClassifyContext,
  classifyForWire,
  pickErrorPath,
  type SingleFieldPattern,
  singleFieldShape,
} from "../../../ir/validate/invariant-classify.js";
import { lines } from "../../../util/code-builder.js";
import { messageCode } from "../../../util/message-code.js";
import { upperFirst } from "../../../util/naming.js";
import { javaCodePointLength } from "../../_expr/code-point.js";
import {
  collectJavaExprImports,
  collectJavaRegexLiterals,
  renderJavaExpr,
} from "../render-expr.js";
import { collectWireToDomainImports, wireComponentNullable, wireToDomain } from "./wire.js";

// ---------------------------------------------------------------------------
// Wire-boundary validators — ONE Spring `Validator` per command shape
// (`Create<Agg>Request`, `<Op><Agg>Request`), the .NET FluentValidation analog.
//
// FluentValidation is a PROGRAMMATIC, unified validator: a single
// `AbstractValidator<TCommand>` holds every rule — the single-field
// constraints AND the cross-field `.Must(...)` predicates — run at one seam (the
// Mediator pipeline behavior, before the handler).  The idiomatic Spring mirror
// is Spring's own `org.springframework.validation.Validator` SPI: one validator
// per command, all rules imperative via `errors.rejectValue(field, code, msg)`,
// registered on the controller's `WebDataBinder` (`@InitBinder`) and triggered
// by `@Valid @RequestBody` — surfaced as MethodArgumentNotValidException, mapped
// to the cross-backend 422 `{pointer,message,code?}` envelope by ApiExceptionAdvice.
//
// Rule selection reuses the SHARED classifier
// (`src/ir/validate/invariant-classify.ts`): an invariant that became a
// FluentValidation rule on .NET / a Zod refine on Hono becomes the same check
// here — same predicate, same coverage decision.
//
// The validator runs over the request DTO (WIRE types: money / datetime as
// `String`, ids as their value type), so referenced scalar fields are parsed to
// their domain value first (`wireToDomain`: `new BigDecimal(...)` /
// `Instant.parse(...)` / `new XId(...)`) exactly as the service does; value-
// object fields keep their wire record (nested accessors work directly), which
// is why they are never re-parsed here.
// ---------------------------------------------------------------------------

/** A messaged rule's error code is its content-hash i18n key (`msg.<hash>`); a
 *  message-less rule uses this sentinel so `rejectValue`'s (non-null) errorCode
 *  contract holds without surfacing a `code` in the 422 envelope — the advice
 *  emits `code` only when it starts with `msg.`. */
const NO_WIRE_CODE = "loom.invariant";

export interface JavaCommandValidator {
  /** e.g. `CreateOrderValidator` — the Spring `Validator` class. */
  className: string;
  /** the `@RequestBody` DTO it validates, e.g. `CreateOrderRequest`. */
  requestType: string;
  content: string;
}

interface CommandSpec {
  className: string;
  requestType: string;
  /** `nullable` is the DTO record's own answer for this slot: true when the
   *  request component is a Java REFERENCE, so `name == null` compiles AND can
   *  be true.  Carried rather than re-derived here because the boxing decision
   *  differs per command shape (an operation body boxes every non-optional
   *  param per RS-26; a create body does not) — see `wireComponentNullable`. */
  params: { name: string; type: TypeIR; optional?: boolean; nullable: boolean }[];
  invariants: InvariantIR[];
  available: ReadonlySet<string>;
  /** VO-invariant → 422: the request's value-object-typed fields whose VO
   *  carries its own invariant.  Each nest-invokes a `<VO>Validator` over the
   *  wire request field (before the service constructs the throwing domain VO). */
  voFields: { field: string; voClass: string; each: boolean }[];
}

function eff(t: TypeIR, optional: boolean): TypeIR {
  return optional && t.kind !== "optional" ? { kind: "optional", inner: t } : t;
}

/** Resolve a (possibly array/optional-wrapped) type to the value object it
 *  bears, plus whether the field is a collection (single vs `List<>`). */
function voBorne(type: TypeIR): { name: string; each: boolean } | null {
  switch (type.kind) {
    case "valueobject":
      return { name: type.name, each: false };
    case "array": {
      const e = voBorne(type.element);
      return e ? { name: e.name, each: true } : null;
    }
    case "optional":
      return voBorne(type.inner);
    default:
      return null;
  }
}

/** True when a value object carries at least one wire-boundary rule. */
export function voHasWireRules(vo: ValueObjectIR): boolean {
  const available = new Set(vo.fields.map((f) => f.name));
  return vo.invariants.some((inv) => classifyForWire(inv, { available }));
}

/** The VO-typed request fields whose VO carries wire rules — the nested
 *  validators a command validator invokes (empty ⇒ none). */
function voRequestFields(
  params: { name: string; type: TypeIR }[],
  voByName: ReadonlyMap<string, ValueObjectIR>,
): { field: string; voClass: string; each: boolean }[] {
  const out: { field: string; voClass: string; each: boolean }[] = [];
  for (const p of params) {
    const borne = voBorne(p.type);
    if (!borne) continue;
    const vo = voByName.get(borne.name);
    if (!vo || !voHasWireRules(vo)) continue;
    out.push({ field: p.name, voClass: `${borne.name}Validator`, each: borne.each });
  }
  return out;
}

function commandSpecs(
  agg: EnrichedAggregateIR,
  voByName: ReadonlyMap<string, ValueObjectIR>,
): CommandSpec[] {
  const specs: CommandSpec[] = [];
  const createInputs = forCreateInput(agg.fields);
  // A create validator exists only when there's a field-derived Create<Agg>Request
  // to validate.  Skip when there's no REST create at all, and for event-sourced
  // aggregates, whose create request is keyed by the `create` action's params
  // rather than the field set (`!ctx.esCreateParams`).
  if (emitsRestCreate(agg) && agg.persistedAs !== "eventLog") {
    specs.push({
      className: `Create${agg.name}Validator`,
      requestType: `Create${agg.name}Request`,
      // The create record leaves required inputs UNBOXED, so an `int` slot is
      // a primitive here and a `Money` slot a record — `wireComponentNullable`
      // is fed the same `!isRequiredCreateInput(f)` boxing dto.ts uses.
      params: createInputs.map((f) => ({
        name: f.name,
        type: f.type,
        optional: f.optional,
        nullable: wireComponentNullable(f.type, !isRequiredCreateInput(f)),
      })),
      invariants: agg.invariants,
      available: new Set(createInputs.map((f) => f.name)),
      voFields: voRequestFields(createInputs, voByName),
    });
  }
  for (const op of agg.operations) {
    // A paramless op has no request body → nothing rides `@Valid`; its
    // preconditions (over aggregate state, not wire input) stay on the domain
    // floor, exactly as before (they never classified for the wire).
    if (op.params.length === 0) continue;
    const preconditions: InvariantIR[] = [];
    for (const s of op.statements) {
      if (s.kind === "precondition")
        preconditions.push({ expr: s.expr, source: s.source, message: s.message });
    }
    specs.push({
      className: `${upperFirst(op.name)}${agg.name}Validator`,
      requestType: `${upperFirst(op.name)}${agg.name}Request`,
      // RS-26: an operation body BOXES every non-optional param, so even an
      // `int qty` slot is an `Integer` that can arrive null.
      params: op.params.map((p) => ({
        name: p.name,
        type: p.type,
        nullable: wireComponentNullable(p.type, true),
      })),
      // Field-level invariants (SYS-1): a mutating op's validator gets the SAME
      // wire constraints as create, plus its own preconditions; `available =
      // op.params` drops invariants over fields the op doesn't take.
      invariants: [...agg.invariants, ...preconditions],
      available: new Set(op.params.map((p) => p.name)),
      voFields: voRequestFields(op.params, voByName),
    });
  }
  return specs;
}

/** Build the `<VO> → ValueObjectIR` lookup a validator emit needs to resolve a
 *  request field's VO invariants. */
function voLookup(vos: readonly ValueObjectIR[]): Map<string, ValueObjectIR> {
  return new Map(vos.map((v) => [v.name, v]));
}

export function renderJavaCommandValidators(
  agg: EnrichedAggregateIR,
  pkg: string,
  basePkg: string,
  /** The context's value objects — a VO-typed request field carrying its own
   *  invariant nest-invokes a `<VO>Validator` (VO→422).  Defaults to none for
   *  callers predating the VO path (behaviour-preserving). */
  vos: readonly ValueObjectIR[] = [],
): JavaCommandValidator[] {
  const voByName = voLookup(vos);
  const out: JavaCommandValidator[] = [];
  for (const spec of commandSpecs(agg, voByName)) {
    const content = renderValidatorClass(spec, pkg, basePkg);
    if (content) out.push({ className: spec.className, requestType: spec.requestType, content });
  }
  return out;
}

/** The `<VO>Validator implements Validator` classes for every value object
 *  (used by this aggregate's requests) that carries its own invariant — the
 *  nested validators the command validators invoke.  Reuses the command
 *  validator renderer with the VO's own fields/invariants as the "command". */
export function renderJavaVoValidators(
  agg: EnrichedAggregateIR,
  vos: readonly ValueObjectIR[],
  pkg: string,
  basePkg: string,
): JavaCommandValidator[] {
  const voByName = voLookup(vos);
  const wanted = new Set<string>();
  for (const spec of commandSpecs(agg, voByName))
    for (const f of spec.voFields) wanted.add(f.voClass.slice(0, -"Validator".length));
  const out: JavaCommandValidator[] = [];
  for (const name of wanted) {
    const vo = voByName.get(name);
    if (!vo) continue;
    const content = renderValidatorClass(
      {
        className: `${vo.name}Validator`,
        requestType: `${vo.name}Request`,
        params: vo.fields.map((f) => ({
          name: f.name,
          type: f.type,
          nullable: wireComponentNullable(f.type, f.optional),
        })),
        invariants: vo.invariants,
        available: new Set(vo.fields.map((f) => f.name)),
        voFields: [],
      },
      pkg,
      basePkg,
    );
    if (content)
      out.push({ className: `${vo.name}Validator`, requestType: `${vo.name}Request`, content });
  }
  return out;
}

/** The (className, requestType) of every command validator actually emitted for
 *  the aggregate — the controller uses these to register them on its
 *  `WebDataBinder` (`@InitBinder`).  A cheap re-derivation (validators are tiny),
 *  mirroring the old `opHasWireValidator` render-and-check. */
export function javaCommandValidatorNames(
  agg: EnrichedAggregateIR,
  vos: readonly ValueObjectIR[] = [],
): { className: string; requestType: string }[] {
  return renderJavaCommandValidators(agg, "_", "_", vos).map(({ className, requestType }) => ({
    className,
    requestType,
  }));
}

/** The `<VO>Validator` nested-invoke blocks for a command's VO-typed fields —
 *  each pushes the field's nested error path, runs the VO validator over the
 *  wire request field, and pops (so a `qty.value` error surfaces as `/qty/value`).
 *  A collection field iterates with an indexed nested path. */
function voNestedInvokes(spec: CommandSpec): string[] {
  const out: string[] = [];
  for (const f of spec.voFields) {
    const accessor = `request.${f.field}()`;
    if (f.each) {
      out.push(
        `        if (${accessor} != null) {`,
        `            for (int i = 0; i < ${accessor}.size(); i++) {`,
        `                errors.pushNestedPath("${f.field}[" + i + "]");`,
        `                ValidationUtils.invokeValidator(new ${f.voClass}(), ${accessor}.get(i), errors);`,
        `                errors.popNestedPath();`,
        `            }`,
        `        }`,
      );
    } else {
      out.push(
        `        if (${accessor} != null) {`,
        `            errors.pushNestedPath("${f.field}");`,
        `            ValidationUtils.invokeValidator(new ${f.voClass}(), ${accessor}, errors);`,
        `            errors.popNestedPath();`,
        `        }`,
      );
    }
  }
  return out;
}

function renderValidatorClass(spec: CommandSpec, pkg: string, basePkg: string): string | null {
  const imports = new Set<string>();
  const regexFields = new Map<string, string>();
  const checks = buildChecks(spec, imports, regexFields);
  const voInvokes = voNestedInvokes(spec);
  if (checks.length === 0 && voInvokes.length === 0) return null;
  if (voInvokes.length > 0) imports.add("org.springframework.validation.ValidationUtils");

  // Parse-locals only for fields the checks actually reference (bare names),
  // mirroring the service's wire→domain parse so predicates run over the domain
  // value (a money field becomes a `BigDecimal` local, etc.).
  const referenced = spec.params.filter((p) =>
    new RegExp(`\\b${p.name}\\b`).test(checks.join("\n")),
  );
  const lets = referenced.map((p) => {
    collectWireToDomainImports(eff(p.type, !!p.optional), imports, basePkg);
    return `        var ${p.name} = ${validatorLocal(eff(p.type, !!p.optional), `request.${p.name}()`)};`;
  });

  const patternFields = [...regexFields].map(
    ([pat, name]) =>
      `    private static final Pattern ${name} = Pattern.compile(${JSON.stringify(pat)});`,
  );
  if (patternFields.length > 0) imports.add("java.util.regex.Pattern");

  return lines(
    `package ${pkg};`,
    ``,
    ...[...imports].sort().map((i) => `import ${i};`),
    imports.size > 0 ? `` : null,
    `import org.springframework.validation.Errors;`,
    `import org.springframework.validation.Validator;`,
    ``,
    `import ${basePkg}.domain.enums.*;`,
    `import ${basePkg}.domain.ids.*;`,
    `import ${basePkg}.domain.valueobjects.*;`,
    ``,
    `/** Wire-boundary validator (422) — one Spring Validator holding every rule`,
    ` *  (single-field + cross-field) for this command, run at the \`@Valid\` seam.`,
    ` *  The .NET FluentValidation analog: one AbstractValidator, one seam. */`,
    `public final class ${spec.className} implements Validator {`,
    ...(patternFields.length > 0 ? [...patternFields, ``] : []),
    `    @Override`,
    `    public boolean supports(Class<?> clazz) {`,
    `        return ${spec.requestType}.class.equals(clazz);`,
    `    }`,
    ``,
    `    @Override`,
    `    public void validate(Object target, Errors errors) {`,
    `        var request = (${spec.requestType}) target;`,
    ...lets,
    ...checks,
    ...voInvokes,
    `    }`,
    `}`,
    ``,
  );
}

/** The parse expression for a referenced field's local.  Scalars/ids parse to
 *  their domain value (`wireToDomain`); a value-object-bearing field keeps its
 *  wire record (its `to<VO>` parser is service-private, and nested accessors
 *  read the same shape) so member predicates resolve without it. */
function validatorLocal(type: TypeIR, expr: string, pointer = ""): string {
  // The validator evaluates member predicates over an already-parsed local; a
  // money conversion here would have been refused at the service seam first,
  // so the pointer is informational and defaults to the document root.
  return bearsValueObject(type) ? expr : wireToDomain(type, expr, pointer);
}

function bearsValueObject(type: TypeIR): boolean {
  switch (type.kind) {
    case "valueobject":
      return true;
    case "array":
      return bearsValueObject(type.element);
    case "optional":
      return bearsValueObject(type.inner);
    default:
      return false;
  }
}

/** The `if (!(predicate)) errors.rejectValue(...)` lines for one command's
 *  classified invariants — single-field shapes via `patternCheck`, everything
 *  else via a rendered generic predicate. */
function buildChecks(
  spec: CommandSpec,
  imports: Set<string>,
  regexFields: Map<string, string>,
): string[] {
  const ctx: ClassifyContext = { available: spec.available };
  const checks: string[] = [];
  const typeOf = (field: string): TypeIR | undefined =>
    spec.params.find((p) => p.name === field)?.type;
  const nullableOf = (field: string): boolean =>
    spec.params.find((p) => p.name === field)?.nullable ?? false;

  for (const inv of spec.invariants) {
    if (!classifyForWire(inv, ctx)) continue;
    const message = inv.message ? inv.message.text : `Invariant violated: ${inv.source}`;
    const code = inv.message ? messageCode(inv.message.text) : NO_WIRE_CODE;
    const single = singleFieldShape(inv);
    if (single && spec.available.has(single.field)) {
      checks.push(
        ...patternCheck(
          single.field,
          single.pattern,
          typeOf(single.field),
          nullableOf(single.field),
          message,
          code,
          regexFields,
        ),
      );
      continue;
    }
    // Generic predicate over the command values — the .NET `.Must(...)` arm.
    // `bareProps` renders `this.x` refs as the parsed local names declared above.
    const path = pickErrorPath(inv) ?? spec.params[0]?.name ?? "";
    // A GUARDED invariant (`invariant P when G`) is the implication `G -> P`,
    // NOT `P`.  Rendering only the consequent turns a conditional rule into an
    // unconditional one and 422-refuses a body the domain layer itself accepts
    // — so the guard rides here exactly as it does on .NET
    // (`.Must(x => !(guard) || (body))`, dotnet/validator-emit.ts), node
    // (`.refine(d => !(guard) || …)`) and python.  `singleFieldShape` returns
    // null for every guarded invariant (ir/validate/invariant-classify.ts), so
    // this arm is the only one a guard can reach: nothing else re-enforces it.
    // Imports and regex literals are collected from BOTH halves — the guard is
    // rendered source like any other, and a `Pattern` field it needs is
    // otherwise never declared.  Body first, so an UNGUARDED invariant keeps
    // its existing `MATCHES_PATTERN_<n>` numbering byte-identically.
    collectJavaExprImports(inv.expr, imports);
    if (inv.guard) collectJavaExprImports(inv.guard, imports);
    const literals = [
      ...collectJavaRegexLiterals(inv.expr),
      ...(inv.guard ? collectJavaRegexLiterals(inv.guard) : []),
    ];
    for (const p of literals) {
      if (!regexFields.has(p)) regexFields.set(p, `MATCHES_PATTERN_${regexFields.size}`);
    }
    const renderOpts = { thisName: "this", bareProps: true, regexFields } as const;
    const body = renderJavaExpr(inv.expr, renderOpts);
    // #2857 (F19): a guarded invariant crosses the wire WITH its guard; C0.2a
    // (F31): a nullable operand skips the bound rather than dereferencing null.
    // Both compose — the null-skip wraps the guarded predicate, and its member
    // walk covers the guard as well as the body.
    const predicate = inv.guard ? `!(${renderJavaExpr(inv.guard, renderOpts)}) || (${body})` : body;
    checks.push(reject(path, code, message, nullSkipRefs(predicate, spec, inv, regexFields)));
  }
  return checks;
}

/** F23's null-skip on the GENERIC-predicate arm.
 *
 *  `patternCheck` guards the single-field shapes, but an invariant whose
 *  expression DEREFERENCES a nullable command value — `balance.amount >= 0`,
 *  where `balance` is a required `Money` — falls through to the rendered
 *  predicate, which had no guard at all:
 *
 *      var balance = request.balance();
 *      if (!(balance.amount().compareTo(new BigDecimal("0")) >= 0)) …
 *          NullPointerException: Cannot invoke "MoneyRequest.amount()"
 *                                because "balance" is null            → 500
 *
 *  for a body the record's own `@NotNull` was about to answer 422. This
 *  validator is a Spring `Validator` that Bean Validation runs ALONGSIDE those
 *  annotations, not after them, so the predicate reaches the null first.
 *  Skipping leaves the absence to the annotation that describes it — the same
 *  decision F23 took for the single-field arms.
 *
 *  Guarded values are the REFERENCE-typed params the predicate names (a
 *  primitive can never be null and `int == null` does not compile). An
 *  invariant that mentions `null` ITSELF is left alone: it is asking about
 *  absence, so skipping on absence would delete the check. */
function nullSkipRefs(
  predicate: string,
  spec: CommandSpec,
  inv: InvariantIR,
  regexFields: Map<string, string>,
): string {
  if (mentionsNullLiteral(inv.expr) || (inv.guard && mentionsNullLiteral(inv.guard)))
    return predicate;
  const guards = new Map<number, Set<string>>();
  const add = (depth: number, g: string): void => {
    const at = guards.get(depth) ?? new Set<string>();
    at.add(g);
    guards.set(depth, at);
  };
  for (const p of spec.params) {
    if (p.nullable && new RegExp(`\\b${p.name}\\b`).test(predicate)) add(0, `${p.name} == null`);
  }
  // …and every MEMBER STEP along a chain rooted at one of those params.
  // `balance == null` alone still left `balance.amount()` returning null into
  // `.compareTo(...)`: `{"balance": {"currency": ""}}` (the required `amount`
  // simply omitted) threw
  //   NullPointerException: … because the return value of
  //   "MoneyRequest.amount()" is null
  // — the nested `@NotNull` was about to answer 422 with `/balance/amount`.
  const render = (e: ExprIR): string =>
    renderJavaExpr(e, { thisName: "this", bareProps: true, regexFields });
  // The guard (`invariant … when <guard>`, #2857) is rendered into the same
  // predicate, so its chains need the same skips.
  for (const root of [inv.expr, inv.guard]) {
    if (!root) continue;
    walkExprDeep(root, (e) => {
      if (e.kind !== "member") return;
      // A member off a SCALAR receiver is an intrinsic (`note.length`, rendered
      // `((int) note.codePoints().count())`), not a record field: the depth-0
      // param guard already covers its receiver, and `int == null` does not
      // compile. Only record fields (VO / entity receivers) get a step guard.
      const recv = e.receiverType.kind === "optional" ? e.receiverType.inner : e.receiverType;
      if (recv.kind === "primitive") return;
      const depth = chainDepth(e, spec);
      if (depth === null) return;
      // A PRIMITIVE accessor can never be null and `int == null` does not compile.
      if (!wireComponentNullable(e.memberType, false)) return;
      add(depth, `${render(e)} == null`);
    });
  }
  // Shallow first: the guard for `a` has to short-circuit before `a.b()` runs.
  const ordered = [...guards.entries()].sort((x, y) => x[0] - y[0]).flatMap(([, set]) => [...set]);
  return ordered.length === 0 ? predicate : `${ordered.join(" || ")} || ${predicate}`;
}

/** How many member steps from a nullable command param this access sits at, or
 *  null when the chain is not rooted at one (a literal, `this`, a call). */
function chainDepth(e: ExprIR, spec: CommandSpec): number | null {
  let depth = 1;
  let cur: ExprIR = e;
  for (;;) {
    if (cur.kind !== "member") break;
    cur = cur.receiver;
    depth++;
  }
  if (cur.kind !== "ref") return null;
  const param = spec.params.find((p) => p.name === cur.name);
  return param?.nullable ? depth : null;
}

/** True when the expression contains a `null` literal anywhere. */
function mentionsNullLiteral(expr: ExprIR): boolean {
  let found = false;
  walkExprDeep(expr, (e) => {
    if (e.kind === "literal" && e.lit === "null") found = true;
  });
  return found;
}

/** `if (!(cond)) errors.rejectValue("field", "code", "message");` — the Spring
 *  `Errors` analog of FluentValidation's `.WithName(...).WithMessage(...)
 *  .WithErrorCode(...)`.  `field` is the property path (no leading slash; the
 *  advice re-prefixes `/`), `code` the wire code (or the message-less sentinel),
 *  `message` the resolved default text. */
function reject(field: string, code: string, message: string, cond: string): string {
  return `        if (!(${cond})) errors.rejectValue(${JSON.stringify(field)}, ${JSON.stringify(code)}, ${JSON.stringify(message)});`;
}

function patternCheck(
  field: string,
  pattern: SingleFieldPattern,
  type: TypeIR | undefined,
  nullable: boolean,
  message: string,
  code: string,
  regexFields: Map<string, string>,
): string[] {
  const moneyLike =
    type?.kind === "primitive" && (type.name === "money" || type.name === "decimal");
  const cmp = (op: string, n: number): string =>
    moneyLike
      ? `${field}.compareTo(new java.math.BigDecimal("${n}")) ${op} 0`
      : `${field} ${op} ${n}`;
  // A NULL field SKIPS its bound rather than failing it (F23). This validator
  // is a Spring `Validator` that Bean Validation runs ALONGSIDE the record's
  // own `@NotNull`, not after it — so with `{"sku": null}` the length check
  // reached `sku.codePoints()` first and threw:
  //
  //     NullPointerException: Cannot invoke "String.codePoints()" because "sku" is null
  //       at CreateOrderValidator.validate(CreateOrderValidator.java:23)
  //
  // → a 500 for a body `@NotNull` was about to reject with a 422. Skipping
  // leaves the absence to the annotation that describes it, which is exactly
  // what .NET's FluentValidation arms already do (`v == null || …`, and its
  // built-in length validators return true for null).
  //
  // Only where the Java type is a REFERENCE — `int == null` would not compile.
  // That question is the DTO record's to answer, not this switch's: the first
  // cut asked it of the PATTERN (`money`/`len-*`/`regex` are nullable, the rest
  // are not), which is true of a create body's unboxed `int qty` and false of
  // an operation body's, where RS-26 boxes every non-optional param. So
  // `qty >= 1` on an `Integer qty` that arrived null unboxed to
  // `Integer.intValue()` and threw — F23's 500 one command shape over (W11/W12
  // on `POST /api/orders/{id}/add_line`). `nullable` is now carried from the
  // record's own boxing decision (`wireComponentNullable`).
  const nullSkip = (cond: string): string => (nullable ? `${field} == null || ${cond}` : cond);
  const fail = (cond: string): string => reject(field, code, message, nullSkip(cond));
  switch (pattern.kind) {
    case "min":
      // Exclusive (`weight > 0.5` on a decimal/money field) → strict `>`; the
      // `cmp` helper routes decimal/money through `BigDecimal.compareTo`.
      return [fail(cmp(pattern.exclusive ? ">" : ">=", pattern.n))];
    case "max":
      return [fail(cmp(pattern.exclusive ? "<" : "<=", pattern.n))];
    case "between":
      return [fail(`${cmp(">=", pattern.lo)} && ${cmp("<=", pattern.hi)}`)];
    // CODE POINTS, not `String.length()`'s UTF-16 code units — the same count
    // the emitted OpenAPI publishes as `minLength`/`maxLength`
    // (src/generator/_expr/code-point.ts).
    case "len-min":
      return [fail(`${javaCodePointLength(field)} >= ${pattern.n}`)];
    case "len-max":
      return [fail(`${javaCodePointLength(field)} <= ${pattern.n}`)];
    case "len-eq":
      return [fail(`${javaCodePointLength(field)} == ${pattern.n}`)];
    case "len-range":
      return [
        fail(
          `${javaCodePointLength(field)} >= ${pattern.lo} && ${javaCodePointLength(field)} <= ${pattern.hi}`,
        ),
      ];
    case "regex": {
      let name = regexFields.get(pattern.pattern);
      if (!name) {
        name = `MATCHES_PATTERN_${regexFields.size}`;
        regexFields.set(pattern.pattern, name);
      }
      return [fail(`${name}.matcher(${field}).find()`)];
    }
  }
}
