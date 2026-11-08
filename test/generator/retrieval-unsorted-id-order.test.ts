// An UNSORTED criterion read — `Reqs.find(ByUnit(code))` (the first match, read
// as the list retrieval with limit 1) and `Reqs.all(ByUnit(code))` — reads in
// `id` order on every backend.  Left to the database's physical order, two
// matching rows come back in whatever order the heap holds them, which moves
// when an update rewrites a row, so `find` answered a different row from run
// to run and from backend to backend.  The order is `readSortFor`'s: the
// declared `sort:` terms plus the `id` tie-break, or `id` alone.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const src = (platform: string) => `
system O {
  subdomain S {
    context C {
      aggregate Req with crudish { unitCode: string  note: string }
      criterion ByUnit(code: string) of Req = this.unitCode == code
      repository Reqs for Req { }
      queryHandler NoteByUnit(code: string): string {
        let r = Reqs.find(ByUnit(code))
        return r != null ? r.note : "none"
      }
      queryHandler AllByUnit(code: string): Req[] { let rs = Reqs.all(ByUnit(code)) return rs }
    }
  }
  api A from S
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d { platform: ${platform} contexts: [C] dataSources: [st] serves: A port: 4000 }
}
`;

async function fileOf(platform: string, suffix: string): Promise<string> {
  const files = await generateSystemFiles(src(platform));
  const hit = [...files.entries()].find(([k]) => k.endsWith(suffix));
  expect(hit, `${platform}: no file ending ${suffix}`).toBeDefined();
  return hit![1];
}

describe("unsorted criterion retrieval reads in id order on every backend", () => {
  it("node: drizzle orderBy(asc(id))", async () => {
    const repo = await fileOf("node", "db/repositories/req-repository.ts");
    expect(repo).toContain(
      ".where(byUnitCriterion(code)).orderBy(asc(schema.reqs.id)).$dynamic();",
    );
  });

  it("java: Sort.by(asc(id)) on both the bare and the paged run", async () => {
    const impl = await fileOf("java", "features/reqs/ReqRepositoryImpl.java");
    expect(impl).toContain('jpa.findAll(ReqCriteria.ByUnit(code), Sort.by(Sort.Order.asc("id")))');
    expect(impl).toContain(
      'new OffsetLimitPageRequest(offset, limit, Sort.by(Sort.Order.asc("id")))',
    );
    expect(impl).not.toContain("Sort.unsorted()");
  });

  it("python: order_by(ReqRow.id.asc())", async () => {
    const repo = await fileOf("python", "app/db/repositories/req_repository.py");
    expect(repo).toContain(
      "query = select(ReqRow).where((ReqRow.unit_code == code)).order_by(ReqRow.id.asc())",
    );
  });

  it("elixir: order_by(asc: record.id)", async () => {
    const mod = await fileOf("elixir", "retrievals/find_all_by_by_unit.ex");
    expect(mod).toContain("query = order_by(query, [record], [asc: record.id])");
  });

  it(".NET EF: the specification orders by Id", async () => {
    const spec = await fileOf("dotnet", "Domain/Reqs/FindAllByByUnitSpec.cs");
    expect(spec).toContain(
      "Query.Where(new ByUnitCriterion(code).ToExpression()).OrderBy(x => x.Id);",
    );
  });

  it(".NET Dapper: ORDER BY id ASC", async () => {
    const files = await generateSystemFiles(src("dotnet { persistence: dapper }"));
    const repo = [...files.entries()].find(([k]) =>
      k.endsWith("Infrastructure/Repositories/ReqRepository.cs"),
    )![1];
    expect(repo).toContain('FROM reqs WHERE (unit_code = @code) ORDER BY id ASC";');
  });
});
