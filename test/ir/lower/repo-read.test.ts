import { describe, expect, it } from "vitest";
import {
  matchAllCall,
  matchFindCall,
  matchRepoCall,
  matchRepoRead,
  repoReadResultType,
} from "../../../src/ir/lower/repo-read.js";
import {
  type BoundedContext,
  type Expression,
  isBoundedContext,
  isDomainService,
  isRepository,
  isSubdomain,
  isSystem,
  type Repository,
} from "../../../src/language/generated/ast.js";
import {
  classifyRepoArg,
  type QueryNames,
  queryNamesOf,
} from "../../../src/language/repo-query-arg.js";
import { parseString } from "../../_helpers/parse.js";

// `repo-read.ts` is the single source of truth for "is this expression a
// repository READ", consumed by BOTH the workflow lowerer and the
// domain-service lowerer.  A miss lowers a read to a generic expression (the
// criterion is silently dropped and the query returns EVERY row — the
// data-exposure the `criterionName` field's own comment names); a false hit
// lowers a write as a read, past the purity gate.  377 lines of pattern
// matching, and no test imported it.  M-T9.17 slice 2.
//
// FIXTURES ARE PARSED, NOT HAND-BUILT.  The mission asks for an
// `EnrichedAggregateIR` builder, but this module is the one target that does
// NOT take IR — it matches over the raw Langium AST (`Expression`,
// `Repository`, `PostfixChain`).  Hand-assembling those nodes would encode my
// reading of the grammar rather than the grammar, and would keep passing after
// a grammar change that broke the real matcher.  So each case parses real
// `.ddd` and pulls the expression out of a domain-service body.

/** Parse `body` as the single statement of a `reading` domain service and hand
 *  back the expression it returns, plus the context's repositories. */
async function exprOf(
  bodyExpr: string,
  extraMembers = "",
): Promise<{
  expr: Expression;
  repos: Map<string, Repository>;
  ctx: BoundedContext;
  names: QueryNames;
}> {
  const src = `
system S {
  subdomain Sub {
    context C {
      aggregate Order with crudish { code: string  archived: bool }
      criterion Active of Order = !this.archived
      retrieval ActiveOrders() of Order { where: Active  sort: [code asc] }
      repository Orders for Order
${extraMembers}
      domainService Probe reading {
        operation peek(): int {
          let x = ${bodyExpr}
          return 1
        }
      }
    }
  }
}`;
  const { model } = await parseString(src);
  let ctx: BoundedContext | undefined;
  for (const sm of model.members ?? []) {
    if (!isSystem(sm)) continue;
    for (const m of sm.members ?? []) {
      if (!isSubdomain(m)) continue;
      for (const c of m.contexts ?? []) if (isBoundedContext(c)) ctx = c;
    }
  }
  if (!ctx) throw new Error("context not found");

  const repos = new Map<string, Repository>();
  for (const m of ctx.members) if (isRepository(m)) repos.set(m.name, m);

  const svc = ctx.members.find(isDomainService);
  if (!svc) throw new Error("domain service not found");
  // The `let x = <expr>` initialiser of the operation's first statement.
  const stmt = (svc.operations?.[0]?.stmts ?? [])[0] as { expr?: Expression } | undefined;
  const expr = stmt?.expr;
  if (!expr) throw new Error(`no let-initialiser parsed for: ${bodyExpr}`);
  return { expr, repos, ctx, names: queryNamesOf(ctx) };
}

/** The positional argument of a single-suffix `<Repo>.<verb>(arg)` call. */
function argOf(expr: Expression): Expression | undefined {
  const chain = expr as { suffixes?: { args?: { name?: string; value: Expression }[] }[] };
  return chain.suffixes?.[0]?.args?.find((a) => !a.name)?.value;
}

