// Value-object equality in page-body expressions — the frontend half of the
// backends' value-equality `==` leaf.
//
// A value object's defining property is that it compares by VALUE: `a == b`
// (and `a.equals(b)`, which the lowerer turns into the same `binary ==` node)
// is true when the fields agree, on every backend.  On the four JS frontends a
// page-side value object is the PLAIN JSON object the wire delivered, so the
// host `===` compares REFERENCES — two parcels shipped to the same address
// rendered "different", and a VO compared with itself through two reads of a
// re-fetched query did too.  Dart is the same story (the generated wire models
// declare no `operator ==`, so `==` is `identical`).  F# records compare
// structurally already, and Elixir's `==` on maps is structural, so neither
// needs a helper — Feliz still takes the seam, to lift an optional/plain pair
// into one type.
//
// The walker consults `WalkerTarget.exprValueEquality` for every `==` / `!=`
// that `isValueObjectEquality` accepts; a target that omits the seam, and every
// scalar comparison, renders exactly as before.

import type { ExprIR, TypeIR } from "../../ir/types/loom-ir.js";
import { rewrite } from "../../util/emission-sink.js";

/** True iff `t` is, or structurally carries, a value object — the VO itself,
 *  an optional VO, a list of VOs, a generic carrier or union over one. */
export function typeContainsValueObject(t: TypeIR | undefined): boolean {
  if (!t) return false;
  switch (t.kind) {
    case "valueobject":
      return true;
    case "optional":
      return typeContainsValueObject(t.inner);
    case "array":
      return typeContainsValueObject(t.element);
    case "genericInstance":
      return typeContainsValueObject(t.arg);
    case "union":
      return t.variants.some(typeContainsValueObject);
    default:
      return false;
  }
}

function isNullLiteral(e: ExprIR): boolean {
  return e.kind === "literal" && e.lit === "null";
}

/** True iff this binary is a `==` / `!=` between value objects — either
 *  operand's lowered type is or contains a value object.  A comparison against
 *  the `null` literal is a presence test, not a value comparison, and keeps the
 *  host operator. */
export function isValueObjectEquality(e: Extract<ExprIR, { kind: "binary" }>): boolean {
  if (e.op !== "==" && e.op !== "!=") return false;
  if (isNullLiteral(e.left) || isNullLiteral(e.right)) return false;
  return typeContainsValueObject(e.leftType) || typeContainsValueObject(e.rightType);
}

/** The name of the emitted structural-equality helper, on every runtime that
 *  needs one (the four JS frontends and Flutter). */
export const VALUE_EQUALS_FN = "loomValueEquals";

/** True when rendered source calls the helper — the use-driven trigger for
 *  emitting its definition (and, on Angular, the component member). */
