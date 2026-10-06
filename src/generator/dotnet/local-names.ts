// Collision-safe names for the locals a generated C# method declares for
// itself.
//
// A repository method (`find`, `Run<Name>Async`, the paged twin) takes the
// `.ddd` declaration's params VERBATIM as C# parameters, then declares its own
// plumbing locals — `conn`, `rows`, `r`, `p`, `sql`, `pg`, `total`, `items`, …
// A `.ddd` param spelled like one of those is legal Loom, and C# rejects the
// method body: CS0136 (a local re-declaring a parameter's name) plus a cascade
// of CS0841 / CS0019 where the predicate then reads the local instead of the
// param.
//
// The method's own local is the thing that moves — never the param, whose name
// is the public C# surface (interface, controller, query handler) AND, on the
// Dapper adapter, the `@<name>` SQL placeholder / DynamicParameters key.  It
// moves ONLY on a collision, so every model whose params miss the local set
// emits byte-identically.

/** A namer for one method scope: `local(base)` is `base` unless a parameter is
 *  spelled that way, in which case it gains a `__` prefix until it is free of
 *  both the parameters and `scopeLocals` (the method's other own locals, so a
 *  renamed `rows` cannot land on a sibling `__rows`). */
export function csLocalNamer(
  paramNames: Iterable<string>,
  scopeLocals: Iterable<string> = [],
): (base: string) => string {
  const params = new Set(paramNames);
  const locals = new Set(scopeLocals);
  return (base: string) => {
    let n = base;
    while (params.has(n) || (n !== base && locals.has(n))) n = `__${n}`;
    return n;
  };
}
