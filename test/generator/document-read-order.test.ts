import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

// ---------------------------------------------------------------------------
// A `shape: document` aggregate's WHOLE-TABLE read is ordered by id — on every
// backend AND every persistence adapter.
//
// Without an `ORDER BY`, Postgres answers a seq scan in HEAP order, and an
// `update` rewrites the tuple: a row MOVES after an unrelated write.  Two reads
// of the same table then disagree across backends, which is what the
// `projection-document-aggregation` wire golden caught.
//
// THE GATE THAT WAS MISSING.  The fix that first ordered these reads pinned
// itself with ONE re-pin, on ONE adapter (mikroorm).  It therefore could not see
// that it had reached only:
//
//   - one of .NET's TWO persistence adapters — EF got `OrderBy(__d => __d.Id)`,
//     dapper kept `SELECT id, data, version FROM <t>` with no `ORDER BY`; and
//   - only the REPOSITORY read path — elixir's query-projection emitter
//     re-implements the source read as `Repo.all(<Mod>)` rather than riding the
//     repository, so the ordering never reached it.
//
// Both holes were found by a golden two weeks later, on two CI legs, not by a
// generation gate.  This is that gate: every backend/adapter pair, asserted at
// emission, so the NEXT adapter to miss it fails here instead.  The dapper hole
// is FIXED here; the elixir one needs a second, larger change (see the note on
// v4 ids further down) and is not in this PR.
//
// SIX OF THE SEVEN route the per-row query projection through the aggregate's
// repository method (`repo.thing_titles()`, `thingsRepository.thingTitles()`,
// `_repo.ThingTitles(...)`), so ordering the repository read orders the
// projection too.  Elixir is the one that does not, and so is asserted twice.
// ---------------------------------------------------------------------------

const SOURCE = `
system DocReadOrder {
  subdomain C {
    context C {
      aggregate Thing shape: document, with crudish {
        title: string
      }
      repository Things for Thing { }

      // The per-row arm over the document source: one row out per source row,
      // so the projection's row order IS the source read's order.
      projection ThingTitles {
        heading: string
        from Thing as a
        select heading = a.title
      }
    }
  }
  api A from C
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable d {
    platform: __PLATFORM__
    contexts: [C]
    dataSources: [st]
    serves: A
    port: 4000
  }
}
`;

const sourceFor = (platform: string): string => SOURCE.replace("__PLATFORM__", platform);

const fileEndingWith = (files: Map<string, string>, suffix: string): string => {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(key, `no emitted file ends with ${suffix}`).toBeDefined();
  return files.get(key as string) as string;
};

describe("document whole-table read ordering — every backend", () => {
  it("node/drizzle orders the whole-table read by id", async () => {
    const files = await generateSystemFiles(sourceFor("node"));
    const repo = fileEndingWith(files, "db/repositories/thing-repository.ts");
    expect(repo).toContain(
      "const rows = await this.db.select().from(schema.things).orderBy(schema.things.id);",
    );
    // No whole-table read left without the ordering.  A FILTERED read
    // (`.where(...)`) addresses rows rather than a position and is exempt.
    expect(repo).not.toMatch(/\.from\(schema\.things\);/);
  });

  it("node/mikroorm orders the whole-table read by id", async () => {
    const files = await generateSystemFiles(sourceFor("node { persistence: mikroorm }"));
    const repo = fileEndingWith(files, "db/repositories/thing-repository.ts");
    expect(repo).toContain('const rows = await em.find(ThingRow, {}, { orderBy: { id: "ASC" } });');
    expect(repo).not.toMatch(/em\.find\(ThingRow, \{\}\)/);
  });

  it("python/SQLAlchemy orders the whole-table read by id", async () => {
    const files = await generateSystemFiles(sourceFor("python"));
    const repo = fileEndingWith(files, "db/repositories/thing_repository.py");
    expect(repo).toContain("select(ThingRow).order_by(ThingRow.id)");
    // `select(ThingRow)` closed immediately = an unordered whole-table read.
    expect(repo).not.toMatch(/select\(ThingRow\)\)/);
  });

  it("java orders the whole-table read by id", async () => {
    const files = await generateSystemFiles(sourceFor("java"));
    const repo = fileEndingWith(files, "features/things/ThingRepositoryImpl.java");
    expect(repo).toContain('"select data from c.things order by id"');
    expect(repo).not.toMatch(/"select data from c\.things"/);
  });

  it(".NET/EF Core orders the whole-table read by id", async () => {
    const files = await generateSystemFiles(sourceFor("dotnet"));
    const repo = fileEndingWith(files, "Infrastructure/Repositories/ThingRepository.cs");
    expect(repo).toContain("_db.Things.OrderBy(__d => __d.Id).ToListAsync(cancellationToken)");
    expect(repo).not.toMatch(/_db\.Things\.ToListAsync/);
  });

  it(".NET/dapper orders the whole-table read by id — the adapter the first fix missed", async () => {
    const files = await generateSystemFiles(sourceFor("dotnet { persistence: dapper }"));
    const repo = fileEndingWith(files, "Infrastructure/Repositories/ThingRepository.cs");
    expect(repo).toContain('SELECT id, data, version FROM things ORDER BY id"');
    // Every whole-table SELECT over the document triple carries the ORDER BY.
    // A by-id or `= ANY(@ids)` read is addressed, not positional, so the
    // negative lookahead lets `… FROM things WHERE …` through.
    expect(repo).not.toMatch(/SELECT id, data, version FROM things(?! WHERE)(?! ORDER BY id)/);
  });

  // Elixir's read is ORDERED; see the long note below for why that is not yet the
  // same as deterministic on this backend.
  it("elixir orders the whole-table read by id", async () => {
    const files = await generateSystemFiles(sourceFor("elixir"));
    const repo = fileEndingWith(files, "lib/d/c/thing_repository.ex");
    expect(repo).toContain("Repo.all(Ecto.Query.order_by(D.C.Thing, [r], r.id))");
    // `order_by` is a MACRO, so a fully-qualified call needs the `require`.
    // Without it the module does not compile: the `[r]` never becomes a query
    // binding and Elixir reports `undefined variable "r"`.
    expect(repo).toContain("require Ecto.Query");
  });
});

