// M-T5.25 — `ignoring` written where nothing reads it back.
//
// `PostfixExpr` admits a trailing `IgnoringClause` so an inline
// `let xs = Repo.findAll(…) ignoring softDeletable` parses.  A postfix chain is
// admissible ANYWHERE an expression is, so the same clause also parses on a
// `group by` operand, a `select` body, a `join`'s `on`, a `where`
// sub-expression and a page-body read — and every one of those positions drops
// it during lowering.  Before this gate:
//
//   group by o.status ignoring softDeletable   → .where(and(eq(status,…), not(eq(isDeleted,true))))
//   ignoring softDeletable / group by o.status → .where(eq(status,…))
//
// Same model, same intent, opposite data — decided by where in the clause list
// the word sits, with no diagnostic either way.  These pin BOTH directions: the
// three legal homes stay clean, every dropping position errors.

import { describe, expect, it } from "vitest";
import { parseString } from "../../_helpers/parse.js";

const CODE = "loom.ignoring-clause-placement";

const codesOf = (diags: { code?: unknown }[]): string[] =>
  diags.map((d) => String(d.code ?? "")).filter(Boolean);

/** A soft-deletable `Order` + a projection whose query clauses the caller
 *  supplies — the exact shape the finding was reproduced from
 *  (`test/fixtures/corpus/projection-groupby.ddd` + `softDeletable`). */
const withProjection = (clauses: string) => `
  system S {
    subdomain Sales {
      context Orders {
        enum OrderStatus { Draft Confirmed Cancelled }
        aggregate Customer with crudish { name: string  derived display: string = name }
        aggregate Order with crudish, softDeletable {
          code: string
          total: money
          status: OrderStatus
          customerId: Customer id
          derived display: string = code
        }
        repository Orders for Order { }
        repository Customers for Customer { }
        projection SalesByStatus {
          status: OrderStatus
          orders: int
          ${clauses}
        }
      }
    }
  }`;

/** The three legal homes in one model — a repository `find … ignoring`, and two
 *  inline `let`-bound reads.  Shape lifted from
 *  `test/generator/dotnet/filter-bypass.test.ts`, the suite that pins the
 *  emission of exactly these spellings. */
const LEGAL_READS = `
  system S {
    capability softDeletable { isDeleted: bool  filter this.isDeleted == false }
    subdomain D { context C {
      criterion BigOrders() of Order = this.total > 0
      aggregate Order with softDeletable { total: int }
      repository OrderRepo for Order {
        find all(): Order[] ignoring *
      }
      criterion OrdersRecent of Order = this.total > 0
      workflow Sweep {
        create(x: int) {
          let xs = OrderRepo.findAll(BigOrders()) ignoring softDeletable
          let ys = OrderRepo.findAll(BigOrders()) ignoring *
          for o1 in xs { }
          for o2 in ys { }
        }
      }
    }}
    storage pg { type: postgres }
    resource cState { for: C, kind: state, use: pg }
    deployable api { platform: dotnet  contexts: [C]  dataSources: [cState]  port: 3000 }
  }`;

