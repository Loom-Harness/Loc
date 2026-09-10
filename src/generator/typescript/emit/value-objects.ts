import type { BoundedContextIR, EnumIR, TypeIR, ValueObjectIR } from "../../../ir/types/loom-ir.js";
import { lines } from "../../../util/code-builder.js";
import { lowerFirst } from "../../../util/naming.js";
import { renderTsExpr, renderTsType } from "../render-expr.js";
import { renderTsStatements } from "../render-stmt.js";

// ---------------------------------------------------------------------------
// Enums + value objects emitted into one file.  Enums become
// `as const` objects + a literal-union type; value objects become
// classes with constructor-based invariant checks, VALUE equality
// (`equals()` — S9: a VO's defining property; reference identity is
// the entity semantics), getter-style `derived`, and public methods
// per `function`.
// ---------------------------------------------------------------------------

export function renderEnumsAndValueObjects(ctx: BoundedContextIR): string {
  const needsDomainError = ctx.valueObjects.some((v) => v.invariants.length > 0);
  // The import header keys on EVERY type position the file renders, not on the
  // fields alone: `renderTsType` maps `money` to decimal.js `Decimal` and an
  // `id` to `Ids.<Agg>Id`, and both spellings appear in the field
  // declarations, the constructor parameter list, the `derived` getter
  // signatures and each `function`'s params/return alike.  Scanning only the
  // fields is how a `valueobject` holding a cross-aggregate reference
  // (`ship: Ship id`) shipped a file with ZERO import statements and two
  // `TS2503: Cannot find namespace 'Ids'` — freight audit D3 / M-T6.64.  The
  // .NET emitter has always collected over the same four positions
  // (`emit/enums-vos.ts`), which is why only node was broken.
  //
  // Collected rather than added unconditionally so a scalar-only VO keeps a
  // clean header (the corpus is almost entirely scalar-only VOs, so this is
  // the byte-identical path for nearly every model).
  const usage: TsTypeUsage = { usesIds: false, usesMoney: false };
  for (const v of ctx.valueObjects) for (const t of renderedTypes(v)) visitTsTypeUsage(t, usage);
  return (
    lines(
      "// Auto-generated.",
      usage.usesMoney ? 'import Decimal from "decimal.js";' : null,
      // A VALUE import, matching `emit/aggregate.ts`: `domain/ids.ts` exports
      // the brand constructors alongside the branded types, so this stays
      // correct if a VO body ever renders one.
      usage.usesIds ? 'import * as Ids from "./ids";' : null,
      needsDomainError ? 'import { DomainError } from "./errors";' : null,
      "",
      ...ctx.enums.flatMap(renderEnum),
      ...ctx.valueObjects.flatMap(renderValueObject),
    ) + "\n"
  );
}

/** Which of the file's two importable type spellings a rendered `TypeIR`
 *  reaches — decimal.js `Decimal` (`money`) and the `Ids.<Agg>Id` namespace
 *  (an aggregate/entity id reference). */
interface TsTypeUsage {
  usesIds: boolean;
  usesMoney: boolean;
}

/** Every `TypeIR` `renderValueObject` puts through `renderTsType` below.  Kept
 *  next to that function so a new rendered type position cannot be added
 *  without the import header seeing it. */
function* renderedTypes(v: ValueObjectIR): Generator<TypeIR> {
  for (const f of v.fields) yield f.type;
  for (const d of v.derived) yield d.type;
  for (const fn of v.functions) {
    yield fn.returnType;
    for (const p of fn.params) yield p.type;
  }
}

/** Accumulate a rendered type's import needs.  Mirrors the recursion in
 *  `renderTypeWith` (`../_type/target.ts`) over the arms that carry a
 *  sub-type — an id inside `Ship id[]`, `Ship id?`, a generic argument or a
 *  union variant renders `Ids.` just the same.  `enum` / `valueobject` name a
 *  sibling declaration in THIS file, and `entity` / `slot` / `action` / `none`
 *  import nothing. */
function visitTsTypeUsage(t: TypeIR, acc: TsTypeUsage): void {
  switch (t.kind) {
    case "primitive":
      if (t.name === "money") acc.usesMoney = true;
      return;
    case "id":
      acc.usesIds = true;
      return;
    case "array":
      visitTsTypeUsage(t.element, acc);
      return;
    case "optional":
      visitTsTypeUsage(t.inner, acc);
      return;
    case "genericInstance":
      visitTsTypeUsage(t.arg, acc);
      return;
    case "union":
      for (const v of t.variants) visitTsTypeUsage(v, acc);
      return;
    default:
      return;
  }
}

