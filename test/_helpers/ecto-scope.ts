// Test helpers over the generated Ecto read scope.
//
// A Phoenix/Ecto repository no longer spells an aggregate's restrictions at each
// read site.  They live once on the aggregate's SCHEMA module:
//
//   * `base_query/0` — the TPH `kind` discriminator and the restrictions no
//     `ignoring` can drop and that read no principal (a bare `filter`, a
//     `deny`).  Every read starts `from(record in <Agg>.base_query(), …)`.
//   * `__loom_filters__/0` + `__loom_filter__/3` — the bypassable capability
//     filters and the principal-bound ones, which the generated
//     `Repo.prepare_query/3` applies to every query of the schema, minus the
//     keys a read's `skip_filters:` option names (`:all` lifts every key but
//     `:loom_filter`).
//
// A test asks two questions of the emitted tree — "does this read start from
// the schema's scope, and what does it skip?" (the repository text) and "what
// does the scope say?" (the schema module) — so a site that inlines the
// predicate and leaves the schema unscoped no longer satisfies it.

/** The source of the module `defmodule <module> do` in an emitted file map. */
export function ectoModule(files: ReadonlyMap<string, string>, module: string): string {
  const head = `defmodule ${module} do\n`;
  const hit = [...files.values()].find((t) => t.includes(head));
  if (!hit) throw new Error(`no emitted module ${module}`);
  return hit;
}

/** `base_query/0`'s `where:` predicate, or null for a bare `from`. */
export function ectoBaseWhere(schema: string): string | null {
  const m =
    /^ {2}def base_query, do: Ecto\.Query\.from\(record in __MODULE__(?:, where: (.*))?\)$/m.exec(
      schema,
    );
  if (!m) throw new Error("the schema module defines no base_query/0");
  return m[1] ?? null;
}

/** The `__loom_filter__/3` clauses `Repo.prepare_query/3` actually applies —
 *  only the keys `__loom_filters__/0` registers — key → predicate. */
export function ectoFilters(schema: string): Map<string, string> {
  const reg = /^ {2}def __loom_filters__, do: \[(.*)\]$/m.exec(schema);
  if (!reg) throw new Error("the schema module defines no __loom_filters__/0");
  const registered = new Set(
    [...reg[1]!.matchAll(/\{:(\w+), (?:true|false)\}/g)].map((m) => m[1]!),
  );
  const out = new Map<string, string>();
  for (const m of schema.matchAll(
    /^ {2}def __loom_filter__\(query, :(\w+), _?current_user\),\n {4}do: Ecto\.Query\.where\(query, \[record\], (.*)\)$/gm,
  )) {
    if (registered.has(m[1]!)) out.set(m[1]!, m[2]!);
  }
  return out;
}

/** Every conjunct a read of `module` applies when it passes `skip`
 *  (`skip_filters:` — the keys it names, or `"all"`), as one text: the
 *  base-query predicate plus each `prepare_query` clause it does not lift. */
export function ectoScope(
  files: ReadonlyMap<string, string>,
  module: string,
  skip: readonly string[] | "all" = [],
): string {
  const schema = ectoModule(files, module);
  const terms: string[] = [];
  const base = ectoBaseWhere(schema);
  if (base) terms.push(base);
  for (const [key, pred] of ectoFilters(schema)) {
    const lifted = key !== "loom_filter" && (skip === "all" || skip.includes(key));
    if (!lifted) terms.push(pred);
  }
  return terms.join(" and ");
}
