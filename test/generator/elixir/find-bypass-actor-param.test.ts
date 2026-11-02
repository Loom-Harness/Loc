// ---------------------------------------------------------------------------
// Phoenix (vanilla Ecto) — a relational `find(C) ignoring <cap>` passes the
// actor and the skipped capabilities to the Repo; `Repo.prepare_query/3` does
// the rest.
//
// The read never spells a restriction, so every principal-scoped read takes
// its actor the same way — as the `current_user:` read option — whether or
// not it drops the tenant clause.  The head therefore always binds
// `current_user` (no unread binding for `--warnings-as-errors` to reject), and
// the ARITY is unchanged: callers pass the actor positionally.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { corpusSourceFor } from "../../fixtures/corpus/harness.js";

const SRC = corpusSourceFor("find-bypass", "vanilla");
const REPO = "d/lib/d/orders/order_repository.ex";
const SCOPED = "d/lib/d/orders/retrievals/find_all_by_scoped.ex";

function body(src: string, name: string): string {
  const start = src.indexOf(`def ${name}(`);
  const next = src.indexOf("\n  def ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("elixir vanilla — actor + skip_filters on a bypassing read", () => {
  it("a read that keeps every clause passes the actor and skips nothing", async () => {
    // `Orders.find(Scoped(c))` (no clause) runs the criterion retrieval.
    const run = (await generateSystemFiles(SRC)).get(SCOPED)!;
    expect(run).toContain("def run(c, opts \\\\ []) do");
    expect(run).toContain("from(record in D.Orders.Order.base_query(), where: record.code == ^c)");
    expect(run).toContain(
      "Repo.all(query, current_user: opts[:current_user], skip_filters: opts[:skip_filters])",
    );
  });

  it("`ignoring tenantOwned` skips exactly the tenant clause", async () => {
    const read = body(
      (await generateSystemFiles(SRC)).get(REPO)!,
      "find_first_by_code_ignoring_tenant_owned",
    );
    expect(read).toContain(
      "def find_first_by_code_ignoring_tenant_owned(c, current_user \\\\ nil) do",
    );
    expect(read).toContain("current_user: current_user, skip_filters: [:tenant_owned])");
    expect(read).not.toContain("tenant_id");
  });

  it("`ignoring *` skips every clause", async () => {
    const read = body(
      (await generateSystemFiles(SRC)).get(REPO)!,
      "find_first_by_code_ignoring_all",
    );
    expect(read).toContain("skip_filters: :all");
    expect(read).not.toContain("tenant_id");
    expect(read).not.toContain("is_deleted");
  });

  it("the arity is unchanged — every bypassing read still takes the actor positionally", async () => {
    const repo = (await generateSystemFiles(SRC)).get(REPO)!;
    for (const name of [
      "find_first_by_code_ignoring_tenant_owned",
      "find_first_by_code_ignoring_all",
    ]) {
      expect(repo).toMatch(new RegExp(`@spec ${name}\\(term\\(\\), map\\(\\) \\| nil\\)`));
    }
  });
});

// The CALLER side.  A routed handler's `if let x = Repo.find(C) ignoring <cap>`
// calls the synthesized repository find, which still scopes by the actor when
// the bypass left a principal capability in place.  The handler has to bind
// the conn's `current_user` and pass it; passing none compares
// `tenant_id == ^nil`, which Ecto refuses at runtime (a 500 on every request).
const READS_SRC = corpusSourceFor("inheritance-read-restrictions", "vanilla");
const HANDLERS = "d/lib/d/fleet/handlers";
const CONTROLLER = "d/lib/d_web/controllers/fleet_api_routes_controller.ex";

describe("elixir vanilla — a routed handler passes the actor to a bypassing find", () => {
  it("`ignoring softDeletable` on a tenantOwned TPH / TPC subtype passes current_user", async () => {
    const files = await generateSystemFiles(READS_SRC);
    const car = files.get(`${HANDLERS}/get_car_by_plate_all.ex`)!;
    expect(car).toContain("def run(params, current_user \\\\ nil) when is_map(params) do");
    expect(car).toContain(
      "Context.find_first_by_plate_ignoring_soft_deletable_car(p, current_user)",
    );
    const driver = files.get(`${HANDLERS}/get_driver_by_name_all.ex`)!;
    expect(driver).toContain(
      "Context.find_first_by_name_ignoring_soft_deletable_driver(n, current_user)",
    );
    const controller = files.get(CONTROLLER)!;
    expect(controller).toContain(
      "GetCarByPlateAll.run(params, Map.get(conn.assigns, :current_user))",
    );
  });

  it("`ignoring tenantOwned` still threads the actor — the Repo skips the clause", async () => {
    const files = await generateSystemFiles(READS_SRC);
    const h = files.get(`${HANDLERS}/get_car_by_plate_any_tenant.ex`)!;
    expect(h).toContain("def run(params, current_user \\\\ nil) when is_map(params) do");
    expect(h).toContain("Context.find_first_by_plate_ignoring_tenant_owned_car(p, current_user)");
  });
});
