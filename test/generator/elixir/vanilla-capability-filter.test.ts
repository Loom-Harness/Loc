import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// Capability `filter` on the plain-Ecto backend.
//
// The Ash foundation installs a `filter <expr>` capability once via the
// resource `base_filter`; plain Ecto has no global query filter, so the
// generated vanilla modules must AND the predicate into EVERY root read of the
// aggregate — `list/0`, `find_by_id/1`, each criterion find, and every retrieval.
// (Before this, a vanilla capability filter was silently dropped,
// so reads returned soft-deleted / out-of-scope rows.)
//
// Predicates render under the `record` Ecto binding (`!this.archived` →
// `not record.archived`).
// ---------------------------------------------------------------------------

const SOURCE = `
system Catalog {
  subdomain Core {
    context Shop with scaffoldPaged(of: OrdersByCustomer) {
      aggregate Order {
        customerId: string
        total: int
        archived: bool
        filter !this.archived
      }
      repository Orders for Order { }
      criterion OrdersByCustomer(customerId: string) of Order = this.customerId == customerId
      retrieval BigOrders(min: int) of Order { where: total >= min  sort: [total desc] }
    }
  }
  api CatalogApi with scaffoldPagedApi(of: OrdersByCustomer) from Core
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

async function gen(): Promise<Map<string, string>> {
  return generateSystemFiles(SOURCE);
}

function file(files: Map<string, string>, suffix: string): string {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return files.get(key!)!;
}

describe("vanilla capability filter — every read starts from base_query/0", () => {
  it("hosts the bare filter in the schema's base_query/0", async () => {
    const schema = file(await gen(), "/shop/order.ex");
    expect(schema).toContain(
      "def base_query, do: Ecto.Query.from(record in __MODULE__, where: not record.archived)",
    );
    // Nothing bypassable: prepare_query has no clause to apply.
    expect(schema).toContain("def __loom_filters__, do: []");
  });

  it("a criterion find leaves the filter to the schema", async () => {
    // `scaffoldPaged` synthesises the repository's `find_all_by_<criterion>`.
    const repo = file(await gen(), "/shop/order_repository.ex");
    expect(repo).toContain("def find_all_by_orders_by_customer(customer_id,");
    expect(repo).not.toContain("record.archived");
  });

  it("starts a custom find from base_query/0 with only its own where", async () => {
    const repo = file(await gen(), "/shop/order_repository.ex");
    expect(repo).toContain(
      "from(record in Api.Shop.Order.base_query(), where: record.customer_id == ^customer_id)",
    );
  });

  it("starts a retrieval from base_query/0 with only its own where", async () => {
    const ret = file(await gen(), "/shop/retrievals/big_orders.ex");
    expect(ret).toContain(
      "query = from(record in Api.Shop.Order.base_query(), where: record.total >= ^min)",
    );
    expect(ret).not.toContain("not record.archived");
  });

  it("gives a filter-free aggregate a bare base_query/0", async () => {
    const noFilter = SOURCE.replace("        filter !this.archived\n", "");
    const files = await generateSystemFiles(noFilter);
    expect(file(files, "/shop/order.ex")).toContain(
      "def base_query, do: Ecto.Query.from(record in __MODULE__)",
    );
    expect(file(files, "/shop/order_repository.ex")).toContain(
      "query = Api.Shop.Order.base_query()",
    );
  });

  // A money/decimal filter must render with the NATIVE Ecto-query form
  // (`record.total > 10.00`), not the in-memory `Decimal.compare(...) == :gt`
  // struct API — the latter is not a valid Ecto query expression and fails
  // `mix compile`.  Only bool/id/string/enum render identically in both modes.
  it("renders a money capability filter as native Ecto, not Decimal.compare", async () => {
    const src = `
system Bill {
  subdomain Core {
    context Ledger {
      aggregate Invoice {
        code: string
        total: money
        filter this.total > money("10.00")
      }
      repository Invoices for Invoice { }
    }
  }
  api BillApi from Core
  storage pg { type: postgres }
  resource st { for: Ledger, kind: state, use: pg }
  deployable api {
    platform: elixir
    contexts: [Ledger]
    dataSources: [st]
    serves: BillApi
    port: 4000
  }
}`;
    const schema = file(await generateSystemFiles(src), "/ledger/invoice.ex");
    expect(schema).toContain("where: record.total > 10.00");
    expect(schema).not.toContain("Decimal.compare");
  });
});
