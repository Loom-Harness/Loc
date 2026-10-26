// Test helpers over the generated Dapper `<Agg>Scope` helper class.
//
// A Dapper repository no longer spells the `kind` scope or a capability
// predicate at each statement: it concatenates a member of its aggregate's
// generated scope class (`"… WHERE id = @id AND " + OrderScope.Where`).  A test
// that asks "does this statement filter on X?" resolves the members first, so
// it asserts the SQL the statement RUNS rather than the spelling it is written in.

/** The generated `internal static class <Agg>Scope { … }` block, or "" when the file has none. */
export function dapperScopeClass(src: string): string {
  const m = /\n\/\/\/ <summary>The read scope of this aggregate[\s\S]*$/.exec(src);
  return m ? m[0] : "";
}

/** `<Agg>Scope.<Member>` → the SQL constant it holds, for every constant of the file's scope class. */
function scopeConstants(src: string): Map<string, string> {
  const consts = new Map<string, string>();
  const cls = dapperScopeClass(src);
  for (const c of cls.matchAll(/internal static class (\w+)\s*\{([\s\S]*?)\n\}/g)) {
    for (const k of c[2]!.matchAll(/public const string (\w+) = "(.*?)";(?:\n|$)/g)) {
      consts.set(`${c[1]}.${k[1]}`, k[2]!);
    }
  }
  return consts;
}

/** The repository source with every scope-constant reference replaced by the SQL it
 *  holds (the scope class itself is dropped).  `OrderScope.Runtime(bypass)` is left
 *  as is — it is a method, asserted through {@link dapperScopeClass}. */
export function inlineDapperScope(src: string): string {
  const consts = scopeConstants(src);
  const body = src.slice(0, src.length - dapperScopeClass(src).length);
  return body
    .replace(/\{(\w+Scope\.\w+)\}/g, (m, k: string) => consts.get(k) ?? m)
    .replace(/"\s*\+\s*(\w+Scope\.\w+)\s*\+\s*"/g, (m, k: string) => consts.get(k) ?? m)
    .replace(/"\s*\+\s*(\w+Scope\.\w+)(?=[,)])/g, (m, k: string) =>
      consts.has(k) ? `${consts.get(k)}"` : m,
    );
}
