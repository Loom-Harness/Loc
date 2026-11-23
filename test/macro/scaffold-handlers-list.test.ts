// `scaffoldHandlers` writes a `List<Aggs>` paged query handler for every
// served single-table relational aggregate — the list read a hand-written
// handler spells `let r = <Repo>.all()  return r` — and none for an aggregate
// whose list read is not paged in SQL.  `scaffoldApi` does not route it: the
// derived `GET /<aggs>` still serves the list.

import { AstUtils } from "langium";
import { describe, expect, it } from "vitest";
import { isApi, isQueryHandler } from "../../src/language/generated/ast.js";
import { printStructural } from "../../src/language/print/index.js";
import { parseString } from "../_helpers/parse.js";

const SRC = `
  system Shop {
    subdomain Sales {
      context Ordering with scaffoldHandlers {
        aggregate Order { status: string  operation cancel() { status := "cancelled" } }
        repository Orders for Order { }
        event Posted { ledger: Ledger id  amount: int }
        aggregate Ledger persistedAs: eventLog {
          total: int
          create(amount: int) { emit Posted { ledger: id, amount: amount } }
          apply(e: Posted) { total := e.amount }
        }
        repository Ledgers for Ledger { }
      }
    }
    api SalesApi with scaffoldApi(of: Sales)
    storage pg { type: postgres }
    resource st { for: Ordering, kind: state, use: pg }
    deployable api { platform: node, contexts: [Ordering], dataSources: [st], serves: SalesApi, port: 5001 }
  }
`;

describe("scaffoldHandlers — the List<Aggs> paged handler", () => {
  it("is written for a relational aggregate and not for an event-log one", async () => {
    const { model } = await parseString(SRC, { validate: false });
    const lists = [...AstUtils.streamAllContents(model)]
      .filter(isQueryHandler)
      .filter((q) => q.name.startsWith("List"));
    expect(lists.map((q) => q.name)).toEqual(["ListOrders"]);
    expect(printStructural(lists[0]!)).toContain("let r = Orders.all()");
  });

  it("is not routed by scaffoldApi", async () => {
    const { model } = await parseString(SRC, { validate: false });
    const api = [...AstUtils.streamAllContents(model)].find(isApi)!;
    expect(api.routes.map((r) => r.target?.handler)).not.toContain("ListOrders");
  });
});