export function usesValueEquals(source: string): boolean {
  return /(?<![\w$.])loomValueEquals\(/.test(source);
}

/** True when rendered source already DEFINES the helper. */
function definesValueEquals(source: string): boolean {
  return source.includes(`function ${VALUE_EQUALS_FN}(`);
}

/** The call rendering, shared by the JS frontends and Flutter (Dart spells it
 *  identically): `loomValueEquals(a, b)` / `(!loomValueEquals(a, b))`. */
export function renderValueEqualsCall(left: string, right: string, op: string): string {
  const call = `${VALUE_EQUALS_FN}(${left}, ${right})`;
  return op === "!=" ? `(!${call})` : call;
}

/** The TypeScript helper the JS frontends emit into a file that calls it.
 *
 *  Structural over the shapes a page-side value can take: plain wire objects
 *  and arrays recurse field by field; an absent optional field (`undefined`,
 *  missing, or `null` — the wire and a page-built value spell "no value"
 *  differently) equals another absent one; a `Date` compares by instant; an
 *  object with its own `equals` (a decimal.js `Decimal` — `money`) compares
 *  through it, so `1.5` and `1.50` are the same amount. */
export function jsValueEqualsHelper(indent = ""): string {
  return [
    "/** Loom value equality — value objects compare by their fields, not by reference. */",
    `function ${VALUE_EQUALS_FN}(a: unknown, b: unknown): boolean {`,
    "  const absent = (v: unknown): boolean => v === null || v === undefined;",
    "  if (a === b || (absent(a) && absent(b))) return true;",
    '  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;',
    "  if (a instanceof Date || b instanceof Date) {",
    "    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();",
    "  }",
    "  const eqA = (a as { equals?: unknown }).equals;",
    "  const eqB = (b as { equals?: unknown }).equals;",
    '  if (typeof eqA === "function" || typeof eqB === "function") {',
    '    return typeof eqA === "function" && typeof eqB === "function" && eqA.call(a, b) === true;',
    "  }",
    "  if (Array.isArray(a) || Array.isArray(b)) {",
    "    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;",
    `    return a.every((x, i) => ${VALUE_EQUALS_FN}(x, b[i]));`,
    "  }",
    "  const ra = a as Record<string, unknown>;",
    "  const rb = b as Record<string, unknown>;",
    "  for (const k of Object.keys(ra).concat(Object.keys(rb))) {",
    `    if (!${VALUE_EQUALS_FN}(ra[k], rb[k])) return false;`,
    "  }",
    "  return true;",
    "}",
  ]
    .map((l) => `${indent}${l}`)
    .join("\n");
}

/** Append the helper to a module-scoped script (`.tsx`, Angular `.ts`) that
 *  calls it.  A hoisted `function` declaration, so its position is free. */
export function withJsValueEqualsAppended(source: string): string {
  if (!usesValueEquals(source) || definesValueEquals(source)) return source;
  return `${source.replace(/\n*$/, "\n")}\n${jsValueEqualsHelper()}\n`;
}

/** Insert the helper into the instance `<script …>` block of an SFC (Vue
 *  `<script setup lang="ts">`, Svelte `<script lang="ts">`) that calls it —
 *  both expose script-scoped bindings to their markup. */
export function withJsValueEqualsInScript(file: string, openTag: string, indent: string): string {
  if (!usesValueEquals(file) || definesValueEquals(file)) return file;
  const at = file.indexOf(openTag);
  if (at < 0) return file;
  const close = file.indexOf("</script>", at);
  if (close < 0) return file;
  const head = file.slice(0, close).replace(/\n*$/, "\n");
  return `${head}\n${jsValueEqualsHelper(indent)}\n${file.slice(close)}`;
}

/** An Angular template resolves identifiers against the component INSTANCE,
 *  never module scope, so the helper is also re-exposed as a class member —
 *  the same hoist the page shell gives `Math` / `Decimal`. */
function withAngularMember(source: string): string {
  const member = `  protected readonly ${VALUE_EQUALS_FN} = ${VALUE_EQUALS_FN};`;
  if (source.includes(member)) return source;
  return source.replace(
    /^(export class \w+[^{\n]*)\{(\}?)$/m,
    (_m, head: string, closed: string) =>
      closed ? `${head}{\n${member}\n}` : `${head}{\n${member}`,
  );
}

/** Post-pass over a JS frontend's finished output: every file whose rendered
 *  code calls `loomValueEquals(` gets the helper's definition in the scope its
 *  markup reads — the instance `<script>` of a Vue / Svelte SFC, module scope
 *  of a `.ts` / `.tsx` file (plus the component member on Angular).  Decided
 *  by scanning the FINISHED files, so a call from any producer (page, user
 *  component, hoisted grid child, store action) cannot miss its definition,
 *  and a project with no value-object comparison is untouched byte for byte. */
export function emitJsValueEqualsHelpers(out: Map<string, string>): void {
  for (const [path, content] of [...out]) {
    if (!usesValueEquals(content) || definesValueEquals(content)) continue;
    let next = content;
    if (path.endsWith(".vue")) {
      next = withJsValueEqualsInScript(content, '<script setup lang="ts">', "");
    } else if (path.endsWith(".svelte")) {
      next = withJsValueEqualsInScript(content, '<script lang="ts">', "  ");
    } else if (/\.(ts|tsx)$/.test(path)) {
      next = withJsValueEqualsAppended(content);
      if (content.includes("@Component(")) next = withAngularMember(next);
    }
    if (next !== content) rewrite(out, path, next);
  }
}
