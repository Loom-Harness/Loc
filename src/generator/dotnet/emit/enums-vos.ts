import type { EnumIR, ValueObjectIR } from "../../../ir/types/loom-ir.js";
import { lines } from "../../../util/code-builder.js";
import { messageCode } from "../../../util/message-code.js";
import { upperFirst } from "../../../util/naming.js";
import { csMemberScope, csParamIdent, typeMemberNames } from "../bcl-collision.js";
import {
  collectCsExprUsings,
  collectCsTypeUsings,
  renderCsExpr,
  renderCsType,
} from "../render-expr.js";
import { collectCsStmtUsings, renderCsStatements } from "../render-stmt.js";

// Enum → C# enum.  Value object → sealed record with explicit
// constructors (so invariants always run; positional records would
// skip the invariant block).

export function renderEnum(e: EnumIR, ns: string): string {
  const valueLines = e.values.map((v, i) => `    ${v}${i < e.values.length - 1 ? "," : ""}`);
  return (
    lines(
      "// Auto-generated.",
      `namespace ${ns}.Domain.Enums;`,
      "",
      `public enum ${e.name}`,
      "{",
      ...valueLines,
      "}",
    ) + "\n"
  );
}

export function renderValueObject(vo: ValueObjectIR, ns: string): string {
  // Non-implicit namespaces this value object's rendered expressions
  // reach into (e.g. System.Text.RegularExpressions for an invariant
  // using `value.matches(...)`), collected over the same invariant /
  // derived / function bodies rendered below.
  const usings = new Set<string>();
  for (const inv of vo.invariants) {
    collectCsExprUsings(inv.expr, usings, ns);
    if (inv.guard) collectCsExprUsings(inv.guard, usings, ns);
  }
  for (const d of vo.derived) collectCsExprUsings(d.expr, usings, ns);
  for (const fn of vo.functions) {
    if ("expr" in fn.body) collectCsExprUsings(fn.body.expr, usings, ns);
    else collectCsStmtUsings(fn.body.stmts, usings, ns);
  }
  // …and the namespaces its rendered TYPES name.  The expression collectors
  // above see only what a BODY reaches into, but every position below renders
  // a `TypeIR` too — the property declarations, the constructor parameter
  // list, the derived-property types and each function's params/return.  An
  // enum-typed field (`country: Country`) renders a bare `Country` in three of
  // them and lives in `<ns>.Domain.Enums`, a namespace no expression here
  // mentions: without this the file does not compile (CS0246), which is
  // exactly what the ERP example's `Address` / `Quantity` hit.  Collected
  // rather than added unconditionally so a VO with no enum/id field keeps a
  // using-clean header under `/warnaserror` (CS8019).
  for (const f of vo.fields) collectCsTypeUsings(f.type, usings, ns);
  for (const d of vo.derived) collectCsTypeUsings(d.type, usings, ns);
  for (const fn of vo.functions) {
    collectCsTypeUsings(fn.returnType, usings, ns);
    for (const p of fn.params) collectCsTypeUsings(p.type, usings, ns);
  }
  // A field spelled like a static receiver (`Math`, `Regex`, the `System`
  // root, …) shadows it inside the record — see bcl-collision.ts.
  const renderCtx = { thisName: "this", memberScope: csMemberScope(typeMemberNames(vo), ns) };
  const propLines = vo.fields.map(
    (f) => `    public ${renderCsType(f.type)} ${upperFirst(f.name)} { get; init; }`,
  );
  // A field spelled with a capital (`Guid: string`) would give a constructor
  // parameter identical to its property — `Guid = Guid;` assigns the parameter
  // to itself (CS1717 + CS8618) — so such a parameter is renamed (`guid`).
  // `csParamIdent` is the identity for an ordinary lower-case field.
  const ctorParam = (name: string): string =>
    renderCtx.memberScope.members.has(name) ? csParamIdent(name, renderCtx.memberScope) : name;
  const ctorParams = vo.fields
    .map((f) => `${renderCsType(f.type)} ${ctorParam(f.name)}`)
    .join(", ");
  const ctorAssignments = vo.fields.map(
    (f) => `        ${upperFirst(f.name)} = ${ctorParam(f.name)};`,
  );
  const invariantLines = vo.invariants.map((inv) => {
    const check = inv.guard
      ? `if ((${renderCsExpr(inv.guard, renderCtx)}) && !(${renderCsExpr(inv.expr, renderCtx)}))`
      : `if (!(${renderCsExpr(inv.expr, renderCtx)}))`;
    const text = inv.message ? inv.message.text : `Invariant violated: ${inv.source}`;
    // M-T5.1 — its own exception, answered with an errors[] entry; a messaged
    // rule carries the wire rung's content-hash code.
    const code = inv.message ? `, ${JSON.stringify(messageCode(inv.message.text))}` : "";
    return `        ${check} throw new ValueObjectInvariantException(${JSON.stringify(vo.name)}, ${JSON.stringify(text)}${code});`;
  });
  const efCtorAssignments = vo.fields.map((f) => `        ${upperFirst(f.name)} = default!;`);
  const derivedLines = vo.derived.map(
    (d) =>
      `    public ${renderCsType(d.type)} ${upperFirst(d.name)} => ${renderCsExpr(d.expr, renderCtx)};`,
  );
  const fnLines = vo.functions.flatMap((fn) => {
    const params = fn.params
      .map((p) => `${renderCsType(p.type)} ${csParamIdent(p.name, renderCtx.memberScope)}`)
      .join(", ");
    const head = `    private ${renderCsType(fn.returnType)} ${upperFirst(fn.name)}(${params})`;
    if ("expr" in fn.body) {
      return [`${head} => ${renderCsExpr(fn.body.expr, renderCtx)};`];
    }
    const body = renderCsStatements(fn.body.stmts, renderCtx);
    return [head, "    {", ...(body.length > 0 ? [body] : []), "    }"];
  });

  const extraUsings = [...usings].sort().map((n) => `using ${n};`);
  return (
    lines(
      "// Auto-generated.",
      "using System;",
      ...extraUsings,
      `using ${ns}.Domain.Common;`,
      "",
      `namespace ${ns}.Domain.ValueObjects;`,
      "",
      `public sealed record ${vo.name}`,
      "{",
      ...propLines,
      `    public ${vo.name}(${ctorParams})`,
      "    {",
      ...ctorAssignments,
      ...invariantLines,
      "    }",
      "",
      "    /// <summary>Parameterless constructor reserved for EF Core / serializers.</summary>",
      `    private ${vo.name}()`,
      "    {",
      ...efCtorAssignments,
      "    }",
      "",
      ...derivedLines,
      ...fnLines,
      "}",
    ) + "\n"
  );
}
