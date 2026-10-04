// M-T6.71 — a non-UUID id in a LiveView route answered a 500.
//
// The scaffolded Detail page loads its record with `get_<agg>(socket.assigns.id)`,
// which is `Repo.get/2` over a `:binary_id` key — and that RAISES
// `Ecto.Query.CastError` on a malformed id, so a hand-typed `/employees/abc`
// crashed the LiveView instead of rendering the page's not-found arm.  The JSON
// controller already refuses the same id at its edge (`__cast_path_id`, 422);
// the page has no status to answer, so a malformed id reads as "no such
// record".  The in-process history loader (`QueryView { of: <Agg>.history(id) }`)
// calls the same `get_<agg>` and gets the same cast first.

import { describe, expect, it } from "vitest";
import { generateSystems } from "../../../src/system/index.js";
import { parseString } from "../../_helpers/index.js";

const SRC = `system S {
  subdomain M {
    context C {
      aggregate Employee audited {
        name: string
        create(name: string) { name := name }
        operation rename(name: string) { name := name }
      }
      repository Employees for Employee { }
    }
  }
  ui W with scaffold(contexts: [C]) { }
  api A from M
  storage db { type: postgres }
  resource st { for: C, kind: state, use: db }
  deployable api { platform: elixir  contexts: [C]  dataSources: [st]  serves: A  ui: W  port: 8080 }
}`;

async function detailLive(): Promise<string> {
  const { model } = await parseString(SRC);
  const files = generateSystems(model).files;
  for (const [p, c] of files) if (p.endsWith("live/employee_detail_live.ex")) return c;
  throw new Error("no employee_detail_live.ex emitted");
}

describe("LiveView detail page — a malformed route id (M-T6.71)", () => {
  it("casts the id before the by-id fetch and renders not-found on a malformed one", async () => {
    const live = await detailLive();
    const handle = live.slice(
      live.indexOf("def handle_params"),
      live.indexOf("{:noreply, socket}"),
    );
    const cast = handle.indexOf("case Ecto.UUID.cast(socket.assigns.id) do");
    const fetch = handle.indexOf("get_employee(socket.assigns.id)");
    expect(cast, "the by-id load is not guarded by a UUID cast").toBeGreaterThanOrEqual(0);
    expect(fetch).toBeGreaterThan(cast);
    expect(handle.slice(cast, fetch)).toMatch(/:error ->\s+assign\(socket, :\w+, :not_found\)/);
  });

  it("casts the id inside the in-process history loader too", async () => {
    const live = await detailLive();
    const at = live.indexOf("defp load_employee_history");
    expect(at, "no history loader emitted — the fixture is not exercising this").toBeGreaterThan(0);
    const loader = live.slice(at);
    const cast = loader.indexOf("with {:ok, _} <- Ecto.UUID.cast(id),");
    expect(cast, "the history loader's get is not guarded by a UUID cast").toBeGreaterThanOrEqual(
      0,
    );
    expect(loader.indexOf("get_employee(id)")).toBeGreaterThan(cast);
  });
});