describe("matchRepoRead — the four read shapes", () => {
  it("rides a name no contract verb spells as an `unknown-read`, args carried", async () => {
    // A repository declares no reads of its own, so the name resolves to
    // nothing — its validator refuses it.
    const { expr, repos } = await exprOf(`Orders.byCode("A1")`);
    const m = matchRepoRead(expr, repos);
    expect(m?.op).toBe("unknown-read");
    expect(m?.method).toBe("byCode");
    expect(m?.args).toHaveLength(1);
  });

  it("recognises `get` as the by-id `load`", async () => {
    const { expr, repos } = await exprOf(`Orders.get("id")`);
    expect(matchRepoRead(expr, repos)?.op).toBe("load");
  });

  it("recognises `find(<Criterion>)` and CARRIES the criterion name", async () => {
    // The load-bearing assertion: dropping `criterionName` is not a crash, it
    // is a read that silently returns every row.
    const { expr, repos, names } = await exprOf(`Orders.find(Active)`);
    const m = matchRepoRead(expr, repos, names);
    expect(m?.op).toBe("select-one");
    expect(m?.criterionName).toBe("Active");
  });

  it("recognises `all(<Criterion>)` and carries the criterion name", async () => {
    const { expr, repos, names } = await exprOf(`Orders.all(Active)`);
    const m = matchRepoRead(expr, repos, names);
    expect(m?.op).toBe("select-many");
    expect(m?.criterionName).toBe("Active");
  });

  it("recognises `all(<Retrieval>())` and carries the retrieval name", async () => {
    const { expr, repos, names } = await exprOf(`Orders.all(ActiveOrders())`);
    const m = matchRepoRead(expr, repos, names);
    expect(m?.op).toBe("select-many");
    expect(m?.retrievalName).toBe("ActiveOrders");
    expect(m?.criterionName).toBeUndefined();
  });

  it("returns undefined for a WRITE — the purity gate depends on this", async () => {
    // `save` must NOT match: a read-classified write would pass the
    // `reading` domain-service gate.
    const { expr, repos } = await exprOf(`Orders.save(1)`);
    expect(matchRepoRead(expr, repos)).toBeUndefined();
  });

  it("returns undefined for a call on something that is not a repository", async () => {
    const { expr, repos } = await exprOf(`Nope.find(Active)`);
    expect(matchRepoRead(expr, repos)).toBeUndefined();
  });

  it("returns undefined for a non-call expression, and for undefined", async () => {
    const { expr, repos } = await exprOf(`1 + 1`);
    expect(matchRepoRead(expr, repos)).toBeUndefined();
    expect(matchRepoRead(undefined, repos)).toBeUndefined();
  });
});

