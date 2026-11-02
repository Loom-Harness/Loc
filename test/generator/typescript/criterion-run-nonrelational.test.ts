// A criterion read (`Repo.all(C(…))` / `Repo.find(C(…))`) calls the
// repository's `run<Retrieval>` whatever the aggregate's saving shape, so every
// node repository must define it — on BOTH persistence adapters.  The
// relational repository runs it as SQL; the document blob and the event-log
// fold have no queryable state columns and answer it in memory; the embedded
// root keeps real columns, so its runner is the SQL query with a per-row
// hydrate.
//
// One routed system reaches every non-relational arm — `shape: document` (with
// a capability filter, so the in-memory runner re-applies it, plus a sorted
// retrieval and an `ignoring` call site), `shape: embedded` and
// `persistedAs: eventLog` — on drizzle and on MikroORM.  Each case asserts the
// handler's call AND the method it names; the runner's in-memory semantics are
// then EXECUTED over fabricated rows.
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const src = (platform: string) => `
system Shelf {
  capability hideable { hidden: bool  filter this.hidden == false }
  subdomain S {
    context Store {
      aggregate Doc shape: document with crudish, hideable {
        label: string
        rank: int
      }
      aggregate Emb shape: embedded with crudish {
        label: string
        contains lines: Line[]
        entity Line { sku: string }
      }
      repository Docs for Doc { }
      repository Embs for Emb { }
      criterion DocsByLabel(l: string) of Doc = this.label == l
      criterion DocsAny(l: string) of Doc = this.label != l
      retrieval Ranked(l: string) of Doc { where: DocsByLabel(l) sort: [rank desc] }
      criterion EmbsByLabel(l: string) of Emb = this.label == l
      queryHandler ListDocs(l: string): Doc[] {
        let r = Docs.all(DocsByLabel(l))
        return r
      }
      queryHandler RankedDocs(l: string): Doc[] {
        let r = Docs.all(Ranked(l))
        return r
      }
      queryHandler AllDocs(l: string): Doc[] {
        let r = Docs.all(DocsAny(l)) ignoring hideable
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
  api ShelfApi from S {
    route GET "/docs/by-label" -> Store.ListDocs
    route GET "/docs/ranked" -> Store.RankedDocs
    route GET "/docs/all" -> Store.AllDocs
    route GET "/embs/by-label" -> Store.ListEmbs
    route GET "/entries/by-label" -> Ledger.ListEntries
  }
  storage pg { type: postgres }
  resource st { for: Store, kind: state, use: pg }
  resource ev { for: Ledger, kind: eventLog, use: pg }
  deployable d { platform: ${platform} contexts: [Store, Ledger] dataSources: [st, ev] serves: ShelfApi port: 4000 }
}
`;

const ADAPTERS = [
  ["drizzle", "node"],
  ["mikroorm", "node { persistence: mikroorm }"],
] as const;

