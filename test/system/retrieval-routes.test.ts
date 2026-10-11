// An author-declared `retrieval` is served as its own GET route on all five
// backends: `GET /api/<aggs>/<snake(name)>`, its params bound from the query
// string, an optional `?offset=&limit=` window, its `requires` gate answered
// with 403 BEFORE the read, and the read answered by the retrieval's own
// `run<Retrieval>` method — so the declared `sort:` holds on the wire.
//
// The repository emits NO find method for the route (a duplicate unsorted
// `myThings(o)` beside `runMyThings(o, page)` would be dead code), so each case
// also pins that the route calls `run…`.
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const system = (platform: string, gate = "", extra = "") => `
  system P {
    ${gate ? "user { id: string\n    role: string }" : ""}
    subdomain S {
      context C {
        aggregate Thing with crudish {
          name: string
          owner: string
          rank: int
        }
        criterion OwnedBy(o: string) of Thing = owner == o
        retrieval MyThings(o: string) of Thing${gate} {
          where: OwnedBy(o)
          sort: [rank desc]
        }
        repository Things for Thing { }
      }
    }
    api PApi from S
    storage primary { type: postgres }
    resource s { for: C, kind: state, use: primary }
    deployable api {
      platform: ${platform}
      contexts: [C]
      dataSources: [s]
      serves: PApi
      port: 3000
      ${gate ? "auth: required" : ""}
    }
    ${extra}
  }
`;

const GATE = ' requires currentUser.id != ""';

const srcOf = (files: Map<string, string>, pred: (p: string) => boolean): string =>
  [...files.entries()]
    .filter(([p]) => pred(p))
    .map(([, c]) => c)
    .join("\n");
const allSrc = (files: Map<string, string>): string => srcOf(files, () => true);

