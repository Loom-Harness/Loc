// SvelteKit's route-directory collision — §18's bare
// `throw new Error("svelte: pages 'A' and 'B' both route to …")`.
//
// Measured on this tree before the gate: `ddd generate system` printed
// `0 error(s), 0 warning(s)` and THEN died with that Error and a ten-frame
// stack trace through `emitSveltePagesForUi`.  No `loom.*` code, nothing to
// look up, and — because the collision is decided by a SvelteKit path — no way
// for the author to tell it apart from a toolchain bug.
//
// `loom.ui-page-route-collision` (phase ⑦, `ui-page-identity-checks.ts`) now
// refuses it on the ROUTE, which is strictly stronger than the path: two pages
// at `/dup` under DIFFERENT layouts land in different SvelteKit directories and
// so would pass the emitter's check, while still being one address that only
// one of them can answer on. The throw stays as an internal floor because the
// api toolkit and the playground can both hand a generator an unvalidated
// model.

import { describe, expect, it } from "vitest";
import { generateSystemFilesUnchecked } from "../../_helpers/generate.js";

const sys = (alphaRoute: string, betaRoute: string) => `
system RouteFloor {
  subdomain Work { context Ops {
    aggregate Job with crudish { name: string }
  } }
  api OpsApi from Work
  storage pg { type: postgres }
  resource st { for: Ops, kind: state, use: pg }
  ui Console {
    page Alpha { route: "${alphaRoute}" body: Stack { Heading { "Alpha", level: 1 } } }
    page Beta { route: "${betaRoute}" body: Stack { Heading { "Beta", level: 1 } } }
  }
  deployable api { platform: node, contexts: [Ops], dataSources: [st], serves: OpsApi, port: 8080 }
  deployable web { platform: svelte, targets: api, ui: Console, port: 3001 }
}`;

const WHY =
  "the SvelteKit emitter's internal floor IS the subject — `loom.ui-page-route-collision` " +
  "makes this shape unreachable through `ddd generate`";

describe("svelte route-directory collision", () => {
  it("throws the coded floor, naming the gate rather than re-explaining SvelteKit", async () => {
    await expect(generateSystemFilesUnchecked(sys("/dup", "/dup"), WHY)).rejects.toThrow(
      /internal: svelte pages 'Alpha' and 'Beta' both emit to src\/routes\/\(app\)\/dup\/\+page\.svelte/,
    );
  });

  it("lets a user page take `/` from the scaffold's synthesised Home", async () => {
    // The rule React has always implemented (`app-shell.ts`'s
    // `userHasRootRoute`) and SvelteKit could not express: both pages compute
    // the same route DIRECTORY.  Before this arm, a `with scaffold(...)` ui plus
    // a hand-written `page Dashboard { route: "/" }` — valid `.ddd` that
    // generates correctly on React — hit the floor above.
    const files = await generateSystemFilesUnchecked(
      `
system ScaffoldYield {
  subdomain Work { context Ops {
    aggregate Job with crudish { name: string }
  } }
  api OpsApi from Work
  storage pg { type: postgres }
  resource st { for: Ops, kind: state, use: pg }
  ui Console with scaffold(aggregates: [Job]) {
    page Dashboard { route: "/" body: Stack { Heading { "Dashboard!", level: 1 } } }
  }
  deployable api { platform: node, contexts: [Ops], dataSources: [st], serves: OpsApi, port: 8080 }
  deployable web { platform: svelte, targets: api, ui: Console, port: 3001 }
}`,
      "the scaffold-Home yield is the subject; nothing here is invalid",
    );
    const root = [...files.entries()].find(([k]) => k.endsWith("routes/(app)/+page.svelte"));
    expect(root, "no root page emitted").toBeDefined();
    // The USER page's body, not the scaffold landing page's.
    expect(root![1]).toContain("Dashboard!");
    // The scaffolded list/detail/new pages still emit — the yield drops exactly
    // one page, not the scaffold.
    expect([...files.keys()].filter((k) => k.endsWith("+page.svelte")).length).toBeGreaterThan(1);
  }, 60_000);

  it("emits both pages when the routes differ (the control)", async () => {
    const files = await generateSystemFilesUnchecked(sys("/a", "/b"), WHY);
    const routes = [...files.keys()].filter((k) => k.endsWith("+page.svelte"));
    expect(routes.some((k) => k.includes("/a/"))).toBe(true);
    expect(routes.some((k) => k.includes("/b/"))).toBe(true);
  }, 60_000);
});
