// Test helpers over the generated drizzle read-scope helpers (`db/read-scopes.ts`).
//
// A drizzle repository no longer spells the `kind` scope or a capability
// predicate at each read and write site: it calls its aggregate's generated
// scope function (`docScope()`), and the predicate lives once in
// `db/read-scopes.ts`.  A test asks two questions of the emitted tree — "does
// this site call the scope?" (the repository text) and "what does the scope
// say?" (the helper's body) — so it can no longer be satisfied by a site that
// inlines the predicate and skips the helper.

/** The pooled helper module of an emitted file map (any project prefix). */
export function readScopesFile(files: ReadonlyMap<string, string>): string {
  const key = [...files.keys()].find((k) => k.endsWith("db/read-scopes.ts"));
  if (!key) throw new Error("db/read-scopes.ts was not emitted");
  return files.get(key)!;
}

/** The source of one scope function, `export function <name>(…) { … }`. */
export function scopeFn(files: ReadonlyMap<string, string>, name: string): string {
  const src = readScopesFile(files);
  const start = src.indexOf(`export function ${name}(`);
  if (start < 0) throw new Error(`no ${name} in db/read-scopes.ts`);
  const end = src.indexOf("\n}\n", start);
  return src.slice(start, end < 0 ? undefined : end + 3);
}

/** A generated file with every scope-helper call replaced by the predicate it
 *  stands for: `docScope()` → the helper's conjuncts, `docScope({ ignoring: "*" })`
 *  → the ones `ignoring *` leaves, `docScope({ write: true })` → the `kind` scope.
 *  A test that asks "does this read filter on X?" resolves the call first, so it
 *  asserts the predicate the site APPLIES rather than the spelling it uses. */
export function inlineDrizzleScope(files: ReadonlyMap<string, string>, text: string): string {
  return text.replace(/\b(\w+Scope)\((\{[^)]*\})?\)/g, (call, name: string, arg?: string) => {
    let fn: string;
    try {
      fn = scopeFn(files, name);
    } catch {
      return call;
    }
    const ignoring = /ignoring: "\*"/.test(arg ?? "")
      ? "*"
      : [...(arg ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    if (/write: true/.test(arg ?? "")) {
      const w = /if \(use\.write\) return (.+);/.exec(fn);
      return w ? w[1]! : call;
    }
    const terms: string[] = [];
    for (const line of fn.split("\n")) {
      const m = /^ {4}(?:drops\(use, "([^"]+)"\) \? undefined : )?(.+),$/.exec(line);
      if (!m) continue;
      const cap = m[1];
      if (cap && (ignoring === "*" || ignoring.includes(cap))) continue;
      terms.push(m[2]!);
    }
    return terms.length === 0
      ? "undefined"
      : terms.length === 1
        ? terms[0]!
        : `and(${terms.join(", ")})`;
  });
}
