import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// Slice 8 (vanilla foundation) — repository read functions beyond CRUD.
//
// A key lookup over a declared `unique (…)` tuple (`Repo.findBy(email: v)` /
// `Repo.getBy(email: v)`, D-REPO-KEY-LOOKUP) is DERIVED as a repository find
// (one per verb × tuple) and lowers to a function on the per-aggregate
// repository module + a defdelegate on the context facade:
//
//   aggregate Customer { email: string  unique (email) }
//   … Customers.findBy(email: needle) …
//
// emits, in lib/<app>/<ctx>/<agg>_repository.ex:
//
//   def find_by_email(email) do
//     query = from(record in Customer, where: record.email == ^email)
//     {:ok, Repo.one(query)}
//   end
//
// and the context facade gains:
//
//   defdelegate find_by_email_customer(email), to: Api.Orders.CustomerRepository, as: :find_by_email
//
// `findBy` is optional (`{:ok, nil}` on a miss); `getBy` must exist and answers
// `{:error, :not_found}` on a miss.  A workflow read routes through the
// defdelegate.
// ---------------------------------------------------------------------------

const SOURCE = `
system Sales {
  subdomain Core {
    context Orders {
      enum OrderStatus { Draft, Confirmed, Shipped }
      aggregate Customer with crudish {
        name: string
        email: string
        unique (email)
      }
      aggregate Order with crudish {
        customerId: Customer id
        status: OrderStatus
      }
      repository Customers for Customer
      repository Orders for Order

      workflow tagFirstByEmail {
        create(needle: string) {
          if let c = Customers.findBy(email: needle) {
          } else {
            notFound
          }
        }
      }
      workflow requireByEmail {
        create(needle: string) {
          let c = Customers.getBy(email: needle)
        }
      }
    }
  }
  api OrdersApi from Core
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

async function load(): Promise<Map<string, string>> {
  return generateSystemFiles(SOURCE);
}

describe("vanilla — key-lookup find functions on the repository module", () => {
  it("emits `import Ecto.Query` for the key-lookup reads", async () => {
    const files = await load();
    const customer = files.get(
      [...files.keys()].find((k) => k.endsWith("/customer_repository.ex"))!,
    )!;
    expect(customer).toContain("import Ecto.Query");
  });

  it("an optional key lookup (`findBy`) uses `Repo.one(query)`", async () => {
    const files = await load();
    const customer = files.get(
      [...files.keys()].find((k) => k.endsWith("/customer_repository.ex"))!,
    )!;
    expect(customer).toContain(
      "def find_by_email(email) do\n    query = from(record in Api.Orders.Customer.base_query(), where: record.email == ^email)\n    {:ok, Repo.one(query)}\n  end",
    );
  });

  it("a must-exist key lookup (`getBy`) answers `{:error, :not_found}` on a miss", async () => {
    const files = await load();
    const customer = files.get(
      [...files.keys()].find((k) => k.endsWith("/customer_repository.ex"))!,
    )!;
    expect(customer).toContain(
      "def get_by_email(email) do\n    query = from(record in Api.Orders.Customer.base_query(), where: record.email == ^email)\n\n    case Repo.one(query) do\n      nil -> {:error, :not_found}\n      found -> {:ok, found}\n    end\n  end",
    );
  });

  it("the enrichment-synthesized `all` find is dropped (would collide with list/0)", async () => {
    const files = await load();
    const customer = files.get(
      [...files.keys()].find((k) => k.endsWith("/customer_repository.ex"))!,
    )!;
    // No `def all(...)` — the CRUD `list/0` already covers it; emitting
    // `all/0` would duplicate the seam.
    expect(customer).not.toMatch(/def all\(/);
  });

  it("a repository with NO custom finds still imports Ecto.Query for the paged list", async () => {
    const files = await generateSystemFiles(`
      system Tasks {
        subdomain Productivity {
          context Tracker {
            aggregate Task with crudish { title: string }
            repository Tasks for Task { }
          }
        }
        api TrackerApi from Productivity
        storage primary { type: postgres }
        resource trackerState { for: Tracker, kind: state, use: primary }
        deployable api {
          platform: elixir
          contexts: [Tracker]
          dataSources: [trackerState]
          serves: TrackerApi
          port: 4000
        }
      }
    `);
    const task = files.get([...files.keys()].find((k) => k.endsWith("/task_repository.ex"))!)!;
    // Paged-by-default: even a find-free repo's `list` uses from/order_by/limit/
    // offset, so the Ecto.Query import is always present now.
    expect(task).toContain("import Ecto.Query");
    // Regression: an empty findBlock must NOT collapse the persist_change
    // `end` into the module's `end` (the `endend` mix-compile bug from CI).
    expect(task).not.toContain("endend");
    // (M-T6.27: `persist_change` on a versioned aggregate now carries the
    // stale-write rescue between the update and the two `end`s.)
    expect(task).toMatch(
      /Repo\.update\(changeset, force: true\)\n {2}rescue\n {4}Ecto\.StaleEntryError -> \{:error, :conflict\}\n {2}end\nend\n?$/,
    );

    // Regression: the per-aggregate context block must end with `\n` so the
    // module's `end` doesn't fuse with the last member (the `as: :deleteend`
    // mix-compile bug — TokenMissingError from CI).  `Task with crudish` has a
    // `destroy` action, so the block's tail is now the `destroy_<agg>!` bang
    // function (the DestroyForm seam, gap §10), emitted after `change_<agg>`;
    // its `end` is separated from the module's `end` by a newline.
    const ctx = files.get([...files.keys()].find((k) => k.endsWith("/lib/api/tracker.ex"))!)!;
    expect(ctx).not.toContain(":deleteend");
    expect(ctx).toContain(
      "def change_task(record_or_struct \\\\ %Api.Tracker.Task{}, attrs \\\\ %{}),\n    do: Api.Tracker.TaskChangeset.base_changeset(record_or_struct, attrs)",
    );
    expect(ctx).toMatch(/def destroy_task!\(id\) do/);
    expect(ctx).toMatch(/end\n {2}end\nend\n?$/);
  });
});

describe("vanilla — context facade defdelegates key-lookup finds", () => {
  it("emits one `defdelegate <find>_<agg>(args)` per derived key lookup", async () => {
    const files = await load();
    const ctx = files.get([...files.keys()].find((k) => k.endsWith("/lib/api/orders.ex"))!)!;
    expect(ctx).toContain(
      "defdelegate find_by_email_customer(email), to: Api.Orders.CustomerRepository, as: :find_by_email",
    );
    expect(ctx).toContain(
      "defdelegate get_by_email_customer(email), to: Api.Orders.CustomerRepository, as: :get_by_email",
    );
  });
});

describe("vanilla — a workflow key-lookup read routes through the context defdelegate", () => {
  it("`let c = Customers.getBy(email: needle)` lowers to a Context.get_by_email_customer with-clause", async () => {
    const files = await load();
    const wf = files.get(
      [...files.keys()].find((k) => k.endsWith("/workflows/require_by_email.ex"))!,
    )!;
    expect(wf).toContain("{:ok, c} <- (case Context.get_by_email_customer(needle) do");
    // The miss is the standard not-found answer.
    expect(wf).toContain('{:error, :not_found} -> {:error, {:not_found, "not_found"}}');
  });

  it("`if let c = Customers.findBy(email: needle)` reads the optional lookup", async () => {
    const files = await load();
    const wf = files.get(
      [...files.keys()].find((k) => k.endsWith("/workflows/tag_first_by_email.ex"))!,
    )!;
    expect(wf).toContain("c = case Context.find_by_email_customer(needle) do");
  });

  it("the param ref (`needle`) is destructured off run/1 params", async () => {
    const files = await load();
    const wf = files.get(
      [...files.keys()].find((k) => k.endsWith("/workflows/tag_first_by_email.ex"))!,
    )!;
    expect(wf).toContain(`%{"needle" => needle} = params`);
  });

  it("no `# TODO: lower workflow statement kind 'repo-let'` comment appears", async () => {
    const files = await load();
    const wf = files.get(
      [...files.keys()].find((k) => k.endsWith("/workflows/tag_first_by_email.ex"))!,
    )!;
    expect(wf).not.toContain("# TODO: lower workflow statement kind 'repo-let'");
  });
});