function fileEndingWith(m: Map<string, string>, suffix: string): string {
  const key = [...m.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return m.get(key!)!;
}

/** One `async <name>(` method of a repository class, up to the next one. */
function methodBody(file: string, name: string): string {
  const start = file.indexOf(`  async ${name}(`);
  expect(start, `method ${name} not emitted`).toBeGreaterThanOrEqual(0);
  return file.slice(start, file.indexOf("\n  }\n", start) + 4);
}

/** Every `run…` name the routes call on `<handle>.` in the emitted http layer. */
function calledRuns(files: Map<string, string>, handle: string): string[] {
  const http = [...files.entries()]
    .filter(([k]) => /\/http\/.*\.ts$/.test(k))
    .map(([, v]) => v)
    .join("\n");
  return [...http.matchAll(new RegExp(`\\b${handle}\\.(run\\w+)\\(`, "g"))].map((m) => m[1]!);
}

const AGGS = [
  { agg: "Doc", handle: "docs", file: "doc-repository.ts" },
  { agg: "Emb", handle: "embs", file: "emb-repository.ts" },
  { agg: "Entry", handle: "entries", file: "entry-repository.ts" },
] as const;

describe.each(
  ADAPTERS,
)("node %s: criterion reads on non-relational repositories", (_, platform) => {
  it("every run the routes call is a method of that shape's repository", async () => {
    const files = await generateSystemFiles(src(platform));
    for (const { handle, file } of AGGS) {
      const runs = calledRuns(files, handle);
      expect(runs.length, `no run call on ${handle}`).toBeGreaterThan(0);
      const repo = fileEndingWith(files, `/db/repositories/${file}`);
      for (const run of runs) {
        expect(repo, `${file} lacks ${run}`).toContain(
          `  async ${run}(l: string, page?: { offset?: number; limit?: number }): Promise<`,
        );
      }
    }
  });

  it("the document runner re-applies the capability unless the call site ignores it", async () => {
    const files = await generateSystemFiles(src(platform));
    const repo = fileEndingWith(files, "/db/repositories/doc-repository.ts");
    expect(methodBody(repo, "runFindAllByDocsByLabel")).toContain(
      "const result = all.filter((x) => ((x.hidden === false)) && (x.label === l));",
    );
    // `Docs.all(DocsAny(l)) ignoring hideable` — the bypassed conjunct is gone,
    // the criterion stays.
    const anyBody = methodBody(repo, "runFindAllByDocsAny");
    expect(anyBody).toContain("const result = all.filter((x) => (x.label !== l));");
    expect(anyBody).not.toContain("hidden");
  });

  it("the embedded runner is the SQL query, hydrated per row", async () => {
    const files = await generateSystemFiles(src(platform));
    const body = methodBody(
      fileEndingWith(files, "/db/repositories/emb-repository.ts"),
      "runFindAllByEmbsByLabel",
    );
    expect(body).toMatch(/limit/);
    expect(body).toContain("lineFromDoc(");
    expect(body).not.toContain(".filter((x) =>");
  });

  it("the event-log runner filters the folded streams", async () => {
    const files = await generateSystemFiles(src(platform));
    const body = methodBody(
      fileEndingWith(files, "/db/repositories/entry-repository.ts"),
      "runFindAllByEntriesByLabel",
    );
    expect(body).toContain("const all = await this._loadAll();");
    expect(body).toContain("const result = all.filter((x) => (x.label === l));");
  });

  // Execute the document runner's tail over fabricated rows: capability, then
  // criterion, then the `sort:` term (desc, ties keep the id-ordered load),
  // then the call-site page.
  it("filters, sorts and pages in memory (executed)", async () => {
    const files = await generateSystemFiles(src(platform));
    const repo = fileEndingWith(files, "/db/repositories/doc-repository.ts");
    const ranked = "runRanked";
    const body = methodBody(repo, ranked);
    const lines = body.split("\n");
    const from = lines.findIndex((l) => l.includes("const result = all.filter"));
    const to = lines.findIndex((l) => l.includes("requestLog()"));
    expect(from).toBeGreaterThan(0);
    const tail = lines.slice(from, to).join("\n");
    type Row = { id: string; label: string; rank: number; hidden: boolean };
    const run = new Function("all", "l", "page", `${tail}\nreturn paged;`) as (
      all: Row[],
      l: string,
      page?: { offset?: number; limit?: number },
    ) => Row[];
    const rows: Row[] = [
      { id: "1", label: "a", rank: 1, hidden: false },
      { id: "2", label: "a", rank: 5, hidden: false },
      { id: "3", label: "a", rank: 9, hidden: true },
      { id: "4", label: "b", rank: 7, hidden: false },
      { id: "5", label: "a", rank: 5, hidden: false },
    ];
    expect(run(rows, "a").map((r) => r.id)).toEqual(["2", "5", "1"]);
    expect(run(rows, "a", { offset: 1, limit: 1 }).map((r) => r.id)).toEqual(["5"]);
    expect(run(rows, "a", { limit: 0 })).toEqual([]);
  });
});
