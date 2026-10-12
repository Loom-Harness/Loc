// A `find … paged` param that shares a name with one of the paged method's own
// bookkeeping locals (`offset`, `total`, `totalPages`, `items`, the sort
// whitelist, the in-memory `matched` list, …).
//
// Every node repository builder declared those locals in the same function
// scope as the find's params, so `find byTotal(total: int): X paged` emitted
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
      repository Orders for Order {
        find plain(region: string): Order paged where this.region == region
        find byOffset(offset: int): Order paged where this.offset == offset
        find byTotal(total: int, totalPages: int): Order paged where this.total == total && this.totalPages == totalPages
        find byItems(items: int, countRows: int, rootRows: int, sortColumns: string, sortColumn: string, orderBy: string): Order paged where this.items == items && this.region == sortColumn
        find bySort(sortable: string, sortField: string, orderBy: string, total: int, items: int): Order paged where this.code == sortable && this.region == sortField && this.total == total
      }
      aggregate Doc shape: document, with crudish { total: int  offset: int }
      repository Docs for Doc {
        find byTotal(total: int, offset: int, totalPages: int, items: int, matched: int): Doc paged where this.total == total && this.offset == offset
      }
      aggregate Emb shape: embedded, with crudish {
        total: int  offset: int
        contains lines: Line[]
        entity Line { sku: string }
      }
      repository Embs for Emb {
        find byTotal(total: int, offset: int, totalPages: int, items: int, countRows: int): Emb paged where this.total == total && this.offset == offset
      }
      aggregate Account persistedAs: eventLog {
        owner: string
        balance: int
        create() { emit AccountOpened { accountRef: id, owner: "x" } }
        apply(e: AccountOpened) { owner := e.owner  balance := 0 }
      }
      event AccountOpened { accountRef: Account id, owner: string }
      repository Accounts for Account {
        find byOwner(owner: string, total: int, offset: int, totalPages: int, items: int, matched: int): Account paged where this.owner == owner && this.balance == total
      }
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
  describe(`node paged find locals step aside for same-named params — ${label}`, () => {
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
      expect(order).toContain("async byTotal(total: number, totalPages: number,");
      expect(order).toContain("total: __total, totalPages: __totalPages }");
      // A find with no collision is untouched (byte-identity for every model
      // that never names a param after a local).
      const plain = order.slice(order.indexOf("async plain("), order.indexOf("async byOffset("));
      expect(plain).toContain("return { items, page, pageSize, total, totalPages };");
      expect(plain).not.toContain("__");
    });
  });
}
