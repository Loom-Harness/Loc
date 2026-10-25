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

/** The C# names of the parameters a repository read method appends after the
 *  `.ddd` declaration's own: the call-site `page` window and the domain
 *  `bypass` (retrievals), and the trailing `cancellationToken` (every read).
 *
 *  A `.ddd` read param may be spelled like one of them (`find byToken(
 *  cancellationToken: string)`), which C# rejects as a duplicate parameter
 *  (CS0100).  The method's own parameter is the one that yields
 *  (`__`-prefixed), by the same rule as `csLocalNamer`: the declared param is
 *  the public surface (the query record, the Spec ctor, the Dapper `@<name>`
 *  placeholder), while these three are .NET plumbing no `.ddd` source names.
 *  Unlike `page`/`pageSize`/`sort`/`dir` on a paged read
 *  (`loom.paged-param-reserved`), none of them is a wire key, so a rename is
 *  honest and nothing is refused.  Every caller that passes one of them by
 *  name — a workflow's `Repo.run(...)`, a domain service's criterion read —
 *  resolves the names through this function, so the interface, both adapters
 *  and the call sites agree. */
export function csReadOwnParams(paramNames: Iterable<string>): {
  page: string;
  bypass: string;
  ct: string;
} {
  const own = csLocalNamer(paramNames);
  return { page: own("page"), bypass: own("bypass"), ct: own("cancellationToken") };
}
