// The F8 static-sub-path 405 guard on Phoenix (ledger `static-subpath-405`).
//
// A phoenix router keys on (method, path) IN DECLARATION ORDER, so
// `DELETE /api/articles/by_owner` fell through `get "/articles/by_owner"`
// (wrong verb) into `delete "/articles/:id"` and bound `id = "by_owner"` — the
// request never reached `NotFoundController` (the only 405 + `Allow` source
// here) and answered the `:id` cast's 422 instead.  #2764 closed this on node,
// java, python and .NET; elixir was the one arm left, and reconciliation 3
// re-derived it as elixir-ONLY (the ledger row's original title had it the
// other way round).
//
// The guard is a `match :*` route at the EXACT static path, spliced in right
// after the LAST real route for that path — the real routes still win for the
// verbs they serve, and every other verb lands on
// `NotFoundController.not_found`, which derives `Allow` from
// `Phoenix.Router.route_info/4` rather than from a second copy of the table.
//
// Swept over the WHOLE router (rule 11), not just one path: every
// one-segment static sub-path the router mounts must carry a guard, and no
// `:id`-bearing path may.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
system Blog {
  subdomain Writing {
    context Content {
      aggregate Article with crudish {
        title: string
        owner: string
        operation publish() { title := title }
      }
      repository Articles for Article {
        find byOwner(who: string): Article[] where this.owner == who
        find recent(): Article[] where this.title != ""
      }
    }
  }
  api ContentApi from Writing
  storage primary { type: postgres }
  resource contentState { for: Content, kind: state, use: primary }
  deployable api {
    platform: elixir
    contexts: [Content]
    dataSources: [contentState]
    serves: ContentApi
    port: 4000
  }
}
`;

/** Only the lines inside `scope "/api", …` — the block the guard splices into. */
function apiScope(router: string): string[] {
  const start = router.indexOf('scope "/api"');
  expect(start, "fixture produced no /api scope").toBeGreaterThan(-1);
  const end = router.indexOf("\n  end", start);
  return router
    .slice(start, end)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

const ROUTE_RE = /^(get|post|put|patch|delete) "([^"]+)"/;
const GUARD_RE = /^match :\*, "([^"]+)", NotFoundController, :not_found$/;

async function router(): Promise<string> {
  const files = await generateSystemFiles(SRC);
  const key = [...files.keys()].find((k) => k.endsWith("_web/router.ex"));
  if (!key) throw new Error("no router.ex generated");
  return files.get(key)!;
}

describe("phoenix router — static sub-path 405 guard (F8)", () => {
  it("guards EVERY one-segment static sub-path the router mounts", async () => {
    const lines = apiScope(await router());
    const statics = new Set<string>();
    for (const l of lines) {
      const m = ROUTE_RE.exec(l);
      if (!m) continue;
      const segs = m[2]!.split("/").filter(Boolean);
      if (segs.length === 2 && !segs[1]!.includes(":")) statics.add(m[2]!);
    }
    // Vacuity guard — the fixture must actually produce static sub-paths, or
    // an empty set would pass this trivially (the §104 failure shape).
    expect([...statics].sort()).toEqual(["/articles/by_owner", "/articles/recent"]);
    const guarded = new Set(lines.map((l) => GUARD_RE.exec(l)?.[1]).filter(Boolean));
    expect([...guarded].sort()).toEqual([...statics].sort());
  });

  it("places each guard AFTER its real routes and BEFORE the `:id` route", async () => {
    const lines = apiScope(await router());
    const idAt = lines.findIndex((l) => /^delete "\/articles\/:id"/.test(l));
    expect(idAt, "fixture has no `delete /articles/:id`").toBeGreaterThan(-1);
    for (const path of ["/articles/by_owner", "/articles/recent"]) {
      const realAt = lines.findIndex((l) => ROUTE_RE.exec(l)?.[2] === path);
      const guardAt = lines.findIndex((l) => GUARD_RE.exec(l)?.[1] === path);
      expect(realAt, `${path}: no real route`).toBeGreaterThan(-1);
      // After its own route — a guard declared first would shadow the GET.
      expect(guardAt, `${path}: guard before its real route`).toBeGreaterThan(realAt);
      // Before the `/:id` route, which is what used to swallow the wrong verb.
      expect(guardAt, `${path}: guard after /:id`).toBeLessThan(idAt);
    }
  });

  it("guards no path carrying a path parameter", async () => {
    for (const l of apiScope(await router())) {
      const g = GUARD_RE.exec(l);
      if (g) expect(g[1], `${g[1]} must not be guarded`).not.toContain(":");
    }
  });

  it("emits no guard when the aggregate mounts no static sub-path", async () => {
    const files = await generateSystemFiles(`
system Bare {
  subdomain W { context C {
    aggregate Note with crudish { body: string }
    repository Notes for Note { }
  } }
  api CApi from W
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: elixir contexts: [C] dataSources: [st] serves: CApi port: 4000 }
}
`);
    const key = [...files.keys()].find((k) => k.endsWith("_web/router.ex"))!;
    const lines = apiScope(files.get(key)!);
    expect(lines.filter((l) => GUARD_RE.test(l))).toEqual([]);
  });
});
