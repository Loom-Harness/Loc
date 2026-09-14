import { escapeJavaIdent } from "../../util/naming.js";

// ---------------------------------------------------------------------------
// M-T6.36 — a `.ddd` member / parameter named after a JAVA reserved word.
//
// THE ASYMMETRY THIS EXISTS FOR.  Every other backend can spell a reserved
// name in host-identifier position without moving the wire: C# has verbatim
// identifiers (`@case` IS lexically `case`, so System.Text.Json derives the
// same JSON property), TS/JS allow any property name, python and elixir escape
// LOCALS only and never had to touch a declared field.  Java has no verbatim
// identifier (JLS §3.9), so the only escape is a RENAME — and a Java record
// component name is also the Jackson property name and the springdoc schema
// key.  Renaming alone would therefore move `{"case": …}` to `{"case_": …}`
// on java alone, which is a silent wire divergence: strictly worse than the
// compile error it replaces.
//
// THE RULE, in two halves that must always travel together:
//
//   * `jid(name)` — the HOST identifier.  `escapeJavaIdent`'s trailing
//     underscore (`case` → `case_`), the spelling the java emitters already
//     use for `let` bindings.  Identity for every non-keyword name, so
//     applying it at a site is byte-identical for every model that does not
//     name a keyword.
//   * `jsonProp(name, imports)` — the WIRE key.  An explicit
//     `@JsonProperty("case")` in front of the mangled record component /
//     setter, so the JSON property, the OpenAPI schema key and the query
//     parameter keep the `.ddd` spelling.  Empty string when nothing was
//     mangled, so a keyword-free DTO stays byte-identical too.
//
// A site that mangles without the annotation is the defect this module is
// meant to make impossible to write by accident, which is why the two live in
// one file and why `test/generator/java/java-reserved-identifier.test.ts`
// sweeps the emitted project for a mangled name appearing in any WIRE
// position.
// ---------------------------------------------------------------------------

/** The Jackson annotation type every mangled wire site imports. */
export const JSON_PROPERTY_IMPORT = "com.fasterxml.jackson.annotation.JsonProperty";

/** Host identifier for a `.ddd`-authored member / parameter name: identity
 *  unless the name is a Java reserved word, which mangles to `<name>_`. */
export function jid(name: string): string {
  return escapeJavaIdent(name);
}

/** Was this `.ddd` name mangled to reach a legal Java identifier? */
export function isMangled(name: string): boolean {
  return jid(name) !== name;
}

/** `@JsonProperty("<wire name>") ` prefix for a wire-carrying declaration
 *  whose host identifier had to be mangled; `""` otherwise.  Registers the
 *  Jackson import on `imports` when it emits, so a caller cannot emit the
 *  annotation and forget the import. */
export function jsonProp(name: string, imports?: Set<string>): string {
  if (!isMangled(name)) return "";
  imports?.add(JSON_PROPERTY_IMPORT);
  return `@JsonProperty("${name}") `;
}

/** Every `.ddd` member / parameter name in a context whose Java identifier had
 *  to be mangled.  The generated exception advice needs the INVERSE map so a
 *  Bean-Validation / `rejectValue` path (`do_`) converts back to the wire
 *  pointer (`/do`) every other backend publishes.  Sorted, so the emitted map
 *  is stable; empty for every project that names no reserved word, which keeps
 *  the advice byte-identical. */
export function collectMangledNames(ctx: {
  readonly aggregates: readonly MangleScanAggregate[];
  readonly valueObjects: readonly { readonly fields: readonly NamedIsh[] }[];
  readonly events: readonly { readonly fields: readonly NamedIsh[] }[];
  readonly projections?: readonly {
    readonly stateFields?: readonly NamedIsh[];
    readonly params?: readonly NamedIsh[];
  }[];
  readonly workflows?: readonly {
    readonly stateFields?: readonly NamedIsh[];
    readonly params?: readonly NamedIsh[];
  }[];
}): string[] {
  const out = new Set<string>();
  const take = (xs: readonly NamedIsh[] | undefined): void => {
    for (const x of xs ?? []) if (isMangled(x.name)) out.add(x.name);
  };
  for (const agg of ctx.aggregates) {
    take(agg.fields);
    take(agg.contains);
    take(agg.derived);
    for (const op of [...agg.operations, ...(agg.creates ?? []), ...(agg.destroys ?? [])]) {
      if (isMangled(op.name)) out.add(op.name);
      take(op.params);
    }
    for (const fn of agg.functions ?? []) {
      if (isMangled(fn.name)) out.add(fn.name);
      take(fn.params);
    }
    for (const part of agg.parts ?? []) {
      take(part.fields);
      take(part.contains);
      take(part.derived);
    }
  }
  for (const vo of ctx.valueObjects) take(vo.fields);
  for (const ev of ctx.events) take(ev.fields);
  for (const p of ctx.projections ?? []) {
    take(p.stateFields);
    take(p.params);
  }
  for (const w of ctx.workflows ?? []) {
    take(w.stateFields);
    take(w.params);
  }
  return [...out].sort();
}

interface NamedIsh {
  readonly name: string;
}

interface MangleScanAggregate {
  readonly fields: readonly NamedIsh[];
  readonly contains: readonly NamedIsh[];
  readonly derived: readonly NamedIsh[];
  readonly operations: readonly { readonly name: string; readonly params: readonly NamedIsh[] }[];
  readonly creates?: readonly { readonly name: string; readonly params: readonly NamedIsh[] }[];
  readonly destroys?: readonly { readonly name: string; readonly params: readonly NamedIsh[] }[];
  readonly functions?: readonly { readonly name: string; readonly params: readonly NamedIsh[] }[];
  readonly parts?: readonly {
    readonly fields: readonly NamedIsh[];
    readonly contains: readonly NamedIsh[];
    readonly derived: readonly NamedIsh[];
  }[];
}

/** `@RequestParam` binding annotation for a `.ddd` param.  Spring derives the
 *  query-parameter key from the Java parameter NAME, so a mangled identifier
 *  has to name its wire key explicitly — `@RequestParam("case") String case_`.
 *  Bare `@RequestParam` for every non-keyword name (output unmoved). */
export function requestParam(name: string): string {
  return isMangled(name) ? `@RequestParam("${name}")` : "@RequestParam";
}

/** Enum names in a context with at least one Java-reserved-word value — the
 *  enums whose java constants are mangled and whose columns therefore persist
 *  through the generated `<Enum>.Codec` converter (M-T6.36).  Empty for every
 *  keyword-free model, which is what keeps the JPA annotations byte-identical. */
export function mangledEnumNames(
  enums: readonly { readonly name: string; readonly values: readonly string[] }[],
): ReadonlySet<string> {
  return new Set(enums.filter((e) => e.values.some(isMangled)).map((e) => e.name));
}
