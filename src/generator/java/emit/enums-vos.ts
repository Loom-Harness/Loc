// Enum → Java enum (constants keep the DSL casing — the wire serialises
// `name()`, so casing IS the cross-backend wire contract).  Value object
// → record with a compact constructor running the invariants (compact-
// constructor parameters carry the values; `this` is not yet available
// there, hence `bareProps`).

import type { EnumIR, ValueObjectIR } from "../../../ir/types/loom-ir.js";
import { lines } from "../../../util/code-builder.js";
import { isMangled, JSON_PROPERTY_IMPORT, jid, jsonProp } from "../java-ident.js";
import {
  buildJavaRegexFields,
  collectJavaExprImports,
  collectJavaRegexLiterals,
  collectJavaTypeImports,
  renderJavaExpr,
  renderJavaType,
} from "../render-expr.js";
import { collectJavaStmtImports, renderJavaStatements } from "../render-stmt.js";

export function renderJavaEnum(e: EnumIR, basePkg: string): string {
  // M-T6.36 — a `.ddd` enum VALUE named after a Java reserved word cannot be an
  // enum constant (`public enum Kind { case }` does not compile), so the
  // constant is mangled.  Two wire contracts then have to be restored, because
  // the constant NAME is both of them:
  //
  //   * JSON — `@JsonProperty("case")` on the constant (Jackson honours it in
  //     both directions for enums), so the request/response body and the
  //     springdoc `enum` list keep the `.ddd` spelling.
  //   * the COLUMN — `@Enumerated(EnumType.STRING)` persists `Enum.name()`,
  //     which would write `case_` where every other backend (and this project's
  //     own seed SQL) writes `case`.  The enum therefore carries a JPA
  //     `AttributeConverter` (`<Enum>.Codec`) over an explicit wire table, and
  //     `jpaFieldAnnotations` selects `@Convert` instead of `@Enumerated` for
  //     exactly the enums that need it (`JpaOpts.mangledEnums`).
  //
  // An enum with no reserved-word value emits byte-identically to before.
  const mangled = e.values.some((v) => isMangled(v));
  const valueLines = e.values.map(
    (v, i) =>
      `    ${mangled ? `@JsonProperty(${JSON.stringify(v)}) ` : ""}${jid(v)}${i < e.values.length - 1 ? "," : ";"}`,
  );
  // The trailing separator differs: a plain enum ends its last constant with
  // nothing, a codec-carrying one needs the `;` that opens the class body.
  if (!mangled && valueLines.length > 0) {
    valueLines[valueLines.length - 1] = valueLines[valueLines.length - 1]!.replace(/;$/, "");
  }
  return lines(
    `package ${basePkg}.domain.enums;`,
    ``,
    mangled ? `import ${JSON_PROPERTY_IMPORT};` : null,
    mangled ? `` : null,
    `public enum ${e.name} {`,
    ...valueLines,
    mangled ? enumWireCodec(e) : null,
    `}`,
    ``,
  );
}

/** The `<Enum>.Codec` JPA converter + its wire table, emitted only for an enum
 *  whose Java constants had to be mangled.  Keyed by ORDINAL, so the java
 *  constant order and the `.ddd` value order cannot drift apart. */
function enumWireCodec(e: EnumIR): string[] {
  return [
    ``,
    `    /** The .ddd spelling per constant, by ordinal — the value that reaches`,
    `     *  the column and the JSON wire. */`,
    `    private static final String[] __WIRE = { ${e.values.map((v) => JSON.stringify(v)).join(", ")} };`,
    ``,
    `    /** Persists the .ddd spelling rather than the mangled name(), so the`,
    `     *  column value matches every other backend and this project's seed SQL. */`,
    `    @jakarta.persistence.Converter`,
    `    public static class Codec implements jakarta.persistence.AttributeConverter<${e.name}, String> {`,
    `        @Override`,
    `        public String convertToDatabaseColumn(${e.name} value) {`,
    `            return value == null ? null : __WIRE[value.ordinal()];`,
    `        }`,
    ``,
    `        @Override`,
    `        public ${e.name} convertToEntityAttribute(String column) {`,
    `            if (column == null) return null;`,
    `            for (${e.name} value : values()) {`,
    `                if (__WIRE[value.ordinal()].equals(column)) return value;`,
    `            }`,
    `            throw new IllegalArgumentException("unknown ${e.name}: " + column);`,
    `        }`,
    `    }`,
  ];
}