describe("retrieval route — one GET per retrieval, answered by run<Retrieval>", () => {
  it("node: query schema with the window, route calls runMyThings, no duplicate find method", async () => {
    const files = await generateSystemFiles(system("node"));
    const route = srcOf(files, (p) => p.endsWith("http/thing.routes.ts"));
    expect(route).toContain("const MyThingsQuery = z.object({");
    expect(route).toContain("  offset: z.coerce.number().int().min(0).max(499999500).optional(),");
    expect(route).toContain("  limit: z.coerce.number().int().min(1).max(500).optional(),");
    expect(route).toContain('path: "/my_things",');
    expect(route).toContain('operationId: "myThingsThing",');
    expect(route).toContain(
      "await repo.runMyThings(params.o, { offset: params.offset, limit: params.limit });",
    );
    const repo = srcOf(files, (p) => p.endsWith("thing-repository.ts"));
    expect(repo).toContain("async runMyThings(o: string, page?:");
    expect(repo).not.toMatch(/async myThings\(/);
  });

  it("dotnet: controller binds the window, handler calls RunMyThingsAsync", async () => {
    const src = allSrc(await generateSystemFiles(system("dotnet")));
    expect(src).toContain('[HttpGet("my_things")]');
    expect(src).toContain(
      "[FromQuery] [System.ComponentModel.DataAnnotations.Range(0, 499999500)] int? offset = null",
    );
    expect(src).toContain("new MyThingsQuery(o, offset, limit)");
    expect(src).toContain("record MyThingsQuery(string O, int? Offset, int? Limit)");
    expect(src).toContain(
      "_repo.RunMyThingsAsync(query.O, (query.Offset, query.Limit), cancellationToken: cancellationToken)",
    );
    expect(src).not.toMatch(/Task<List<Thing>> MyThings\(/);
  });

  it("python: FastAPI route with the window calls run_my_things", async () => {
    const src = allSrc(await generateSystemFiles(system("python")));
    expect(src).toContain('@router.get("/my_things", response_model=ThingListResponse');
    expect(src).toContain("offset: Annotated[int | None, Query(ge=0, le=499999500)] = None");
    expect(src).toContain("await repo.run_my_things(o, offset, limit)");
    expect(src).not.toMatch(/async def my_things\(self/);
  });

  it("java: controller + service forward the window to runMyThings", async () => {
    const src = allSrc(await generateSystemFiles(system("java")));
    expect(src).toContain('@GetMapping("/my_things")');
    expect(src).toContain("@RequestParam(required = false)");
    expect(src).toContain("return service.myThings(o, offset, limit);");
    expect(src).toContain("repository.runMyThings(o, offset, limit)");
    expect(src).not.toMatch(/List<Thing> myThings\(String o\);/);
  });

  it("elixir: the controller validates the window and calls the retrieval module", async () => {
    const files = await generateSystemFiles(system("elixir"));
    const src = allSrc(files);
    expect(src).toContain('get "/things/my_things", ThingController, :my_things');
    expect(src).toContain('{:ok, offset_arg} <- window_param(params, "offset", 0, 499999500)');
    expect(src).toContain(
      'C.run_my_things_thing(params["o"], limit: limit_arg, offset: offset_arg)',
    );
    expect(src).toContain("defp window_param(params, key, min, max) do");
    // The OpenAPI document publishes the same window.
    expect(src).toContain(
      "%OpenApiSpex.Parameter{name: :offset, in: :query, required: false, schema: %OpenApiSpex.Schema{type: :integer, minimum: 0, maximum: 499999500}}",
    );
    // No duplicate repository find.
    expect(src).not.toContain("defdelegate my_things_thing(");
  });
});

describe("retrieval route — `requires` gates it with a 403 before the read", () => {
  it("node", async () => {
    const route = srcOf(await generateSystemFiles(system("node", GATE)), (p) =>
      p.endsWith("http/thing.routes.ts"),
    );
    expect(route).toMatch(
      /throw new ForbiddenError\("Forbidden: find myThings"\);\n\s+const result = await repo\.runMyThings/,
    );
  });
  it("dotnet", async () => {
    const src = allSrc(await generateSystemFiles(system("dotnet", GATE)));
    expect(src).toMatch(
      /throw new ForbiddenException\("Forbidden: find myThings"\);\n\s+var domain = await _repo\.RunMyThingsAsync/,
    );
  });
  it("python", async () => {
    const src = allSrc(await generateSystemFiles(system("python", GATE)));
    expect(src).toMatch(
      /raise ForbiddenError\("Forbidden: find myThings"\)\n\s+repo = _repo\(session\)\n\s+return \[repo\.to_wire\(r\) for r in await repo\.run_my_things/,
    );
  });
  it("java", async () => {
    const src = allSrc(await generateSystemFiles(system("java", GATE)));
    expect(src).toMatch(
      /throw new ForbiddenException\("Forbidden: find myThings"\);\n\s+return service\.myThings\(o, offset, limit\);/,
    );
  });
  it("elixir", async () => {
    const src = allSrc(await generateSystemFiles(system("elixir", GATE)));
    expect(src).toContain('"Forbidden: find myThings"');
    expect(src).toMatch(/if not \(.*\) do[\s\S]*?else\n\s+with \{:ok, offset_arg\}/);
  });
});

describe("retrieval route — reaches the generated frontend", () => {
  it("react: the client hook and the scaffold list filter bar", async () => {
    const files = await generateSystemFiles(
      system(
        "node",
        "",
        `ui Front with scaffold(subdomains: [S]) { }
    deployable web { platform: react, targets: api, ui: Front, port: 3001, design: mantine }`,
      ),
    );
    const client = srcOf(files, (p) => p.endsWith("src/api/thing.ts"));
    expect(client).toContain("export function useMyThingsThing(query: MyThingsQuery)");
    expect(client).toContain("api.get(`/things/my_things");
    const list = srcOf(files, (p) => p.endsWith("pages/things/list.tsx"));
    expect(list).toContain("useMyThingsThing({ o: myThingsO })");
  });
});
