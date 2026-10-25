// M-T6.90 — on .NET EF, two `getById` loads of one row inside a workflow are two
// independent handles, each carrying the version it read.
//
// EF's identity map handed a second `FirstOrDefaultAsync` of a tracked row the
// SAME instance, so a stale second handle could never conflict.  The fix: a
// relational `GetByIdAsync` of a row the scoped context already tracks loads
// into a FORK (`AppDbContext.Fork()` — a sibling context on the same connection
// and transaction), and `SaveAsync` / `DeleteAsync` write a handle through the
// context that tracks it (`TrackerOf` + `SaveChangesWithAsync`).
//
// The runtime gates are the behavioural corpus cases
// `transactional-workflow-event-rollback` and `workflow-two-handles-containment`
// on the `run-dotnet.mjs` leg (pre-fix: `expected the call to reject, but it
// resolved`).  This file pins the emitted SHAPE they rest on, which no compile
// gate sees — dropping the fork compiles fine and silently re-aliases the
// handles.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const source = (extra: string): string => `system R {
  subdomain S { context C {
    aggregate Cart with crudish {
      name: string
      contains lines: Line[]
      entity Line { sku: string  qty: int }
      operation addLine(sku: string, qty: int) { lines += Line { sku: sku, qty: qty } }
    }
    repository Carts for Cart { }
    workflow addTwice transactional {
      create(c: Cart id) {
        let first = Carts.getById(c)
        let second = Carts.getById(c)
        first.addLine("A", 1)
        second.addLine("B", 1)
      }
    }
  } }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable api { platform: dotnet${extra}, contexts: [C], dataSources: [st], port: 3000 }
}`;

const file = (files: Map<string, string>, suffix: string): string => {
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix));
  expect(hit, `no ${suffix} emitted`).toBeDefined();
  return hit![1];
};

/** The body of one C# method, from its signature to the next member. */
const method = (src: string, signature: string): string => {
  const start = src.indexOf(signature);
  expect(start, `no ${signature}`).toBeGreaterThan(-1);
  const next = src.indexOf("\n    public ", start + signature.length);
  return src.slice(start, next === -1 ? undefined : next);
};

describe("M-T6.90 — EF loads a second handle of a tracked row into a fork", () => {
  it("GetByIdAsync forks when the row is already tracked, and reads through the chosen context", async () => {
    const files = await generateSystemFiles(source(""));
    const repo = file(files, "Infrastructure/Repositories/CartRepository.cs");
    const get = method(repo, "public async Task<Cart?> GetByIdAsync(");
    expect(get).toContain("var __db = _db.Carts.Local.Any(x => x.Id == id) ? _db.Fork() : _db;");
    expect(get).toContain(
      "var found = await __db.Carts.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);",
    );
  });

  it("SaveAsync / DeleteAsync write the handle through the context that tracks it", async () => {
    const files = await generateSystemFiles(source(""));
    const repo = file(files, "Infrastructure/Repositories/CartRepository.cs");
    const save = method(repo, "public async Task SaveAsync(");
    expect(save).toContain("var __db = _db.TrackerOf(aggregate);");
    expect(save).toContain("var entry = __db.Entry(aggregate);");
    expect(save).toContain("await _db.SaveChangesWithAsync(__db, cancellationToken);");
    expect(save).not.toMatch(/await _db\.SaveChangesAsync\(/);
    const del = method(repo, "public async Task DeleteAsync(");
    expect(del).toContain("__db.Carts.Remove(aggregate);");
    expect(del).toContain("await _db.SaveChangesWithAsync(__db, cancellationToken);");
  });

  it("AppDbContext forks on its own connection + transaction and commits a fork with its staged rows atomically", async () => {
    const files = await generateSystemFiles(source(""));
    const ctx = file(files, "Infrastructure/Persistence/AppDbContext.cs");
    const fork = method(ctx, "public AppDbContext Fork()");
    expect(fork).toContain("fork.Database.SetDbConnection(Database.GetDbConnection());");
    expect(fork).toContain("fork.Database.UseTransaction(");
    expect(ctx).toContain("public AppDbContext TrackerOf(object entity)");
    const saveWith = method(ctx, "public async Task SaveChangesWithAsync(");
    expect(saveWith).toContain("await tracker.SaveChangesAsync(cancellationToken);");
    expect(saveWith).toContain("await SaveChangesAsync(cancellationToken);");
    expect(saveWith).toContain("BeginTransactionAsync(cancellationToken)");
    // The forks are disposed with the scoped context.
    expect(ctx).toContain("public override void Dispose()");
    expect(ctx).toContain("public override async ValueTask DisposeAsync()");
  });

  it("the fork is constructed with the context's own ctor shape (tenancy accessor threaded)", async () => {
    const files = await generateSystemFiles(
      readFileSync("test/fixtures/corpus/tenancy-owned.ddd", "utf8").replace(
        "__PLATFORM__",
        "dotnet",
      ),
    );
    const ctx = file(files, "Infrastructure/Persistence/AppDbContext.cs");
    expect(ctx).toContain("ICurrentUserAccessor currentUser) : base(options)");
    expect(ctx).toContain("var fork = new AppDbContext(__options, _currentUser);");
  });

  it("qualifies a BCL name only when the domain declares it (aggregate `Task`)", async () => {
    const files = await generateSystemFiles(`system R {
  subdomain S { context C {
    aggregate Task { title: string }
    repository Tasks for Task { }
  } }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable api { platform: dotnet, contexts: [C], dataSources: [st], port: 3000 }
}`);
    const ctx = file(files, "Infrastructure/Persistence/AppDbContext.cs");
    expect(ctx).toContain("public async global::System.Threading.Tasks.Task SaveChangesWithAsync(");
    expect(ctx).toContain("public override async ValueTask DisposeAsync()");
  });

  it("the Dapper adapter is untouched (no change tracker, no fork)", async () => {
    const files = await generateSystemFiles(source(" { persistence: dapper }"));
    const repo = file(files, "Infrastructure/Repositories/CartRepository.cs");
    expect(repo).not.toContain("Fork()");
    expect(repo).not.toContain("TrackerOf(");
  });
});
