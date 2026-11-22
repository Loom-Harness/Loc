// ---------------------------------------------------------------------------
// The names the generated runtime declares for itself — helper functions,
// option and process keys, logger names, framework-facing members — decided
// once per target.  An emitter that defines one of these names and every
// emitter that calls it read the same entry, so the definition and its uses
// cannot drift, and none of them carries the tool's name
// (docs/decisions/D-NO-TOOL-NAME.md, "Helpers and locals").
//
// A name that sits beside user names takes the target's reserved spelling: a
// leading `__` for an Elixir function or option key; a local a generated
// expression binds takes `freshName` against the names in scope.
// ---------------------------------------------------------------------------

export { DOTNET_RUNTIME } from "./runtime-names/dotnet.js";
export { ELIXIR_RUNTIME } from "./runtime-names/elixir.js";
export { JAVA_RUNTIME } from "./runtime-names/java.js";
export { PYTHON_RUNTIME } from "./runtime-names/python.js";
export { TS_RUNTIME } from "./runtime-names/ts.js";

/** `base`, or `base2`, `base3`, … — the first spelling no name in `taken`
 *  holds.  For a local a generated expression binds where the target refuses
 *  shadowing (a Java lambda parameter beside a local of the same name). */
export function freshName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
}
