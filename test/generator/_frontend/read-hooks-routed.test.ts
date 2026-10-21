// Every frontend read hook calls a route its backend serves.
//
// A synthesized paged find (the one a paged-run queryHandler mints —
// `findAllBy<Criterion>` / `page<Retrieval>`) has no derived `/<plural>/<find>`
// route: the aggregate router skips it, and its only HTTP surface is the
// explicit `route` an api binds to the handler (`scaffoldPagedApi`).  The
// frontends used to emit a hook for it anyway, against the derived path, so a
// fresh `ddd new --template crud` shipped a client that 404s.  This test reads
// every GET a generated frontend api module issues and checks it against the
// backend's served surface — the derived REST surface (`deriveContextOperations`,
// the one derivation the backend routers render) plus the explicit routes of
// the apis the backend `serves:`.

import { describe, expect, it } from "vitest";
import { renderStarter } from "../../../src/cli/new-templates.js";
import { enrichLoomModel } from "../../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../../src/ir/lower/lower.js";
import { deriveContextOperations } from "../../../src/ir/util/api-surface.js";
import { API_BASE_PATH } from "../../../src/util/api-base.js";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { parseString } from "../../_helpers/parse.js";

/** `GET <path>` slots the backend deployable serves, path tokens as `{}`. */
async function servedGets(src: string, backend: string): Promise<Set<string>> {
  const { model } = await parseString(src, { validate: false });
  const loom = enrichLoomModel(lowerModel(model));
  const sys = loom.systems[0]!;
  const dep = sys.deployables.find((d) => d.name === backend)!;
  const ctxs = sys.subdomains
    .flatMap((s) => s.contexts)
    .filter((c) => dep.contextNames.includes(c.name));
  const out = new Set<string>();
  const norm = (p: string): string => p.replace(/\{[^}]*\}/g, "{}");
  for (const c of ctxs) {
    for (const op of deriveContextOperations(c)) {
      if (op.method === "get") out.add(norm(op.path));
    }
  }
  for (const api of sys.apis.filter((a) => dep.serves.includes(a.name))) {
    for (const r of api.routes) {
      if (r.method.toUpperCase() === "GET") out.add(norm(`${API_BASE_PATH}${r.path}`));
    }
  }
  return out;
}

/** Every GET path a generated frontend's api modules issue, absolute from the
 *  host root, with interpolated segments as `{}`. */
function hookGets(files: ReadonlyMap<string, string>, frontendDir: string): string[] {
  const out = new Set<string>();
  for (const [path, content] of files) {
    if (!path.startsWith(`${frontendDir}/`) || !/\/api\/[^/]+\.ts$/.test(path)) continue;
    if (/\/(client|config|workflows|projections)\.ts$/.test(path)) continue;
    for (const m of content.matchAll(
      /(?:api\.get|http\.get<[^>]*>)\(`(?:\$\{API_BASE_URL\})?([^`]*)`/g,
    )) {
      const raw = m[1]!.replace(/\$\{qs[^}]*\}$/, "").replace(/\$\{qs \? [^`]*$/, "");
      out.add(`${API_BASE_PATH}${raw.replace(/\$\{[^}]*\}/g, "{}")}`);
    }
  }
  return [...out].sort();
}

const STARTERS = [
  { framework: "react", design: "mantine" },
  { framework: "vue", design: "vuetify" },
  { framework: "svelte", design: "shadcnSvelte" },
  { framework: "angular", design: "angularMaterial" },
] as const;

