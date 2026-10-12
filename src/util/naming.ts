import { escapeTargetIdent } from "./target-identifiers.js";

/** Uppercase the first character only — the rest is left untouched.
 *  Intended for identifiers that are already camelCase / PascalCase
 *  (`"addLine" → "AddLine"`), NOT a full case converter: a snake_case
 *  input keeps its underscores (`"add_line" → "Add_line"`). */
export function upperFirst(input: string): string {
  if (!input) return input;
  return input[0]!.toUpperCase() + input.slice(1);
}

/** Lowercase the first character only — the rest is left untouched.
 *  See {@link upperFirst}: input is assumed already camel/Pascal. */
export function lowerFirst(input: string): string {
  if (!input) return input;
  return input[0]!.toLowerCase() + input.slice(1);
}

export function snake(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

export function plural(input: string): string {
  if (input.endsWith("y") && !/[aeiou]y$/.test(input)) {
    return input.slice(0, -1) + "ies";
  }
  if (/(s|x|z|ch|sh)$/.test(input)) return input + "es";
  return input + "s";
}

/** Per-workflow-scoped name for an emitted workflow `function` helper.
 *  A workflow body is not a class, so its `function` helpers are emitted as
 *  file/module-scoped helpers — and workflows share a generated file, so the
 *  helper is namespaced by its workflow (`placeOrder` + `slaDays`).  The call
 *  site (render-expr, `callKind: "workflow-fn"`) and the definition site (each
 *  backend's workflow emitter) must agree byte-for-byte, so BOTH route through
 *  these — one per target-language casing.  Source identifiers are already
 *  camelCase, so first-letter casing is all that's needed.  See docs/workflow.md. */
export function workflowFnCamel(wf: string, fn: string): string {
  return `${lowerFirst(wf)}${upperFirst(fn)}`;
}
export function workflowFnPascal(wf: string, fn: string): string {
  return `${upperFirst(wf)}${upperFirst(fn)}`;
}
export function workflowFnSnake(wf: string, fn: string): string {
  return `${snake(wf)}_${snake(fn)}`;
}

/** Convert an identifier (camelCase, PascalCase, snake_case) into a
 *  human-friendly Title Case label suitable for UI display.
 *  Examples: "customerId" → "Customer Id"; "placedAt" → "Placed At";
 *  "addLine" → "Add Line"; "order_total" → "Order Total".
 *  Common acronyms are passed through capitalised, not split. */
export function humanize(input: string): string {
  if (!input) return input;
  const words = input
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim()
    .split(/\s+/);
  return words.map((w) => (w.length === 0 ? w : w[0]!.toUpperCase() + w.slice(1))).join(" ");
}

// ---------------------------------------------------------------------------
// Target-language keyword escaping for emitted local identifiers.
//
// A Loom `let`-binding may be named after a reserved word in a target
// language — `let base = …` is legal Loom but `base` is a C# keyword, so
// `var base = …` fails to compile.  Each backend renders the *same* local
// name at the binding AND every `refKind: "let"` use; routing both through the
// matching `escape<Lang>Ident` keeps the rename consistent.
//
// Only names that actually collide with a reserved word are rewritten — a
// non-keyword name passes through byte-identically (no churn for the common
// case).  This is a cross-layer naming concern (the generators are the
// consumers), so it lives here alongside the other casing helpers.
// ---------------------------------------------------------------------------

/** Escape a local identifier that collides with a C# keyword using the
 *  verbatim-identifier prefix (`base` → `@base`); pass through otherwise. */
export function escapeCsharpIdent(name: string): string {
  return escapeTargetIdent("csharp", name);
}

/** Escape a local identifier that collides with a TS/JS reserved word with a
 *  trailing underscore (`new` → `new_`); pass through otherwise. */
export function escapeTsIdent(name: string): string {
  return escapeTargetIdent("ts", name);
}

/** Escape a local identifier that collides with a Java reserved word with a
 *  trailing underscore (`class` → `class_`); pass through otherwise. */
export function escapeJavaIdent(name: string): string {
  return escapeTargetIdent("java", name);
}

/** Escape a (already snake_cased) local identifier that collides with a
 *  Python keyword with a trailing underscore (`class` → `class_`); pass
 *  through otherwise. */
export function escapePythonIdent(name: string): string {
  return escapeTargetIdent("python", name);
}

/** The python MEMBER-identifier funnel (eval item 6, ruling D2 — the python
 *  twin of java's M-T6.36): the snake_cased python spelling of a `.ddd`
 *  field / part / derived / function / operation / parameter name, escaped
 *  with a trailing underscore when it is a python keyword (`def` → `def_`,
 *  `class` → `class_`).  Every python site that spells a `.ddd` name as a
 *  bare IDENTIFIER — an attribute, a keyword argument, a `def` name — goes
 *  through this, so the declaration and every use agree.  The names the
 *  outside world sees are NOT funnelled: the DB column keeps the snake name
 *  (`mapped_column("def", …)`) and the wire keeps the declared name (a
 *  pydantic `alias`), exactly as java keeps them via `@Column` /
 *  `@JsonProperty`. */
export function pythonIdent(name: string): string {
  return escapePythonIdent(snake(name));
}

/** The python WIRE-model attribute for a `.ddd` name: the pydantic HTTP
 *  models keep the declared camelCase spelling as the attribute (it IS the
 *  JSON key), so only a keyword collision is escaped (`def` → `def_`) — and
 *  the emitter pairs an escaped attribute with `Field(alias="def")` so the
 *  wire key does not move.  See {@link pythonIdent}. */
export function pythonWireIdent(name: string): string {
  return escapePythonIdent(name);
}

/** True when {@link pythonWireIdent} moved the name — the attribute needs an
 *  explicit wire alias. */
export function pythonWireNeedsAlias(name: string): boolean {
  return pythonWireIdent(name) !== name;
}

/** Escape a (already snake_cased) local identifier that collides with an
 *  Elixir reserved word with a trailing underscore (`end` → `end_`); pass
 *  through otherwise. */
export function escapeElixirIdent(name: string): string {
  return escapeTargetIdent("elixir", name);
}

/** The elixir LOCAL-variable funnel for a `.ddd` name — a parameter, a
 *  function argument, a bound op input: the snake spelling, escaped when it is
 *  an elixir reserved word (`do` → `do_`, `end` → `end_`).  Atoms and map keys
 *  (`:do`, `"do" =>`, `do:` in an Ecto `cast`) keep the plain snake name — the
 *  escape is a host-binding concern only, never a wire or column name. */
export function elixirLocal(name: string): string {
  return escapeElixirIdent(snake(name));
}

/** The Phoenix CONTROLLER ACTION an aggregate operation is served by: the
 *  escaped local spelling (`do` → `do_`), stepped aside from the read actions
 *  every resource controller already defines.  An operation named `show` /
 *  `index` would otherwise add a second `def show/2` clause the CRUD read
 *  shadows ("this clause cannot match"), silently unreachable.  The route PATH
 *  keeps the declared name; only the action atom moves. */
export function elixirOpAction(name: string): string {
  const a = elixirLocal(name);
  return a === "index" || a === "show" ? `${a}_op` : a;
}

// ---------------------------------------------------------------------------
// Target-language string / regex materialization for `.ddd`-sourced values.
//
// A string literal or regex pattern written in `.ddd` source is spliced into
// generated target source.  Most backends can re-quote with `JSON.stringify`
// (C#/Java/Python/TS double-quoted string literals do NOT interpolate `{`), but
// Elixir does: a double-quoted string interpolates `#{…}` and a `~r/…/` regex
// sigil both interpolates `#{…}` AND ends at an unescaped `/`.  Left raw, a
// pattern like `"hi#{System.cmd(...)}"` executes at compile time and a `/`
// closes the sigil early — an injection / compile-break class.  These helpers
// are the single funnel every Elixir emit site shares so the escaping can't
// drift one renderer at a time.
// ---------------------------------------------------------------------------

/** A safe Elixir double-quoted string literal for a `.ddd`-sourced value.
 *  `JSON.stringify` handles `"` / `\` / control chars; the extra pass escapes
 *  `#{` → `\#{` so Elixir string interpolation can't fire (`"a#{x}"` would
 *  otherwise interpolate `x`).  Elixir reads `\#` as a literal `#`. */
export function elixirString(value: string): string {
  return JSON.stringify(value).replace(/#\{/g, "\\#{");
}

/** Escape a `.ddd`-sourced regex pattern for embedding in an Elixir `~r/…/`
 *  sigil.  A raw `/` closes the sigil and a raw `#{` interpolates; escaping
 *  both (`\/`, `\#{`) keeps the pattern a literal regex.  Regex backslashes
 *  (`\d`, `\w`) are already meaningful and pass through untouched. */
export function elixirRegexBody(pattern: string): string {
  return pattern.replace(/#\{/g, "\\#{").replace(/\//g, "\\/");
}

export function indent(text: string, level = 1, unit = "  "): string {
  const pad = unit.repeat(level);
  return text
    .split("\n")
    .map((l) => (l.length === 0 ? l : pad + l))
    .join("\n");
}
