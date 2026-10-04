import type { BoundedContextIR, EnumIR, ValueObjectIR } from "../../../ir/types/loom-ir.js";
import { lines } from "../../../util/code-builder.js";
import { messageCode } from "../../../util/message-code.js";
import { snake } from "../../../util/naming.js";
import { PY_IMPORTS } from "../../_imports/python.js";
import { PY } from "../py-symbols.js";
import { renderPyExpr, renderPyNegatedGuard, renderPyType } from "../render-expr.js";
import { renderPyStatements } from "../render-stmt.js";

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
    ...ctx.valueObjects.flatMap(renderPyValueObject),
    "",
  );
}

function renderPyEnum(e: EnumIR): string[] {
  return ["", "", `class ${e.name}(${PY.StrEnum}):`, ...e.values.map((v) => `    ${v} = "${v}"`)];
}

function renderPyValueObject(v: ValueObjectIR): string[] {
  // A frozen dataclass gives the VO its VALUE semantics (S9): generated
  // `__eq__`/`__hash__` compare field-wise (identity equality was the bug),
  // and post-construction mutation (`slug.value = ""`, which bypassed the
  // invariants) raises FrozenInstanceError.  The dataclass `__init__` keeps
  // the declaration-order positional/keyword signature the hand-rolled ctor
  // had, so every construction site is unchanged; invariants move to
  // `__post_init__` (the events emitter's pattern).
  const fields = v.fields.map((f) => `    ${snake(f.name)}: ${renderPyType(f.type)}`);
  const invariants = v.invariants.flatMap((inv) => {
    const cond = inv.guard
      ? `(${renderPyExpr(inv.guard, VO_CTX)}) and ${renderPyNegatedGuard(inv.expr, VO_CTX)}`
      : renderPyNegatedGuard(inv.expr, VO_CTX);
    const text = inv.message ? inv.message.text : `Invariant violated: ${inv.source}`;
    // M-T5.1 — a DomainError subclass the handlers answer with an errors[]
    // entry; a messaged rule carries the wire rung's content-hash code.
    const code = inv.message ? `, ${JSON.stringify(messageCode(inv.message.text))}` : "";
    return [
      `        if ${cond}:`,
      `            raise ${PY.ValueObjectInvariantError}(${JSON.stringify(v.name)}, ${JSON.stringify(text)}${code})`,
    ];
  });
  const derived = v.derived.flatMap((d) => [
    "",
    "    @property",
    `    def ${snake(d.name)}(self) -> ${renderPyType(d.type)}:`,
    `        return ${renderPyExpr(d.expr, VO_CTX)}`,
  ]);
  const fns = v.functions.flatMap((fn) => {
    const fnParams = ["self", ...fn.params.map((p) => `${snake(p.name)}: ${renderPyType(p.type)}`)];
    const head = `    def ${snake(fn.name)}(${fnParams.join(", ")}) -> ${renderPyType(fn.returnType)}:`;
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