describe("frontend read hooks target a served route", () => {
  for (const { framework, design } of STARTERS) {
    it(`ddd new crud starter (${framework}): every hook GET is served, incl. TasksInProject`, async () => {
      const src = renderStarter({
        name: "myApp",
        template: "crud",
        platform: "node",
        design,
        invocation: "ddd",
      });
      const files = await generateSystemFiles(src);
      const served = await servedGets(src, "api");
      const hooks = hookGets(files, "web_app");
      // Vacuity guard: the scan reached the modules and found the paged read.
      expect(hooks.length).toBeGreaterThan(3);
      expect(hooks).toContain("/api/tasks/projections/tasks_in_project");
      expect(hooks.filter((h) => !served.has(h))).toEqual([]);
    });
  }

  const FIXTURE = (apiMacro: string): string => `
system P {
  subdomain S {
    context C with scaffoldPaged(of: MyThings) {
      aggregate Thing with crudish { name: string  owner: string  rank: int }
      criterion OwnedBy(o: string) of Thing = owner == o
      retrieval MyThings(o: string) of Thing { where: OwnedBy(o)  sort: [rank desc] }
      repository Things for Thing { }
    }
  }
  api PApi${apiMacro} from S { }
  ui WebApp with scaffold(subdomains: [S]) { }
  storage primary { type: postgres }
  resource s { for: C, kind: state, use: primary }
  deployable api { platform: node  contexts: [C]  dataSources: [s]  serves: PApi  port: 3000 }
  deployable web { platform: react  targets: api  ui: WebApp  port: 3001 }
}`;

  it("scaffoldPaged + scaffoldPagedApi: the paged hook calls the projections route", async () => {
    const src = FIXTURE(" with scaffoldPagedApi(of: MyThings)");
    const files = await generateSystemFiles(src);
    const hooks = hookGets(files, "web");
    expect(hooks).toContain("/api/things/projections/my_things");
    const served = await servedGets(src, "api");
    expect(hooks.filter((h) => !served.has(h))).toEqual([]);
  });

  // A page that READS the synthesized find needs the hook, so an unrouted one is
  // refused up front (`loom.ui-read-unresolved#unrouted`) instead of becoming a
  // missing-import build error in the generated client.  LiveView reads the
  // context in-process and needs no route.
  const READING = (apiMacro: string, webPlatform = "react"): string =>
    FIXTURE(apiMacro)
      .replace(
        "ui WebApp with scaffold(subdomains: [S]) { }",
        `ui WebApp {
    page Mine {
      route: "/mine"
      body: QueryView { of: Thing.pageMyThings(o: "alice"), data: rows => Text { "x" } }
    }
  }`,
      )
      .replace(
        "deployable web { platform: react  targets: api  ui: WebApp  port: 3001 }",
        webPlatform === "elixir"
          ? ""
          : `deployable web { platform: ${webPlatform}  targets: api  ui: WebApp  port: 3001 }`,
      )
      .replace(
        "serves: PApi  port: 3000 }",
        webPlatform === "elixir"
          ? "serves: PApi  ui: WebApp  port: 3000 }"
          : "serves: PApi  port: 3000 }",
      )
      .replace(
        "platform: node  contexts",
        `platform: ${webPlatform === "elixir" ? "elixir" : "node"}  contexts`,
      );

  async function unrouted(src: string): Promise<string[]> {
    const { model } = await parseString(src, { validate: false });
    const { validateLoomModel } = await import("../../../src/ir/validate/validate.js");
    return validateLoomModel(enrichLoomModel(lowerModel(model)))
      .filter((d) => d.code === "loom.ui-read-unresolved")
      .map((d) => d.message);
  }

  it("a SPA page reading an unrouted synthesized find is refused", async () => {
    const msgs = await unrouted(READING(""));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain("Thing.pageMyThings");
    expect(msgs[0]).toContain("serves no `GET` route");
  });

  it("the same read is accepted once scaffoldPagedApi routes it, or on LiveView", async () => {
    expect(await unrouted(READING(" with scaffoldPagedApi(of: MyThings)"))).toEqual([]);
    expect(await unrouted(READING("", "elixir"))).toEqual([]);
  });

  it("scaffoldPaged without scaffoldPagedApi: no route, so no hook at all", async () => {
    const files = await generateSystemFiles(FIXTURE(""));
    const thing = files.get("web/src/api/thing.ts") ?? "";
    expect(thing).toContain("useThingById");
    expect(thing).not.toContain("PageMyThings");
    expect(hookGets(files, "web").some((h) => h.includes("my_things"))).toBe(false);
  });
});
