// ---------------------------------------------------------------------------
// Phoenix (vanilla Ecto) — a relational `find(C) ignoring <principal cap>` must
// not bind an actor it no longer reads.
//
// The capability filter is recomputed PER READ with that read's own `ignoring`
// clause, so a read that drops the tenant conjunct emits a `where:` with no
// `current_user` in it.  Its function head must then underscore the actor: an
// unread binding is a warning, and the corpus elixir leg compiles with
// `--warnings-as-errors`, so a bare `current_user` fails the build:
//
//     warning: variable "current_user" is unused …
//     Compilation failed due to warnings while using the --warnings-as-errors option
//
// The ARITY is unchanged either way — callers pass the actor positionally
// whether or not the read uses it.  The underscore itself is what the corpus
// elixir leg's `--warnings-as-errors` compile checks; what stays here is which
// conjuncts each read keeps (`corpus/find-bypass`).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { corpusSourceFor } from "../../fixtures/corpus/harness.js";

const SRC = corpusSourceFor("find-bypass", "vanilla");
const REPO = "d/lib/d/orders/order_repository.ex";
const SCOPED = "d/lib/d/orders/retrievals/find_all_by_scoped.ex";

describe("elixir vanilla — actor param on a bypassing read (M-T6.54 F18)", () => {
  it("a read that KEEPS the principal conjunct binds `current_user`", async () => {
    // `Orders.find(Scoped(c))` (no clause) runs the criterion retrieval.
    const run = (await generateSystemFiles(SRC)).get(SCOPED)!;
    expect(run).toContain("def run(c, opts \\\\ []) do");
    expect(run).toContain("current_user = opts[:current_user]");
    // …and the conjunct is really there (vacuity guard: the assertions above
    // would also pass on a read whose `where:` lost the tenant predicate).
    expect(run).toContain("record.tenant_id == ^(current_user && current_user.tenant_id)");
    expect(run).toContain("not record.is_deleted");
  });

  it("`ignoring tenantOwned` drops the principal conjunct and keeps the other", async () => {
    const repo = (await generateSystemFiles(SRC)).get(REPO)!;
    const body = repo.slice(
      repo.indexOf("def find_first_by_code_ignoring_tenant_owned("),
      repo.indexOf("@spec find_first_by_code_ignoring_all("),
    );
    expect(body).toContain(
      "def find_first_by_code_ignoring_tenant_owned(c, _current_user \\\\ nil) do",
    );
    expect(body).not.toContain("tenant_id");
    // The non-principal capability it did NOT name survives.
    expect(body).toContain("not record.is_deleted");
  });

  it("`ignoring *` drops both conjuncts", async () => {
    const repo = (await generateSystemFiles(SRC)).get(REPO)!;
    const body = repo.slice(repo.indexOf("def find_first_by_code_ignoring_all("));
    expect(body.slice(0, 400)).toContain(
      "def find_first_by_code_ignoring_all(c, _current_user \\\\ nil) do",
    );
    expect(body.slice(0, 400)).not.toContain("tenant_id");
    expect(body.slice(0, 400)).not.toContain("is_deleted");
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

  it("`ignoring tenantOwned` reads no actor, so none is threaded", async () => {
    const files = await generateSystemFiles(READS_SRC);
    const h = files.get(`${HANDLERS}/get_car_by_plate_any_tenant.ex`)!;
    expect(h).toContain("def run(params) when is_map(params) do");
    expect(h).toContain("Context.find_first_by_plate_ignoring_tenant_owned_car(p)");
  });
});
