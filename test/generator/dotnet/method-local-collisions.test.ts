// .NET — a `.ddd` criterion / retrieval / paged param spelled like one of the
// generated method's OWN locals (`p`, `sql`, `conn`, `pg`, `rows`, `r`,
// `result`, `items`, `total`, the lambda `x`, …) must not re-declare it.
//
// C# rejects a local that shadows a parameter (CS0136), and the cascade is
// worse than the error: the predicate then reads the local instead of the param
// (CS0841 / CS0019), and a lambda `x => x.Label == x` compares the row to
// itself.  Confirmed by `dotnet build /warnaserror` on both adapters (63 / 55
// errors before the fix, 0 after).
//
// The rule pinned here: the method's local MOVES (`__`-prefixed), the param
// NEVER does — it is the public C# surface and, on Dapper, the `@<name>` SQL
// placeholder / DynamicParameters key.  And it moves ONLY on a collision, so
// the control aggregate's methods stay byte-identical to the pre-fix spelling.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SOURCE = (persistence: string) => `
system LocalsSys {
  subdomain Sales {
    context Orders with scaffoldGet(of: Uni) {
      aggregate Ticket with crudish { label: string  qty: int }
      repository Tickets for Ticket
      criterion ByRows(rows: string, r: string, x: string, result: string) of Ticket = label == rows && label == r && label == x && label == result
      criterion Uni(result: string, problem: string) of Ticket = label == result && label == problem
      criterion PagedT(offset: int, total: int, items: string, sortColumn: string, totalPages: int) of Ticket = qty == offset && qty == total && label == items && label == sortColumn && qty == totalPages
      queryHandler ListPagedT(offset: int, total: int, items: string, sortColumn: string, totalPages: int): Ticket paged {
        let r = Tickets.run(PagedT(offset, total, items, sortColumn, totalPages))
        return r
      }
      retrieval RetP(p: string, sql: string, conn: string, pg: string, x: string) of Ticket { where: label == p && label == x }
      aggregate Calm with crudish { label: string }
      repository Calms for Calm
      criterion CalmByLabel(v: string) of Calm = label == v
      retrieval RetCalm(v: string) of Calm { where: label == v }
      // The single-row reads: each widened read derives its own repository
      // method (\`FindFirst<C>IgnoringAll\`) whose params are the criterion's.
      workflow Probe {
        create(a: string) {
          if let t = Tickets.find(ByRows(a, a, a, a)) ignoring * { }
          if let c = Calms.find(CalmByLabel(a)) ignoring * { }
        }
      }
    }
  }
  api SalesApi with scaffoldGetApi(of: Uni) from Sales
  storage pg { type: postgres }
  resource st { for: Orders, kind: state, use: pg }
  deployable d {
    platform: dotnet { persistence: ${persistence} }
    contexts: [Orders]
    dataSources: [st]
    serves: SalesApi
    port: 4000
  }
}`;

const REPO = "d/Infrastructure/Repositories/TicketRepository.cs";
const CALM_REPO = "d/Infrastructure/Repositories/CalmRepository.cs";

describe("dotnet method locals yield to a same-named .ddd param", () => {
  it("dapper: retrieval / single-row / paged locals move, params and SQL keys do not", async () => {
    const files = await generateSystemFiles(SOURCE("dapper"));
    const src = files.get(REPO)!;

    // Retrieval: the `p` bag, `sql`, `conn`, `pg` locals move; the
    // DynamicParameters KEYS stay the declared names (= the `@p` placeholder).
    expect(src).toContain("RunRetPAsync(string p, string sql, string conn, string pg, string x,");
    // #3224: the connection comes off the unit-of-work lease, so only its
    // NAME moves (`var __conn = __lease.Connection;`).
    expect(src).toContain("var __conn = __lease.Connection;");
    expect(src).toContain("var __p = new DynamicParameters();");
    expect(src).toContain('__p.Add("p", p);');
    expect(src).toContain('__p.Add("sql", sql);');
    expect(src).toContain("if (page is { } __pg)");
    expect(src).toContain(
      "new CommandDefinition(__sql, __p, cancellationToken: cancellationToken)",
    );
    expect(src).toMatch(/var __sql = "SELECT [^"]*WHERE \(\(label = @p\) AND \(label = @x\)\)/);
    const run = src.slice(
      src.indexOf("RunRetPAsync("),
      src.indexOf("\n    }\n", src.indexOf("RunRetPAsync(")),
    );
    expect(run).not.toMatch(/var (p|sql|conn|pg) =/);

    // Single-row read: `rows`/`r` are params here, so the row local becomes `__r`.
    expect(src).toContain(
      "FindFirstByRowsIgnoringAll(string rows, string r, string x, string result,",
    );
    expect(src).toContain("var __r = await conn.QueryFirstOrDefaultAsync<Row>(");
    expect(src).toContain("new { rows, r, x, result }");
    expect(src).toContain("return __r is null ? null : Map(__r);");

    // Paged read: every colliding local moves; `page`/`pageSize` untouched.
    expect(src).toContain("var __offset = (page - 1) * pageSize;");
    expect(src).toContain("var __total = await conn.ExecuteScalarAsync<int>(");
    expect(src).toContain(
      "var __totalPages = pageSize > 0 ? (int)System.Math.Ceiling((double)__total / pageSize) : 0;",
    );
    expect(src).toContain("ORDER BY {__sortColumn} {sortDir}");
    expect(src).toContain(
      "return new Paged<Ticket>(__items, page, pageSize, __total, __totalPages);",
    );

    // Control: a non-colliding aggregate keeps the plain spellings.
    const calm = files.get(CALM_REPO)!;
    expect(calm).toContain("var p = new DynamicParameters();");
    expect(calm).toContain('p.Add("v", v);');
    expect(calm).toContain("if (page is { } pg)");
    expect(calm).toContain("var r = await conn.QueryFirstOrDefaultAsync<Row>(");
    expect(calm).not.toMatch(/\b__(p|pg|r|conn)\b/);
  });

  it("efcore: single-row / retrieval / spec locals move on a collision only", async () => {
    const files = await generateSystemFiles(SOURCE("efcore"));
    const src = files.get(REPO)!;

    // Single-row read: `result` is a param, so the method's result local moves.
    expect(src).toContain(
      "var __result = await _db.Tickets.IgnoreQueryFilters().Where(new ByRowsCriterion(rows, r, x, result).ToExpression())",
    );
    expect(src).toContain("return __result;");
    // The predicate lambda lives in the criterion, whose parameter is never a
    // `.ddd` name — so a criterion param `x` cannot be read as the row.
    const crit = files.get("d/Domain/Criteria/ByRowsCriterion.cs")!;
    expect(crit).toContain(
      "ToExpression() => candidate => candidate.Label == rows && candidate.Label == r && candidate.Label == x && candidate.Label == result;",
    );

    // Paged read.
    expect(src).toContain("var __offset = (page - 1) * pageSize;");
    expect(src).toContain("EF.Property<object>(e, __sortColumn)");
    expect(src).toContain(
      "var __items = await ordered.Skip(__offset).Take(pageSize).ToListAsync(cancellationToken);",
    );
    expect(src).toContain(
      "return new Paged<Ticket>(__items, page, pageSize, __total, __totalPages);",
    );

    // Retrieval spec: the lambda param yields to the retrieval's `x`.
    const spec = files.get("d/Domain/Tickets/RetPSpec.cs")!;
    expect(spec).toContain(
      "public RetPSpec(string p, string sql, string conn, string pg, string x)",
    );
    expect(spec).toContain("Query.Where(__x => __x.Label == p && __x.Label == x);");

    // Control.
    const calm = files.get(CALM_REPO)!;
    expect(calm).toContain(
      "var result = await _db.Calms.IgnoreQueryFilters().Where(new CalmByLabelCriterion(v).ToExpression())",
    );
    expect(calm).toContain("var __q = _db.Calms.AsQueryable();");
    expect(files.get("d/Domain/Calms/RetCalmSpec.cs")!).toContain(
      "Query.Where(x => x.Label == v);",
    );
  });

  // KNOWN BUG (reported with the find-declaration removal): the routed
  // queryHandler controller (`scaffoldGetApi` / `route GET …`) declares
  // `var result = await _mediator.Send(...)` beside a query param named
  // `result` — CS0136.  `it.fails` keeps the contract pinned: once the action's
  // local yields, this passes, `.fails` turns it red, and the marker goes.
  it.fails("efcore: a routed read's controller local yields to a same-named query param", async () => {
    const files = await generateSystemFiles(SOURCE("efcore"));
    const ctl = files.get("d/Api/SalesApiRoutesController.cs")!;
    expect(ctl).toContain("GetTicketByUni([FromQuery] string result, [FromQuery] string problem)");
    expect(ctl).toMatch(
      /var __result = await _mediator\.Send\(new GetTicketByUniQuery\(result, problem\)\);/,
    );
  });
});
