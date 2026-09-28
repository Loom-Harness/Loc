import type { BoundedContextIR, EnumIR, StmtIR, ValueObjectIR } from "../../../ir/types/loom-ir.js";
import { walkStmtExprsDeep } from "../../../ir/util/walk.js";
import { lines } from "../../../util/code-builder.js";
import { messageCode } from "../../../util/message-code.js";
import { snake } from "../../../util/naming.js";
import { emptyPyTypeImports, visitPyTypeImports } from "../py-type-imports.js";
import {
  addPyExprImport,
  collectPyExprImports,
  renderPyExpr,
  renderPyNegatedGuard,
  renderPyType,
} from "../render-expr.js";
import { renderPyStatements } from "../render-stmt.js";

/** Import collection over a pure block-body function statement's expressions
 *  (a block `function` only ever carries let / precondition / requires /
 *  return / expression / call — the impure kinds are rejected by the IR
 *  purity gate).  Rides `walkStmtExprsDeep` (wave-2 packet 2.3 / M-T6.50
 *  class) rather than a hand-enumerated switch, so a `variant-match` nested
 *  in a pure body — the exact shape wave 1 found missing in the sibling
 *  collectors — is not a silent gap here either. */
function collectBlockStmtExprImports(st: StmtIR, into: Set<string>): void {
  walkStmtExprsDeep(st, (e) => addPyExprImport(e, into));
}

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
  const types = emptyPyTypeImports();
  const exprImports = new Set<string>();
  for (const v of ctx.valueObjects) {
    for (const f of v.fields) visitPyTypeImports(f.type, types);
    for (const d of v.derived) {
      visitPyTypeImports(d.type, types);
      collectPyExprImports(d.expr, exprImports);
    }
    for (const fn of v.functions) {
      visitPyTypeImports(fn.returnType, types);
      for (const p of fn.params) visitPyTypeImports(p.type, types);
      if ("expr" in fn.body) collectPyExprImports(fn.body.expr, exprImports);
      else for (const st of fn.body.stmts) collectBlockStmtExprImports(st, exprImports);
    }
    for (const inv of v.invariants) {
      collectPyExprImports(inv.expr, exprImports);
      if (inv.guard) collectPyExprImports(inv.guard, exprImports);
    }
  }
  const hasInvariants = ctx.valueObjects.some((v) => v.invariants.length > 0);
  const usesDecimal = types.usesDecimal || exprImports.has("decimal");
  const usesDatetime = types.usesDatetime || exprImports.has("datetime");
  const idNames = [...types.idNames].sort();

  const bodyParts = [
    ...ctx.enums.flatMap(renderPyEnum),
    ...ctx.valueObjects.flatMap(renderPyValueObject),
  ];
  // `UTC` is only reached when a body actually stamps `datetime.now(UTC)`; a
  // plain `datetime` FIELD uses the type and never the constant, so importing
  // it alongside `datetime` is a stale F401 that fails the emitted project's
  // ruff gate.  Same string-stripped body probe the aggregate emitter uses.
  const scan = bodyParts.join("\n").replace(/"(?:\\.|[^"\\])*"/g, '""');
  const usesUtc = /\bUTC\b/.test(scan);

  return lines(
    `"""Enums + value objects with constructor-enforced invariants.  Auto-generated."""`,
    "",
    exprImports.has("math") ? "import math" : null,
    exprImports.has("re") ? "import re" : null,
    ctx.valueObjects.length > 0 ? "from dataclasses import dataclass" : null,
    usesDatetime || exprImports.has("timedelta")
      ? `from datetime import ${[
          ...(usesUtc ? ["UTC"] : []),
          ...(usesDatetime ? ["datetime"] : []),
          ...(exprImports.has("timedelta") ? ["timedelta"] : []),
        ].join(", ")}`
      : null,
    usesDecimal ? "from decimal import Decimal" : null,
    ctx.enums.length > 0 ? "from enum import StrEnum" : null,
    hasInvariants || /\bDomainError\(/.test(scan) ? "" : null,
    // A value object's invariant raises `ValueObjectInvariantError` (M-T5.1); a
    // plain `DomainError` import survives only where a body still spells one.
    hasInvariants || /\bDomainError\(/.test(scan)
      ? `from app.domain.errors import ${[
          ...(/\bDomainError\(/.test(scan) ? ["DomainError"] : []),
          ...(hasInvariants ? ["ValueObjectInvariantError"] : []),
        ].join(", ")}`
      : null,
    idNames.length > 0
      ? `from app.domain.ids import ${idNames.map((n) => `${n}Id`).join(", ")}`
      : null,
    ...bodyParts,
    "",
  );
}

function renderPyEnum(e: EnumIR): string[] {
  return ["", "", `class ${e.name}(StrEnum):`, ...e.values.map((v) => `    ${v} = "${v}"`)];
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
      `            raise ValueObjectInvariantError(${JSON.stringify(v.name)}, ${JSON.stringify(text)}${code})`,
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
    "@dataclass(frozen=True)",
    `class ${v.name}:`,
    ...fields,
    ...(invariants.length > 0 ? ["", "    def __post_init__(self) -> None:", ...invariants] : []),
    ...derived,
    ...fns,
  ];
}
