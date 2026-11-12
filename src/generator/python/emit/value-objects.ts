import type { BoundedContextIR, EnumIR, ValueObjectIR } from "../../../ir/types/loom-ir.js";
import { orderValueObjectsByDependency } from "../../../ir/util/reachable-types.js";
import { lines } from "../../../util/code-builder.js";
import { pythonWireIdent } from "../../../util/naming.js";
import { ruleCode, ruleText } from "../../_i18n/rule-text.js";
import { PY_IMPORTS } from "../../_imports/python.js";
import { DOMAIN_NAMES, pythonAnnotationIn } from "../../_symbols/plan.js";
import { PY } from "../py-symbols.js";
import { renderPyExpr, renderPyNegatedGuard, renderPyType } from "../render-expr.js";
import { renderPyStatements } from "../render-stmt.js";
import { pyRuleParams } from "../wire-policy-py.js";

// ---------------------------------------------------------------------------
// `app/domain/value_objects.py` — enums as `StrEnum` subclasses (member
// name == wire value, parity with the other backends' string-coded
// enums) + value objects as plain classes with constructor-enforced
// invariants, `@property` per derived, and a public method per
// `function` (VO functions are cross-boundary surface — as aggregate
// functions now are too, so there is no prefix seam left to cancel).
// ---------------------------------------------------------------------------

/** Render context for VO bodies. */
const VO_CTX = { thisName: "self" };

export function renderPyEnumsAndValueObjects(ctx: BoundedContextIR): string {
  // Every import is derived from the body (M-T9.84): the type / expression /
  // statement renderers and the templates below spell their symbols through
  // `PY` markers, which the module finalizer turns into this module's block.
  return lines(
    `"""Enums + value objects with constructor-enforced invariants.  Auto-generated."""`,
    "",
    PY_IMPORTS,
    ...ctx.enums.flatMap(renderPyEnum),
    // Dependency order: `ctx.valueObjects` lists context-local VOs before the
    // root-level (shared-kernel) ones folded in at enrichment, and a class
    // annotated with another VO must be defined after it (ruff F821).
    ...orderValueObjectsByDependency(ctx.valueObjects).flatMap(renderPyValueObject),
    "",
  );
}

function renderPyEnum(e: EnumIR): string[] {
  return [
    "",
    "",
    `class ${e.name}(${PY.StrEnum}):`,
    ...e.values.map((v) => `    ${pythonWireIdent(v)} = "${v}"`),
  ];
}

function renderPyValueObject(v: ValueObjectIR): string[] {
  // A frozen dataclass gives the VO its VALUE semantics (S9): generated
  // `__eq__`/`__hash__` compare field-wise (identity equality was the bug),
  // and post-construction mutation (`slug.value = ""`, which bypassed the
  // invariants) raises FrozenInstanceError.  The dataclass `__init__` keeps
  // the declaration-order positional/keyword signature the hand-rolled ctor
  // had, so every construction site is unchanged; invariants move to
  // `__post_init__` (the events emitter's pattern).
  const fields = v.fields.map(
    (f) => `    ${DOMAIN_NAMES.python.binding(f.name)}: ${renderPyType(f.type)}`,
  );
  const invariants = v.invariants.flatMap((inv) => {
    const cond = inv.guard
      ? `(${renderPyExpr(inv.guard, VO_CTX)}) and ${renderPyNegatedGuard(inv.expr, VO_CTX)}`
      : renderPyNegatedGuard(inv.expr, VO_CTX);
    const text = ruleText(inv);
    // A DomainError subclass the handlers answer with an errors[] entry; it
    // carries the same `code` the wire rung does (a named rule's identity key,
    // else the generic key of an unnamed one) and a named rule's read values.
    const params = inv.message ? pyRuleParams(inv, (e) => renderPyExpr(e, VO_CTX)) : undefined;
    const code = `, ${JSON.stringify(ruleCode(inv))}${params ? `, ${params}` : ""}`;
    return [
      `        if ${cond}:`,
      `            raise ${PY.ValueObjectInvariantError}(${JSON.stringify(v.name)}, ${JSON.stringify(text)}${code})`,
    ];
  });
  // An annotation inside the class body that names the class itself is a
  // forward reference (the plan spells it; `_symbols/plan.ts`).
  const ann = (t: Parameters<typeof renderPyType>[0]): string =>
    pythonAnnotationIn(v.name, renderPyType(t));
  const derived = v.derived.flatMap((d) => [
    "",
    "    @property",
    `    def ${DOMAIN_NAMES.python.method(d.name)}(self) -> ${ann(d.type)}:`,
    `        return ${renderPyExpr(d.expr, VO_CTX)}`,
  ]);
  const fns = v.functions.flatMap((fn) => {
    const fnParams = [
      "self",
      ...fn.params.map((p) => `${DOMAIN_NAMES.python.binding(p.name)}: ${ann(p.type)}`),
    ];
    const head = `    def ${DOMAIN_NAMES.python.method(fn.name)}(${fnParams.join(", ")}) -> ${ann(fn.returnType)}:`;
    const body =
      "expr" in fn.body
        ? `        return ${renderPyExpr(fn.body.expr, VO_CTX)}`
        : renderPyStatements(fn.body.stmts);
    return ["", head, body];
  });
  return [
    "",
    "",
    `@${PY.dataclass}(frozen=True)`,
    `class ${v.name}:`,
    ...fields,
    ...(invariants.length > 0 ? ["", "    def __post_init__(self) -> None:", ...invariants] : []),
    ...derived,
    ...fns,
  ];
}