export function renderJavaValueObject(vo: ValueObjectIR, basePkg: string): string {
  const javaImports = new Set<string>();
  for (const f of vo.fields) collectJavaTypeImports(f.type, javaImports);
  for (const inv of vo.invariants) {
    collectJavaExprImports(inv.expr, javaImports);
    if (inv.guard) collectJavaExprImports(inv.guard, javaImports);
  }
  for (const d of vo.derived) {
    collectJavaExprImports(d.expr, javaImports);
    collectJavaTypeImports(d.type, javaImports);
  }
  for (const fn of vo.functions) {
    if ("expr" in fn.body) collectJavaExprImports(fn.body.expr, javaImports);
    else collectJavaStmtImports(fn.body.stmts, javaImports);
    collectJavaTypeImports(fn.returnType, javaImports);
    for (const p of fn.params) collectJavaTypeImports(p.type, javaImports);
  }

  // Hoist `string.matches("…")` regex literals (invariants / derived / pure
  // expr-functions) into `private static final Pattern` fields so the compact
  // constructor — which runs on every construction AND Hibernate hydration —
  // reuses the compiled pattern instead of recompiling it.
  const regexLiterals = new Set<string>();
  for (const inv of vo.invariants) {
    collectJavaRegexLiterals(inv.expr, regexLiterals);
    if (inv.guard) collectJavaRegexLiterals(inv.guard, regexLiterals);
  }
  for (const d of vo.derived) collectJavaRegexLiterals(d.expr, regexLiterals);
  for (const fn of vo.functions) {
    if ("expr" in fn.body) collectJavaRegexLiterals(fn.body.expr, regexLiterals);
  }
  const regex = buildJavaRegexFields(regexLiterals);
  if (regex.decls.length > 0) javaImports.add("java.util.regex.Pattern");

  // Compact-constructor scope: parameters by bare name.
  const ctorCtx = { thisName: "this", bareProps: true, regexFields: regex.fields };
  // Method scope (derived / functions): accessors + fields are available.
  const methodCtx = { thisName: "this", regexFields: regex.fields };

  // A VO record component is a WIRE name twice over: Hibernate's JSON
  // FormatMapper serialises the record into a jsonb column (`shape: embedded`,
  // VO arrays) and Jackson serialises it wherever the record reaches a
  // response.  `jid` mangles only a Java reserved word, and `jsonProp` pins
  // the original spelling back onto the JSON property when it does.
  const params = vo.fields
    .map((f) => `${jsonProp(f.name, javaImports)}${renderJavaType(f.type)} ${jid(f.name)}`)
    .join(", ");
  const invariantLines = vo.invariants.map((inv) => {
    const check = inv.guard
      ? `if ((${renderJavaExpr(inv.guard, ctorCtx)}) && !(${renderJavaExpr(inv.expr, ctorCtx)}))`
      : `if (!(${renderJavaExpr(inv.expr, ctorCtx)}))`;
    return `        ${check} throw new DomainException(${JSON.stringify(inv.message ? inv.message.text : `Invariant violated: ${inv.source}`)});`;
  });
  const derivedLines = vo.derived.flatMap((d) => [
    `    public ${renderJavaType(d.type)} ${jid(d.name)}() {`,
    `        return ${renderJavaExpr(d.expr, methodCtx)};`,
    `    }`,
    ``,
  ]);
  const fnLines = vo.functions.flatMap((fn) => {
    const fnParams = fn.params.map((p) => `${renderJavaType(p.type)} ${jid(p.name)}`).join(", ");
    const open = `    private ${renderJavaType(fn.returnType)} ${jid(fn.name)}(${fnParams}) {`;
    const bodyLine =
      "expr" in fn.body
        ? `        return ${renderJavaExpr(fn.body.expr, methodCtx)};`
        : renderJavaStatements(fn.body.stmts, methodCtx);
    return [open, bodyLine, `    }`, ``];
  });

  const body = [...derivedLines, ...fnLines];
  while (body.length > 0 && body[body.length - 1] === "") body.pop();

  return lines(
    `package ${basePkg}.domain.valueobjects;`,
    ``,
    ...[...javaImports].sort().map((i) => `import ${i};`),
    javaImports.size > 0 ? `` : null,
    `import jakarta.persistence.Embeddable;`,
    `import org.jmolecules.ddd.annotation.ValueObject;`,
    ``,
    `import ${basePkg}.domain.common.DomainException;`,
    `import ${basePkg}.domain.enums.*;`,
    `import ${basePkg}.domain.ids.*;`,
    ``,
    // @Embeddable: Hibernate 6.2+ maps records as embedded components,
    // running the compact constructor (and so the invariants) on
    // hydration — same behaviour as the .NET explicit-ctor records.
    `@Embeddable`,
    `@ValueObject`,
    `public record ${vo.name}(${params}) {`,
    regex.decls.length > 0 ? regex.decls.map((d) => `    ${d}`) : null,
    regex.decls.length > 0 ? `` : null,
    vo.invariants.length > 0 ? `    public ${vo.name} {` : null,
    vo.invariants.length > 0 ? invariantLines : null,
    vo.invariants.length > 0 ? `    }` : null,
    body.length > 0 && vo.invariants.length > 0 ? `` : null,
    ...body,
    `}`,
    ``,
  );
}