describe("loom.ignoring-clause-placement — the bypass clause only where it is read back", () => {
  it("errors on `group by <expr> ignoring <Cap>` — the clause binds the GROUPING expression and is dropped", async () => {
    const { diagnostics } = await parseString(
      withProjection(`
          from Order as o
          group by o.status ignoring softDeletable
          select status = o.status, orders = count()`),
    );
    expect(codesOf(diagnostics)).toContain(CODE);
  });

  it("errors on a `select` body's trailing `ignoring`", async () => {
    // On the LAST select entry: an `ignoring` written mid-list would eat the
    // following entry as another capability name (`ignoring softDeletable,
    // orders` — the clause takes a comma-separated list), which is a syntax
    // error, not this gate.
    const { diagnostics } = await parseString(
      withProjection(`
          from Order as o
          group by o.status
          select status = o.status, orders = count() ignoring softDeletable`),
    );
    expect(codesOf(diagnostics)).toContain(CODE);
  });

  it("errors on a `where`-position SUB-expression's `ignoring` (not the clause slot)", async () => {
    const { diagnostics } = await parseString(
      withProjection(`
          from Order as o
          where o.status == OrderStatus.Confirmed ignoring softDeletable
          group by o.status
          select status = o.status, orders = count()`),
    );
    expect(codesOf(diagnostics)).toContain(CODE);
  });

  it("accepts the projection's own `where`-position clause slot — the legal spelling", async () => {
    const { diagnostics } = await parseString(
      withProjection(`
          from Order as o
          ignoring softDeletable
          group by o.status
          select status = o.status, orders = count()`),
    );
    // Error-free, so the verdict below is on a model that actually parsed.
    expect(diagnostics.filter((d) => d.severity === 1).map((d) => d.message)).toEqual([]);
    expect(codesOf(diagnostics)).not.toContain(CODE);
  });

  it("accepts a repository `find … ignoring …` and an inline `let … = Repo.findAll(…) ignoring …`", async () => {
    const { diagnostics } = await parseString(LEGAL_READS);
    // No ERRORS at all — so the "not.toContain" below is a real verdict on a
    // model that actually parsed, not on one the parser gave up on.
    expect(diagnostics.filter((d) => d.severity === 1).map((d) => d.message)).toEqual([]);
    expect(codesOf(diagnostics)).not.toContain(CODE);
  });

  it("errors when a `let` binds something OTHER than a repository read", async () => {
    // `resolveBypass` is spread only by lower-workflow's two `repo-run` arms,
    // so an `ignoring` on any other let-bound chain is dropped just as silently
    // as one on a `group by` operand.
    const { diagnostics } = await parseString(
      LEGAL_READS.replace(
        "let ys = OrderRepo.findAll(BigOrders()) ignoring *",
        "let n = o1.total.abs() ignoring softDeletable",
      ),
    );
    expect(codesOf(diagnostics)).toContain(CODE);
  });

  describe("single-row reads — `find(<Criterion>)` / `findById`", () => {
    const singleRow = (wfBody: string, svcBody = "return true") => `
      system S {
        capability softDeletable { isDeleted: bool  filter this.isDeleted == false }
        subdomain D { context C {
          criterion Big(min: int) of Order = this.total > min
          aggregate Order with softDeletable {
            total: int
            operation bump() { total := total + 1 }
          }
          repository Orders for Order { }
          domainService Q {
            operation probe(id: Order id, min: int): bool { ${svcBody} }
          }
          workflow w { create(id: Order id, min: int) { ${wfBody} } }
        }}
        storage pg { type: postgres }
        resource cState { for: C, kind: state, use: pg }
        deployable api { platform: node  contexts: [C]  dataSources: [cState]  port: 3000 }
      }`;
    const errorsOf = async (src: string) =>
      (await parseString(src)).diagnostics.filter((d) => d.severity === 1).map((d) => d.message);

    it("accepts `if let o = Repo.find(C) ignoring …` — the if-let source reads it", async () => {
      expect(
        await errorsOf(
          singleRow("if let o = Orders.find(Big(min)) ignoring softDeletable { o.bump() }"),
        ),
      ).toEqual([]);
      expect(
        await errorsOf(singleRow("if let o = Orders.find(Big(min)) ignoring * { o.bump() }")),
      ).toEqual([]);
    });

    it("accepts `find(C)` / `findById` with `ignoring` in a domain-service expression", async () => {
      expect(
        await errorsOf(
          singleRow(
            "",
            "return Orders.findById(id) ignoring * != null && Orders.find(Big(min)) ignoring softDeletable == null",
          ),
        ),
      ).toEqual([]);
    });

    it("errors on `findById … ignoring` as an `if let` source — findById is not one", async () => {
      const { diagnostics } = await parseString(
        singleRow("if let o = Orders.findById(id) ignoring * { o.bump() }"),
      );
      expect(codesOf(diagnostics)).toContain(CODE);
    });

    it("errors on `findAll(C) … ignoring` in a domain-service expression — the service read drops it", async () => {
      const { diagnostics } = await parseString(
        singleRow("", "return (Orders.findAll(Big(min)) ignoring softDeletable).count > 0"),
      );
      expect(codesOf(diagnostics)).toContain(CODE);
    });
  });
});
