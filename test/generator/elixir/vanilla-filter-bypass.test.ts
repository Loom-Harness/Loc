import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// `ignoring <Cap>` / `ignoring *` filter-bypass on the vanilla (plain Ecto)
// foundation (named-filter-bypass.md §11, Slice 2).
//
// A capability `filter` is a `Repo.prepare_query/3` clause on the schema.  An
// `ignoring` read passes `skip_filters:` naming the capabilities it drops —
// for that read only (`ignoring *` → `:all`).  CRUD reads + a non-bypassing
// criterion find skip nothing; a bare filter lives in `base_query/0` and is
// never skippable.  A single-row `find(C) ignoring …` is its own repository
// function (`find_first_<criterion>_ignoring_<cap>`).  Inline
// `Repo.findAll(...) ignoring …` rides as the same `skip_filters:` opt into
// the retrieval.
// ---------------------------------------------------------------------------

const SOURCE = `
system Catalog {
  capability softDeletable { isDeleted: bool  filter this.isDeleted == false }
  subdomain Core {
    context Shop with scaffoldPaged(of: Normal) {
      criterion BigOrders() of Order = this.total > 0
      aggregate Order with softDeletable {
        customerId: string
        total: int
      }
      repository Orders for Order
      criterion Recent of Order = this.total > 0
      criterion AllRows of Order = this.total >= 0
      criterion Normal of Order = this.total > 0
      queryHandler GetRecent(): Order {
        if let x = Orders.find(Recent()) ignoring softDeletable {
          return x
        } else {
          notFound "not_found"
        }
      }
      queryHandler GetAnyRow(): Order {
        if let x = Orders.find(AllRows()) ignoring * {
          return x
        } else {
          notFound "not_found"
        }
      }
      workflow Sweep {
        create(min: int) {
          let xs = Orders.findAll(BigOrders()) ignoring softDeletable
          let ys = Orders.findAll(BigOrders()) ignoring *
          for o in xs { }
          for o in ys { }
        }
      }
    }
  }
  api CatalogApi with scaffoldPagedApi(of: Normal) from Core
  storage pg { type: postgres }
  resource orderState { for: Shop, kind: state, use: pg }
  deployable api {
    platform: elixir
    contexts: [Shop]
    dataSources: [orderState]
    serves: CatalogApi
    port: 4000
  }
}
`;

let cache: Map<string, string> | undefined;
async function gen(): Promise<Map<string, string>> {
  cache ??= await generateSystemFiles(SOURCE);
  return cache;
}

function file(files: Map<string, string>, suffix: string): string {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return files.get(key!)!;
}

function defBody(src: string, name: string): string {
  // `def list(…)` and `def find_first_recent_ignoring_soft_deletable()` /
  // `def find_by_id(id)` all occur.
  const re = new RegExp(`def ${name}(\\(| )`);
  const m = re.exec(src);
  expect(m, `def ${name} not found`).not.toBeNull();
  const start = m!.index;
  const next = src.indexOf("\n  def ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("vanilla ignoring filter-bypass — skip_filters on the read", () => {
  it("the schema hosts the capability filter as a prepare_query clause", async () => {
    const schema = file(await gen(), "/shop/order.ex");
    expect(schema).toContain("def __loom_filters__, do: [{:soft_deletable, false}]");
    expect(schema).toContain("do: Ecto.Query.where(query, [record], record.is_deleted == false)");
  });

  it("`ignoring <Cap>` skips exactly that capability on that find", async () => {
    const repo = file(await gen(), "/shop/order_repository.ex");
    const recent = defBody(repo, "find_first_recent_ignoring_soft_deletable");
    expect(recent).toContain(
      "from(record in Api.Shop.Order.base_query(), where: record.total > 0)",
    );
    expect(recent).toContain("skip_filters: [:soft_deletable])");
    expect(recent).not.toContain("is_deleted");
  });

  it("`ignoring *` skips every capability", async () => {
    const repo = file(await gen(), "/shop/order_repository.ex");
    const allRows = defBody(repo, "find_first_all_rows_ignoring_all");
    expect(allRows).toContain(
      "from(record in Api.Shop.Order.base_query(), where: record.total >= 0)",
    );
    expect(allRows).toContain("skip_filters: :all)");
    expect(allRows).not.toContain("is_deleted");
  });

  it("a non-bypassing find skips nothing and spells no restriction", async () => {
    const repo = file(await gen(), "/shop/order_repository.ex");
    const normal = defBody(repo, "find_all_by_normal");
    expect(normal).toContain(
      "from(record in Api.Shop.Order.base_query(), where: record.total > 0)",
    );
    expect(normal).not.toContain("skip_filters");
    // (`is_deleted` itself appears as a sortable column.)
    expect(normal).not.toContain("is_deleted ==");
  });

  it("CRUD list/find_by_id skip nothing", async () => {
    const repo = file(await gen(), "/shop/order_repository.ex");
    expect(defBody(repo, "list")).not.toContain("skip_filters");
    expect(defBody(repo, "find_by_id")).not.toContain("skip_filters");
  });

  it("the retrieval hands the caller's skip_filters to the Repo", async () => {
    const ret = file(await gen(), "/shop/retrievals/find_all_by_big_orders.ex");
    expect(ret).toContain(
      "Repo.all(query, current_user: opts[:current_user], skip_filters: opts[:skip_filters])",
    );
    expect(ret).not.toContain("is_deleted");
  });

  it("inline `Repo.findAll(...) ignoring <Cap>` / `*` passes skip_filters", async () => {
    const wf = file(await gen(), "/shop/workflows/sweep.ex");
    expect(wf).toContain("run_find_all_by_big_orders_order(skip_filters: [:soft_deletable])");
    expect(wf).toContain("run_find_all_by_big_orders_order(skip_filters: :all)");
  });
});
