// An ENUM-typed read PARAMETER must bind as its declared NAME, not its ordinal.
//
// Every backend stores an enum column as `text` — `sql-pg.ts` emits `TEXT`, and
// this very file's `columnFor` declares `sql: "text"` with `save:
// ${acc}.ToString()`.  Dapper's default handler, though, maps a C# enum
// PARAMETER to its integer ordinal, so a read whose predicate keys on an enum
// reached Postgres as `WHERE status = 1` against a text column:
//
//     operator does not exist: text = integer
//
// …i.e. a 500 at the route.  The SAVE path in `emit/dapper.ts` already spelled
// `.ToString()`; only the read binder had been written without it, so an
// enum-keyed read was broken on Dapper for as long as the adapter has shipped.
//
// Invisible because no test had ever CALLED one.  The caller census (#2380)
// named `byStatus` (core-domain) and `byNetwork` (payments) as zero-caller
// routes; the drains that gave them callers made them the first enum-keyed
// finds ever driven at runtime, and both were ✗ on the dapper behavioural leg —
// its only two case failures, one bug.
//
// This is Dapper-SPECIFIC, unlike the find-absence 404 fixed alongside it: the
// EF path binds through LINQ against a `HasConversion`-mapped property, so it
// never had the ordinal problem.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

/** One enum-keyed criterion read and — as the scope guard — one STRING-keyed
 *  read that must keep binding the bare parameter. */
const SOURCE = `
system Shop {
  api OrdersApi from Sales
  subdomain Sales {
    context Orders {
      enum Status { Draft, Placed, Cancelled }
      aggregate Order with crudish {
        code: string
        status: Status
      }
      repository Orders for Order
      criterion OrdersByStatus(s: Status) of Order = this.status == s
      criterion OrdersByCode(c: string) of Order = this.code == c
      queryHandler orderByStatus(s: Status): Order? {
        let o = Orders.find(OrdersByStatus(s))
        return o
      }
      queryHandler orderByCode(c: string): Order? {
        let o = Orders.find(OrdersByCode(c))
        return o
      }
    }
  }
  storage pg { type: postgres }
  resource ordersState { for: Orders, kind: state, use: pg }
  deployable api {
    platform: dotnet { persistence: dapper }
    contexts: [Orders]
    dataSources: [ordersState]
    serves: OrdersApi
    port: 8080
  }
}`;

const repoFor = async (): Promise<string> =>
  (await generateSystemFiles(SOURCE)).get("api/Infrastructure/Repositories/OrderRepository.cs")!;

describe("Dapper binds an enum read parameter by name", () => {
  it("binds `.ToString()` for the enum param and the BARE name for the string param", async () => {
    const repo = await repoFor();
    expect(repo).toBeDefined();

    // Premise: both reads are emitted, and the enum one really does key on the
    // enum column — so a failure below is about the BINDING, not a missing read.
    expect(repo).toContain(
      "public async Task<IReadOnlyList<Order>> RunFindAllByOrdersByStatusAsync(Status s,",
    );
    expect(repo).toContain(
      "public async Task<IReadOnlyList<Order>> RunFindAllByOrdersByCodeAsync(string c,",
    );
    expect(repo).toContain("WHERE (status = @s)");

    // The fix: the enum parameter is bound as its declared name.
    expect(repo).toContain('p.Add("s", s.ToString());');
    // Never the raw enum — that is the ordinal Postgres refuses to compare
    // against a text column.
    expect(repo).not.toContain('p.Add("s", s);');

    // Scope guard: a STRING param must NOT grow a `.ToString()` — it would be a
    // gratuitous output change, and it is what a fix that stringified every
    // parameter would produce.
    expect(repo).toContain('p.Add("c", c);');
    expect(repo).not.toContain("c.ToString()");
  });

  it("agrees with the SAVE path, which already bound the enum by name", async () => {
    // The two halves of one convention: this is the line that made the find's
    // ordinal binding a contradiction inside a single file rather than merely a
    // debatable choice.
    const repo = await repoFor();
    expect(repo).toContain("status = aggregate.Status.ToString()");
  });
});
