// A parameterised query-time `projection` must BIND its parameters on every
// backend — the read is `where <Criterion>(<param>)`, and inlining the criterion
// substitutes the PROJECTION's parameter into the predicate.
//
// It did not.  Every backend's projection-find synthesiser hard-coded
// `params: []`, on the strength of a comment claiming "a parameterised
// projection's `where` still lowers criterion params away at compile time".  The
// emitted read then named a variable nothing bound:
//
//   node    `async myThings(): Promise<Thing[]>`  … `where(eq(schema.things.owner, o))`
//                                                  → TS2304: Cannot find name 'o'
//   .NET    `MyThings(CancellationToken …)`       … `.Where(x => x.Owner == o)`
//   python  `async def my_things(self)`           … `.where(ThingRow.owner == o)`
//   java    `List<Thing> myThings();`             … `@Query("… = :o")` with no `@Param`
//                                                  → compiles, fails at Spring context startup
//   elixir  `def run(current_user \\ nil)`        … `where: record.owner == ^o`
//
// A model that VALIDATES CLEAN (`0 error(s), 0 warning(s)`) produced a project
// that does not build.  The route half was equally wrong: it declared no query
// parameter and called the read with no arguments, so even the one shape that
// compiled — an UNUSED parameter — answered an unfiltered read.
//
// So this pins BOTH halves on all five: the read binds the parameter, and the
// HTTP surface accepts it and passes it down.
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const system = (platform: string) => `
  system P {
    subdomain S {
      context C {
        aggregate Thing {
          name: string
          owner: string
        }
        criterion OwnedBy(o: string) of Thing = owner == o
        projection MyThings(o: string) {
          thingId: Thing id
          name: string
          from Thing as t
          where OwnedBy(o)
          select thingId = t.id, name = t.name
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
    }
  }
`;

const srcOf = (files: Map<string, string>, pred: (p: string) => boolean): string =>
  [...files.entries()]
    .filter(([p]) => pred(p))
    .map(([, c]) => c)
    .join("\n");

/** Every file of the generated backend, concatenated — the "is this name bound
 *  anywhere" corpus.  A per-file assertion would pass while the SIBLING layer
 *  (route, controller, handler) still dropped the parameter, which is exactly
 *  how the defect survived: the JPA interface was right and the service was not. */
const allSrc = (files: Map<string, string>): string => srcOf(files, () => true);

describe("parameterised query-time projection — the parameter is threaded", () => {
  it("node: the synthesised read takes it and the route binds it from the query string", async () => {
    const files = await generateSystemFiles(system("node"));
    const repo = srcOf(files, (p) => p.endsWith("thing-repository.ts"));
    // The read BINDS `o` — this is the assertion that fails with `params: []`.
    expect(repo).toMatch(/async myThings\(\s*o: string/);
    const route = srcOf(files, (p) => p.endsWith("query-projections.ts"));
    expect(route).toContain("const MyThingsQuery = z.object({");
    expect(route).toContain("request: { query: MyThingsQuery },");
    expect(route).toContain('const params = httpCtx.req.valid("query");');
    expect(route).toContain("repo.myThings(params.o)");
  });

  it("dotnet: the query record, handler and controller each carry it", async () => {
    const files = await generateSystemFiles(system("dotnet"));
    const src = allSrc(files);
    expect(src).toMatch(/Task<List<Thing>> MyThings\(string o,/);
    expect(src).toContain("record MyThingsQpQuery(string o)");
    expect(src).toContain("_repo.MyThings(query.o, cancellationToken)");
    expect(src).toContain("MyThings([FromQuery] string o)");
    expect(src).toContain("new MyThingsQpQuery(o)");
  });

  it("python: the repository method and the FastAPI route both take it", async () => {
    const files = await generateSystemFiles(system("python"));
    const src = allSrc(files);
    expect(src).toMatch(/async def my_things\(self, o: str\)/);
    expect(src).toMatch(/async def my_things_projection\(o: \w+,/);
    expect(src).toContain("await repo.my_things(o)");
  });

  it("java: the JPQL binds @Param and the service + controller forward it", async () => {
    const files = await generateSystemFiles(system("java"));
    const src = allSrc(files);
    // `@Query("… = :o")` with no `@Param("o")` is the shape that starts up dead.
    expect(src).toContain('List<Thing> myThings(@Param("o") String o);');
    expect(src).toContain("public List<MyThingsRow> myThings(String o) {");
    expect(src).toContain("myThings(@RequestParam String o)");
    expect(src).toContain("queryProjections.myThings(o)");
  });

  it("elixir: run/N binds it ahead of the trailing current_user default", async () => {
    const files = await generateSystemFiles(system("elixir"));
    const src = allSrc(files);
    expect(src).toContain("def run(o, current_user \\\\ nil) do");
    expect(src).toContain("@spec run(any(), any()) :: [map()]");
    expect(src).toContain('MyThings.run(params["o"], current_user)');
  });
});