describe("document query-projection source read ordering", () => {
  // NOT PINNED HERE, and the reason is the one thing a reader of this file most
  // needs to know: on elixir `ORDER BY id` does NOT yield insertion order.
  //
  // `@primary_key {:id, :binary_id, autogenerate: true}` mints the id through
  // `Ecto.UUID.autogenerate/0`, and ecto's `@default_version` is **4** —
  // `:crypto.strong_rand_bytes(16)`, purely random.  The other four backends mint
  // time-ordered **v7** (`uuidv7` on node, `uuid6.uuid7` on python,
  // java-uuid-generator on java, `Guid.CreateVersion7` on .NET), so an id sort is
  // insertion order there and a random permutation on elixir.
  //
  // Measured, not inferred: the elixir behavioural leg ran the SAME
  // `document-emit.ts` on two commits and the ordered whole-table read answered
  // two different orders — matching the golden on one and not the other.  So the
  // elixir repository read below is ORDERED but not yet DETERMINISTIC relative to
  // insertion, and elixir's query projection (which re-implements the source read
  // instead of riding that repository) needs both halves — the ordering AND v7
  // ids — before it can agree with a node-captured golden.  Ecto 3.14 supports
  // v7 via `Ecto.UUID.generate(version: 7)`; wiring it is a change to every
  // elixir schema's primary key and is deliberately NOT in this PR.

  // Six of the seven reach the projection through the aggregate's repository
  // METHOD, so the ordered whole-table read asserted above serves the projection
  // too.  Each row pins both halves of that claim: the repository DECLARES the
  // projection's read method, and the caller CALLS it rather than issuing its own
  // table read.  Together with the negative assertions above — no unordered
  // whole-table read is left anywhere in that repository file — that is what
  // makes "the projection is ordered" true for these five without a separate
  // ordering assertion in each.
  it.each([
    [
      "node",
      "db/repositories/thing-repository.ts",
      "async thingTitles(): Promise<Thing[]> {",
      "http/query-projections.ts",
      "await repo.thingTitles();",
    ],
    [
      "node { persistence: mikroorm }",
      "db/repositories/thing-repository.ts",
      "async thingTitles(): Promise<Thing[]> {",
      "http/query-projections.ts",
      "await repo.thingTitles();",
    ],
    [
      "python",
      "db/repositories/thing_repository.py",
      "async def thing_titles(self) -> list[Thing]:",
      "http/query_projections_routes.py",
      "await repo.thing_titles()",
    ],
    [
      "java",
      "features/things/ThingRepositoryImpl.java",
      "public List<Thing> thingTitles() {",
      "application/views/CQueryProjections.java",
      "thingsRepository.thingTitles()",
    ],
    [
      "dotnet",
      "Infrastructure/Repositories/ThingRepository.cs",
      "public async Task<List<Thing>> ThingTitles(",
      "Application/Projections/ThingTitlesQpHandler.cs",
      "await _repo.ThingTitles(cancellationToken);",
    ],
    [
      "dotnet { persistence: dapper }",
      "Infrastructure/Repositories/ThingRepository.cs",
      "public async Task<List<Thing>> ThingTitles(",
      "Application/Projections/ThingTitlesQpHandler.cs",
      "await _repo.ThingTitles(cancellationToken);",
    ],
  ])("%s reaches the projection through the repository, so the ordered read serves both", async (platform, repoSuffix, decl, callerSuffix, call) => {
    const files = await generateSystemFiles(sourceFor(platform));
    expect(fileEndingWith(files, repoSuffix)).toContain(decl);
    expect(fileEndingWith(files, callerSuffix)).toContain(call);
  });
});