function renderEnum(e: EnumIR): string[] {
  const valueLines = e.values.map((v, i) => `  ${v}: "${v}"${i < e.values.length - 1 ? "," : ""}`);
  const unionLiteral = e.values.map((v) => `"${v}"`).join(" | ");
  return [
    `export const ${e.name} = {`,
    ...valueLines,
    "} as const;",
    `export type ${e.name} = ${unionLiteral};`,
    "",
  ];
}

function renderValueObject(v: ValueObjectIR): string[] {
  // Explicit field declarations + constructor assignments, not TypeScript
  // parameter properties — the latter is non-erasable sugar the type
  // checker must desugar, which Node's `--experimental-strip-types` /
  // unflagged type stripping (Node 24) rejects outright
  // (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`); see docs/old/plans/dap-node-debug.md
  // "Non-erasable syntax". Semantically identical output otherwise.
  const fieldDecls = v.fields.map((f) => `  readonly ${f.name}: ${renderTsType(f.type)};`);
  const ctorParams = v.fields.map(
    (f, i) => `    ${f.name}: ${renderTsType(f.type)}${i < v.fields.length - 1 ? "," : ""}`,
  );
  const ctorAssignments = v.fields.map((f) => `    this.${f.name} = ${f.name};`);
  // Invariant violations throw DomainError, not a bare Error (S9): a VO
  // tripping on request input must surface through the ProblemDetails
  // taxonomy (400), never as an unclassified 500.
  const invariants = v.invariants.map((inv) => {
    const check = inv.guard
      ? `if ((${renderTsExpr(inv.guard)}) && !(${renderTsExpr(inv.expr)}))`
      : `if (!(${renderTsExpr(inv.expr)}))`;
    return `    ${check} throw new DomainError(${JSON.stringify(inv.message ? inv.message.text : `Invariant violated: ${inv.source}`)});`;
  });
  const derived = v.derived.map(
    (d) => `  get ${d.name}(): ${renderTsType(d.type)} { return ${renderTsExpr(d.expr)}; }`,
  );
  const fns = v.functions.flatMap((fn) => {
    const params = fn.params.map((p) => `${p.name}: ${renderTsType(p.type)}`).join(", ");
    // Value-object functions are part of the VO's public surface — they're
    // invoked across aggregate boundaries (e.g. `probability.asFraction()`
    // from an aggregate's derived field), so they cannot be `private`.
    const head = `  ${lowerFirst(fn.name)}(${params}): ${renderTsType(fn.returnType)}`;
    if ("expr" in fn.body) {
      return [`${head} { return ${renderTsExpr(fn.body.expr)}; }`];
    }
    return [`${head} {`, renderTsStatements(fn.body.stmts), `  }`];
  });
  // Value equality — field-wise, type-driven (nested VOs recurse through
  // their own `equals`, Decimal/Date compare by value, arrays element-wise).
  const fieldEqs = v.fields.map((f) => fieldEquals(`this.${f.name}`, `other.${f.name}`, f.type));
  const equalsBody = fieldEqs.length > 0 ? `return ${fieldEqs.join(" && ")};` : "return true;";
  return [
    `export class ${v.name} {`,
    ...fieldDecls,
    "  constructor(",
    ...ctorParams,
    "  ) {",
    ...ctorAssignments,
    ...invariants,
    "  }",
    "",
    `  equals(other: ${v.name}): boolean {`,
    `    ${equalsBody}`,
    "  }",
    "",
    ...derived,
    ...fns,
    "}",
    "",
  ];
}

/** A boolean expression comparing one VO field by VALUE.  Type-driven:
 *  `===` for primitives / branded ids / enum literals; `.equals(...)` for
 *  nested VOs and `money` (decimal.js `Decimal`); `getTime()` for `Date`;
 *  element-wise recursion for arrays; null-guarded recursion for optionals;
 *  structural JSON comparison for the open-shape `json` primitive. */
function fieldEquals(a: string, b: string, t: TypeIR): string {
  switch (t.kind) {
    case "primitive":
      if (t.name === "money") return `${a}.equals(${b})`;
      if (t.name === "datetime") return `${a}.getTime() === ${b}.getTime()`;
      if (t.name === "json") return `JSON.stringify(${a}) === JSON.stringify(${b})`;
      return `${a} === ${b}`;
    case "valueobject":
    case "entity":
      return `${a}.equals(${b})`;
    case "array":
      return `(${a}.length === ${b}.length && ${a}.every((__e, __i) => ${fieldEquals(
        "__e",
        `${b}[__i]!`,
        t.element,
      )}))`;
    case "optional":
      return `(${a} === null || ${b} === null ? ${a} === ${b} : ${fieldEquals(a, b, t.inner)})`;
    default:
      return `${a} === ${b}`;
  }
}