describe("classifyRepoArg — a criterion vs a retrieval vs an id", () => {
  it("says a plain criterion IS a criterion", async () => {
    const { names, expr } = await exprOf(`Orders.all(Active)`);
    expect(names.criteria.has("Active")).toBe(true);
    expect(classifyRepoArg(argOf(expr), names)).toBe("criterion");
  });

  it("gives RETRIEVAL precedence for a name that is both", async () => {
    // A declared retrieval keeps its meaning, so a name that is both a
    // criterion and a retrieval reads as the retrieval.
    const { expr, names } = await exprOf(
      `Orders.all(Dual)`,
      `      criterion Dual of Order = !this.archived
      retrieval Dual() of Order { where: Active  sort: [code asc] }`,
    );
    expect(classifyRepoArg(argOf(expr), names)).toBe("retrieval");
  });

  it("says an unknown name is a plain value (an id)", async () => {
    const { expr, names } = await exprOf(`Orders.find(Ghost)`);
    expect(classifyRepoArg(argOf(expr), names)).toBe("value");
  });

  it("an UNDEFINED context declares nothing — the system-level `test e2e` case", async () => {
    const { expr } = await exprOf(`Orders.all(Active)`);
    expect(classifyRepoArg(argOf(expr), queryNamesOf(undefined))).toBe("value");
  });

  it("routes a criterion `all` to the findAllBy<Criterion> shape", async () => {
    const { expr, repos, names } = await exprOf(`Orders.all(Active)`);
    const m = matchRepoRead(expr, repos, names);
    expect(m?.op).toBe("select-many");
    // The criterion rides as `criterionName`, not `retrievalName` — that is
    // what makes the backend synthesise `findAllByActive` instead of looking
    // for a retrieval that does not exist.
    expect(m?.criterionName).toBe("Active");
    expect(m?.retrievalName).toBeUndefined();
  });

  it("WITHOUT the declared names, the same `all(Active)` is not a criterion read", async () => {
    // Proves the names are load-bearing rather than decorative: the same
    // source parsed the same way answers differently when they are omitted.
    const { expr, repos } = await exprOf(`Orders.all(Active)`);
    const m = matchRepoRead(expr, repos);
    expect(m?.criterionName).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// M-T9.17 slice 2, completed (wave C3 packet 3f): the result-type half of the
// detector, and the argument shapes the four matchers carry.
//
// `repoReadResultType` is the other half of the one fact this module owns — a
// read's recognised SHAPE decides the type a `let` binds — and its own comment
// records the bug that motivated it (a let-bound read typed as `string`, so
// `.count` emitted verbatim).  Every row of its table is pinned below, each
// against a parsed read, because each row has a different consumer that breaks
// when it moves: `findAll`/`run` → a collection (`.count` → `.length`); `find` /
// built-in `findById` → `T?` (the nullable gates and the `if let` source);
// `getById` → the bare aggregate (throws → 404); an unknown name → the bare
// aggregate (refused by its validator).
// ---------------------------------------------------------------------------

describe("repoReadResultType — the type a let-bound read produces", () => {
  const ORDER = { kind: "entity", name: "Order", declKind: "aggregate" } as const;

  async function typeOf(body: string, extra = "") {
    const { expr, repos, names } = await exprOf(body, extra);
    const m = matchRepoRead(expr, repos, names);
    expect(m, `not recognised as a read: ${body}`).toBeDefined();
    return repoReadResultType(m!);
  }

  it("findAll(<Criterion>) is an ARRAY of the aggregate", async () => {
    expect(await typeOf(`Orders.all(Active)`)).toEqual({ kind: "array", element: ORDER });
  });

  it("run(<Retrieval>()) and run(<Criterion>) are both ARRAYS", async () => {
    expect(await typeOf(`Orders.all(ActiveOrders())`)).toEqual({ kind: "array", element: ORDER });
    expect(await typeOf(`Orders.all(Active)`)).toEqual({ kind: "array", element: ORDER });
  });

  it("find(<Criterion>) is OPTIONAL — the only optional criterion producer", async () => {
    expect(await typeOf(`Orders.find(Active)`)).toEqual({ kind: "optional", inner: ORDER });
  });

  it("an unknown named read falls back to the bare aggregate", async () => {
    expect(await typeOf(`Orders.byCode("A1")`)).toEqual(ORDER);
  });

  it("the built-ins split by shape: findAll()/all() array, findById optional, getById bare", async () => {
    // Collapsing either half reintroduces the bug for the other (the function's
    // own comment): a collection typed single, or a single row typed as a list.
    expect(await typeOf(`Orders.all()`)).toEqual({ kind: "array", element: ORDER });
    expect(await typeOf(`Orders.all()`)).toEqual({ kind: "array", element: ORDER });
    expect(await typeOf(`Orders.find("id")`)).toEqual({ kind: "optional", inner: ORDER });
    expect(await typeOf(`Orders.get("id")`)).toEqual(ORDER);
  });
});

describe("the matchers' argument shapes", () => {
  const BY_CODE = `      criterion ByCode(c: string) of Order = this.code == c`;

  it("all(<Criterion>(args)) carries the criterion's ARGUMENTS and a `page:` offset/limit", async () => {
    const { expr, repos, names } = await exprOf(
      `Orders.all(ByCode("A1"), page: { offset: 10, limit: 20 })`,
      BY_CODE,
    );
    const m = matchAllCall(expr, repos, names);
    expect(m?.retrievalName).toBe("");
    expect(m?.anon?.criterionName).toBe("ByCode");
    expect(m?.anon?.criterionArgs).toHaveLength(1);
    expect(m?.pageOffset).toBeDefined();
    expect(m?.pageLimit).toBeDefined();
    // The collapsed form reads the args off the ANON half, not the (empty)
    // retrieval half — dropping them would run the criterion unparameterised.
    expect(matchRepoRead(expr, repos, names)?.args).toHaveLength(1);
  });

  it("all(<Criterion>) with no `page:` leaves both page bounds unset", async () => {
    const { expr, repos, names } = await exprOf(`Orders.all(Active)`);
    const m = matchAllCall(expr, repos, names);
    expect(m?.anon?.criterionName).toBe("Active");
    expect(m?.pageOffset).toBeUndefined();
    expect(m?.pageLimit).toBeUndefined();
  });

  it("all(<Criterion>, sort: […]) carries the criterion and its sort terms", async () => {
    const { expr, repos, names } = await exprOf(`Orders.all(Active, sort: [code asc])`);
    const m = matchAllCall(expr, repos, names);
    expect(m?.anon?.criterionName).toBe("Active");
    expect(m?.anon?.sort).toHaveLength(1);
    expect(matchRepoRead(expr, repos, names)?.criterionName).toBe("Active");
  });

  it("a bare parameterless retrieval `all(Name)` keeps a sibling `page:`", async () => {
    const { expr, repos, names } = await exprOf(`Orders.all(ActiveOrders, page: { limit: 20 })`);
    const m = matchAllCall(expr, repos, names);
    expect(m?.retrievalName).toBe("ActiveOrders");
    expect(m?.pageLimit).toBeDefined();
  });

  it("find() with NO criterion argument declines (no silent unfiltered read)", async () => {
    const { expr, repos } = await exprOf(`Orders.find()`);
    expect(matchFindCall(expr, repos)).toBeUndefined();
  });

  it("a chained call (two suffixes) is not a repository call", async () => {
    const { expr, repos } = await exprOf(`Orders.all(Active).count`);
    expect(matchRepoCall(expr, repos)).toBeUndefined();
    expect(matchAllCall(expr, repos)).toBeUndefined();
    expect(matchRepoRead(expr, repos)).toBeUndefined();
  });

  it("matchRepoCall peels positional args to their value expressions", async () => {
    const { expr, repos } = await exprOf(`Orders.byCode("A1")`);
    const m = matchRepoCall(expr, repos);
    expect(m?.repo.name).toBe("Orders");
    expect(m?.method).toBe("byCode");
    expect(m?.args.map((a) => a.$type)).toEqual(["StringLit"]);
  });
});
