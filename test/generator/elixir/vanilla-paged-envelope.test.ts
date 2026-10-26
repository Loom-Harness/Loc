import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// Paged WIRE ENVELOPE on the vanilla (plain Ecto/Phoenix) foundation — gap §1.
//
// A repository find whose return type is the generic `paged<T>` carrier must
// emit the cross-backend paged envelope (`{items, page, pageSize, total,
// totalPages}`, 1-based page) — `page`/`pageSize` read from query params,
// `limit`/`offset` + a count query applied to the Ecto query.  The vanilla
// backend used to ignore the carrier and return a bare list; this pins the
// envelope (and that a non-paged find stays a bare list).
//
// Cross-backend wire parity is the contract — see
// `test/conformance/paged-wire-parity.test.ts` for the key-order cross-check.
// ---------------------------------------------------------------------------

const SOURCE = `
system PagedShop {
  subdomain Sales {
    context Orders {
      aggregate Order {
        code: string
        region: string
      }
      repository Orders for Order { }
      criterion InRegion(region: string) of Order = this.region == region
      queryHandler ListInRegion(region: string): Order paged {
        let r = Orders.run(InRegion(region))
        return r
      }
    }
  }
  api OrdersApi from Sales { route GET "/orders/in_region/{region}" -> Orders.ListInRegion }
  storage primary { type: postgres }
  resource ordersState { for: Orders, kind: state, use: primary }
  deployable api {
    platform: elixir
    contexts: [Orders]
    dataSources: [ordersState]
    serves: OrdersApi
    port: 4000
  }
}
`;

function file(files: Map<string, string>, suffix: string): string {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return files.get(key!)!;
}

describe("vanilla `paged` wire envelope (§1)", () => {
  it("the repository paged read applies limit/offset + a count and returns the envelope map", async () => {
    const repo = file(await generateSystemFiles(SOURCE), "/orders/order_repository.ex");

    // page/page_size + sort/dir threaded with the shared 1-based defaults.
    expect(repo).toContain(
      'def find_all_by_in_region(region, page \\\\ 1, page_size \\\\ 20, sort \\\\ "id", dir \\\\ "asc") do',
    );

    // count query for `total`, then an order_by + limit/offset page slice (M-T2.6).
    // `count(*)`, not `count(id)`: the latter defeats the index-only scan.
    expect(repo).toContain("total = Repo.aggregate(query, :count)\n");
    expect(repo).not.toContain(":count, :id");
    expect(repo).toContain("offset = (page - 1) * page_size");
    expect(repo).toContain('dir_atom = if dir == "desc", do: :desc, else: :asc');
    expect(repo).toContain("|> order_by([record], [{^dir_atom, field(record, ^sort_col)}])");

    // the envelope map — canonical wire keys (atom keys serialise to camelCase JSON).
    expect(repo).toContain("items: items");
    expect(repo).toContain("page: page");
    expect(repo).toContain("pageSize: page_size");
    expect(repo).toContain("total: total");
    expect(repo).toContain("totalPages: if(page_size > 0, do: ceil(total / page_size), else: 0)");
  });

  it("the controller reads page/pageSize params and serialises the envelope items", async () => {
    const ctrl = file(await generateSystemFiles(SOURCE), "/controllers/order_controller.ex");

    expect(ctrl).toContain('page_param(params, "page", 1, 1000000)');
    expect(ctrl).toContain('page_param(params, "pageSize", 20, 500)');
    // only items are per-record serialised; the scalar counters pass through.
    expect(ctrl).toContain("json(conn, %{result | items: Enum.map(result.items, &serialize/1)})");
    // the page_param/3 coercion helper is emitted once.
    expect(ctrl).toContain("defp page_param(params, key, default, limit) do");
    expect((ctrl.match(/defp page_param\(/g) ?? []).length).toBe(1);
  });

  it("the context defdelegate carries the matching page arity so the controller call routes", async () => {
    const context = file(await generateSystemFiles(SOURCE), "/orders.ex");
    expect(context).toContain(
      'defdelegate find_all_by_in_region_order(region, page \\\\ 1, page_size \\\\ 20, sort \\\\ "id", dir \\\\ "asc"), to: ',
    );
  });
});
