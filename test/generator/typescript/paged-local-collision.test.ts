// A paged read's param (a criterion a paged queryHandler runs, read through the
// synthesised `findAllBy<Criterion>` method) that shares a name with one of the paged method's own
// bookkeeping locals (`offset`, `total`, `totalPages`, `items`, the sort
// whitelist, the in-memory `matched` list, …).
//
// Every node repository builder declared those locals in the same function
// scope as the find's params, so `find byTotal(total: int): X?` emitted
//
//     async byTotal(total: number, page: number, …) {
//       …
//       const total = Number(countRows[0]?.value ?? 0);
//
// — TS2300 "Duplicate identifier 'total'" in the generated project, on every
// saving shape (relational / embedded / document / event-log) and on both
// persistence adapters (drizzle / mikroorm), with `ddd parse` clean.  The fix
// renames the METHOD's local on collision (`__total`), so the param — the
// route's query field and what the `where` reads — keeps its name, and a find
// with no collision emits byte-identical output.
//
// The oracle is the binder (`unboundSymbols` reads TS2300/2451 off a real
// `ts.createProgram` over the emitted files), not a text match: a text match
// would have to know every local of every builder in advance.

import { beforeAll, describe, expect, it } from "vitest";
import {
  pagedEnvelopeLiteral,
  pagedLocalNames,
} from "../../../src/generator/typescript/paged-locals.js";
import {
  assertNodeTypesAvailable,
  formatUnbound,
  honoProjectDirs,
  unboundSymbols,
} from "../../_helpers/emitted-binding.js";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SOURCE = (persistence: string) => `
system PagedLocals {
  subdomain S {
    context C {
      aggregate Order with crudish {
        code: string  region: string  offset: int  total: int  totalPages: int  items: int
      }
      repository Orders for Order { }
      criterion OrderPlain(region: string) of Order = this.region == region
      queryHandler PageOrderPlain(region: string): Order paged { let r = Orders.run(OrderPlain(region))  return r }
      criterion OrderByOffset(offset: int) of Order = this.offset == offset
      queryHandler PageOrderByOffset(offset: int): Order paged { let r = Orders.run(OrderByOffset(offset))  return r }
      criterion OrderByTotal(total: int, totalPages: int) of Order = this.total == total && this.totalPages == totalPages
      queryHandler PageOrderByTotal(total: int, totalPages: int): Order paged { let r = Orders.run(OrderByTotal(total, totalPages))  return r }
      criterion OrderByItems(items: int, countRows: int, sortColumns: string, sortColumn: string, orderBy: string) of Order = this.items == items && this.region == sortColumn
      queryHandler PageOrderByItems(items: int, countRows: int, sortColumns: string, sortColumn: string, orderBy: string): Order paged { let r = Orders.run(OrderByItems(items, countRows, sortColumns, sortColumn, orderBy))  return r }
      criterion OrderBySort(sortable: string, sortField: string, orderBy: string, total: int, items: int) of Order = this.code == sortable && this.region == sortField && this.total == total
      queryHandler PageOrderBySort(sortable: string, sortField: string, orderBy: string, total: int, items: int): Order paged { let r = Orders.run(OrderBySort(sortable, sortField, orderBy, total, items))  return r }
      aggregate Doc shape: document, with crudish { total: int  offset: int }
      repository Docs for Doc { }
      criterion DocByTotal(total: int, offset: int, totalPages: int, items: int, matched: int) of Doc = this.total == total && this.offset == offset
      queryHandler PageDocByTotal(total: int, offset: int, totalPages: int, items: int, matched: int): Doc paged { let r = Docs.run(DocByTotal(total, offset, totalPages, items, matched))  return r }
      aggregate Emb shape: embedded, with crudish {
        total: int  offset: int
        contains lines: Line[]
        entity Line { sku: string }
      }
      repository Embs for Emb { }
      criterion EmbByTotal(total: int, offset: int, totalPages: int, items: int, countRows: int) of Emb = this.total == total && this.offset == offset
      queryHandler PageEmbByTotal(total: int, offset: int, totalPages: int, items: int, countRows: int): Emb paged { let r = Embs.run(EmbByTotal(total, offset, totalPages, items, countRows))  return r }
      aggregate Account persistedAs: eventLog {
        owner: string
        balance: int
        create() { emit AccountOpened { accountRef: id, owner: "x" } }
        apply(e: AccountOpened) { owner := e.owner  balance := 0 }
      }
      event AccountOpened { accountRef: Account id, owner: string }
      repository Accounts for Account { }
      criterion AccountByOwner(owner: string, total: int, offset: int, totalPages: int, items: int, matched: int) of Account = this.owner == owner && this.balance == total
      queryHandler PageAccountByOwner(owner: string, total: int, offset: int, totalPages: int, items: int, matched: int): Account paged { let r = Accounts.run(AccountByOwner(owner, total, offset, totalPages, items, matched))  return r }
    }
  }
  api A from S
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  resource lg { for: C, kind: eventLog, use: pg }
  deployable d {
    platform: node${persistence}
    contexts: [C]
    dataSources: [st, lg]
    serves: A
    port: 4000
  }
}`;

describe("pagedLocalNames", () => {
  it("is the identity when no param collides", () => {
    expect(pagedLocalNames(["total", "items"] as const, ["region"])).toEqual({
      total: "total",
      items: "items",
    });
  });
  it("renames only the colliding local, past every taken name", () => {
    expect(pagedLocalNames(["total", "items"] as const, ["total", "__total"])).toEqual({
      total: "___total",
      items: "items",
    });
  });
  it("keeps the envelope shorthand unless a value moved", () => {
    expect(pagedEnvelopeLiteral({ items: "items", total: "total", totalPages: "totalPages" })).toBe(
      "{ items, page, pageSize, total, totalPages }",
    );
    expect(pagedEnvelopeLiteral({ items: "[]", total: "__total", totalPages: "totalPages" })).toBe(
      "{ items: [], page, pageSize, total: __total, totalPages }",
    );
  });
});

for (const [label, persistence] of [
  ["drizzle (default)", ""],
  ["mikroorm", " { persistence: mikroorm }"],
] as const) {
  describe(`node paged read locals step aside for same-named params — ${label}`, () => {
    let files: Map<string, string>;
    beforeAll(async () => {
      files = await generateSystemFiles(SOURCE(persistence));
    });

    it("emits no duplicate identifier in any repository", () => {
      assertNodeTypesAvailable();
      const dirs = honoProjectDirs(files);
      expect(dirs).toEqual(["d"]);
      const dup = unboundSymbols(files, "d").filter((f) => f.file.startsWith("db/repositories/"));
      expect(dup, formatUnbound(dup)).toEqual([]);
    });

    it("keeps the param name and renames the local, envelope keys unchanged", () => {
      const order = files.get("d/db/repositories/order-repository.ts")!;
      expect(order).toContain("async findAllByOrderByTotal(total: number, totalPages: number,");
      expect(order).toContain("total: __total, totalPages: __totalPages }");
      // A find with no collision is untouched (byte-identity for every model
      // that never names a param after a local).
      const plain = order.slice(
        order.indexOf("async findAllByOrderPlain("),
        order.indexOf("async findAllByOrderByOffset("),
      );
      expect(plain).toContain("return { items, page, pageSize, total, totalPages };");
      expect(plain).not.toContain("__");
    });
  });
}
