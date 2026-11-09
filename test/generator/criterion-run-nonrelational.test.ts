// A criterion read (`Repo.all(C(…))` / `Repo.find(C(…))`) calls the
// repository's retrieval runner whatever the aggregate's saving shape, so every
// shape's repository must define it.  The relational repository runs it as a
// query; the document blob and the event-sourced fold have no queryable state
// columns and answer it in memory; the embedded root keeps real columns.
//
// One system reaches every non-relational arm — `shape: document` (with a
// capability filter, so the in-memory runner re-applies it), `shape: embedded`
// and `persistedAs: eventLog` — on python, .NET (EF Core and Dapper) and
// elixir.  Each case asserts the handler's call AND the method it names.
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const src = (platform: string) => `
system Shelf {
  subdomain S {
    context Store {
      aggregate Doc shape: document with crudish(updateOnly: true), softDeletable, softDelete {
        label: string
      }
      aggregate Emb shape: embedded with crudish {
        label: string
        contains lines: Line[]
        entity Line { sku: string }
      }
      repository Docs for Doc { }
      repository Embs for Emb { }
      criterion DocsByLabel(l: string) of Doc = this.label == l
      criterion EmbsByLabel(l: string) of Emb = this.label == l
      queryHandler ListDocs(l: string): Doc[] {
        let r = Docs.all(DocsByLabel(l))
        return r
      }
      queryHandler ListEmbs(l: string): Emb[] {
        let r = Embs.all(EmbsByLabel(l))
        return r
      }
    }
    context Ledger {
      event Opened { entry: Entry id, label: string }
      aggregate Entry persistedAs: eventLog {
        label: string
        create open(label: string) { emit Opened { entry: id, label: label } }
        apply(e: Opened) { label := e.label }
      }
      repository Entries for Entry { }
      criterion EntriesByLabel(l: string) of Entry = this.label == l
      queryHandler ListEntries(l: string): Entry[] {
        let r = Entries.all(EntriesByLabel(l))
        return r
      }
    }
  }
  api ShelfApi from S
  storage pg { type: postgres }
  resource st { for: Store, kind: state, use: pg }
  resource ev { for: Ledger, kind: eventLog, use: pg }
  deployable d { platform: ${platform} contexts: [Store, Ledger] dataSources: [st, ev] serves: ShelfApi port: 4000 }
}
`;

function fileEndingWith(m: Map<string, string>, suffix: string): string {
  const key = [...m.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return m.get(key!)!;
}

const AGGS = [
  { agg: "Doc", crit: "DocsByLabel", handler: "ListDocs" },
  { agg: "Emb", crit: "EmbsByLabel", handler: "ListEmbs" },
  { agg: "Entry", crit: "EntriesByLabel", handler: "ListEntries" },
] as const;

const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

describe("criterion reads on document, embedded and event-log repositories", () => {
  it("python: every shape's repository defines the run the handler calls", async () => {
    const files = await generateSystemFiles(src("python"));
    for (const { agg, crit, handler } of AGGS) {
      const run = `run_find_all_by_${snake(crit)}`;
      expect(fileEndingWith(files, `/application/${snake(handler)}.py`)).toContain(`.${run}(l)`);
      expect(fileEndingWith(files, `/db/repositories/${snake(agg)}_repository.py`)).toContain(
        `    async def ${run}(self, l: str, offset: int | None = None, limit: int | None = None)`,
      );
    }
    // The document runner re-applies the capability filter beside the criterion.
    expect(fileEndingWith(files, "/db/repositories/doc_repository.py")).toContain(
      "result = [x for x in items if ((not x.is_deleted)) and (x.label == l)]",
    );
  });

  for (const persistence of ["efcore", "dapper"] as const) {
    it(`.NET (${persistence}): the port declares the run and every shape's repository defines it`, async () => {
      const platform = persistence === "dapper" ? "dotnet { persistence: dapper }" : "dotnet";
      const files = await generateSystemFiles(src(platform));
      for (const { agg, crit } of AGGS) {
        const run = `RunFindAllBy${crit}Async`;
        expect(fileEndingWith(files, `/I${agg}Repository.cs`)).toContain(
          `Task<IReadOnlyList<${agg}>> ${run}(string l,`,
        );
        expect(fileEndingWith(files, `/Repositories/${agg}Repository.cs`)).toContain(
          `public async Task<IReadOnlyList<${agg}>> ${run}(string l,`,
        );
      }
      // The document runner keeps the capability restriction unless the call
      // site's bypass names it.
      expect(fileEndingWith(files, "/Repositories/DocRepository.cs")).toContain(
        '__all.Where(x => (bypass.All || (bypass.Capabilities?.Contains("softDeletable") ?? false) || (!x.IsDeleted)) && (x.Label == l))',
      );
    });
  }

  it("elixir: every shape gets a retrieval module behind the context delegate", async () => {
    // Elixir refuses `shape: document` with `softDeletable` (loom.target-unsupported),
    // so its leg reads the document aggregate without the capability.
    const files = await generateSystemFiles(
      src("elixir").replace(", softDeletable, softDelete {", " {"),
    );
    for (const { agg, crit } of AGGS) {
      const ret = `find_all_by_${snake(crit)}`;
      const ctx = agg === "Entry" ? "ledger" : "store";
      expect(fileEndingWith(files, `/lib/d/${ctx}.ex`)).toContain(
        `defdelegate run_${ret}_${snake(agg)}(l, opts \\\\ [])`,
      );
      expect(fileEndingWith(files, `/${ctx}/retrievals/${ret}.ex`)).toContain("def run(l, opts");
    }
    const entries = fileEndingWith(files, "/ledger/retrievals/find_all_by_entries_by_label.ex");
    expect(entries).toContain("{:ok, all} = D.Ledger.EntryRepository.list()");
    expect(entries).toContain("rows = Enum.filter(all, fn a -> a.label == l end)");
  });
});
