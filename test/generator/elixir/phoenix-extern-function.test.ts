// Phoenix extern frontend function (extern-function-hook-escape-hatch.md):
// a `function f(…): T extern from "<path>"` ui member renders as a
// FULLY-QUALIFIED call into the user's hand-written Elixir module (derived from
// the `from` path) — Elixir resolves a fully-qualified call without an import,
// so no wiring is needed and a missing module fails `mix compile` (the
// fail-fast, matching the JSX frontends' conformance shim).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { generateSystemFilesFromProject } from "../../_helpers/generate.js";

const SOURCE = `system MiniLiveView {
  subdomain Sales {
    context Sales {
      aggregate Customer { name: string }
      repository Customers for Customer { }
    }
  }
  api SalesApi from Sales
  ui SalesAdmin {
    function initials(name: string): string extern from "helpers/format"
    page Home { route: "/" body: Heading { initials("Ada Lovelace") } }
  }
  storage pg { type: postgres }
  resource salesState { for: Sales, kind: state, use: pg }
  deployable phoenixApp {
    platform: elixir, contexts: [Sales], dataSources: [salesState], serves: SalesApi, ui: SalesAdmin, port: 4000
  }
}
`;

async function build(): Promise<Map<string, string>> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-pexternfn-"));
  const file = path.join(dir, "mini.ddd");
  fs.writeFileSync(file, SOURCE);
  return generateSystemFilesFromProject(file);
}

describe("Phoenix extern frontend function", () => {
  it("renders a body call fully-qualified into the module derived from the path", async () => {
    const files = await build();
    const live = files.get("phoenix_app/lib/phoenix_app_web/live/home_live.ex")!;
    expect(live, "home_live.ex is generated").toBeDefined();
    // `from "helpers/format"` → `Helpers.Format`; the call is fully-qualified so
    // no `import` is needed.
    expect(live).toContain('Helpers.Format.initials("Ada Lovelace")');
    expect(live).not.toMatch(/import Helpers\.Format/);
  });
});
