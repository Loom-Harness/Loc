// Four .NET emissions that `dotnet build /warnaserror` rejected on a model that
// generates and validates clean, on both persistence adapters:
//
//   - a context `test` under `persistence: dapper` emitted an EF-only
//     integration class (`using Microsoft.EntityFrameworkCore`, CS0234 — the
//     Dapper API project references no EF Core);
//   - a collection `count()` rendered LINQ `Count()` over a `List<T>` /
//     `IReadOnlyList<T>` (CA1829), and a domain service's single-result
//     criterion `find` took `FirstOrDefault()` over the run method's
//     `IReadOnlyList<T>` (CA1826);
//   - `aggregate Module` names a Visual Basic keyword (CA1716);
//   - a read param spelled `cancellationToken` / `bypass` duplicated the
//     repository method's own trailing parameter (CS0100).
//
// Verified end-to-end: the SRC model builds 0-warning under `/warnaserror`
// (.NET 10) on EF Core and Dapper, and its emitted xUnit project (one domain
// test + one context integration test) passes against a real Postgres on both.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = (platform: string) => `
system Repro {
  subdomain Sales {
    context Shop {
      aggregate Item with crudish {
        name: string
        tags: string[]
        derived tagCount: int = tags.count()
        contains parts: Part[]
        entity Part { sku: string  qty: int }
        derived partCount: int = parts.count()
        invariant tags.count() <= 20
        operation retag(ts: string[]) {
          precondition ts.count() < 5
          tags := ts
        }
      }
      aggregate Module with crudish {
        title: string
      }
      criterion FewTags of Item = this.tags.count() < 10
      criterion NameIs(n: string) of Item = name == n
      criterion Tok(cancellationToken: string, bypass: string) of Item = name == cancellationToken || name == bypass
      retrieval ByToken(cancellationToken: string) of Item { where: NameIs(cancellationToken) }
      repository Items for Item {
        find byToken(cancellationToken: string): Item[] where this.name == cancellationToken
        find byName(name: string): Item[] where this.name == name
      }
      repository Modules for Module { }
      domainService Lookup {
        operation anyTok(a: string): bool {
          return Items.find(Tok(a, a)) != null
        }
      }
      event ItemNamed { itemRef: Item id, at: datetime }
      workflow Follow {
        itemId: Item id
        create(p: ItemNamed) by p.itemRef {
          let xs = Items.run(ByToken("a"))
          for x in xs { }
          let ys = Items.findAll(Tok("b", "c")) ignoring *
          for y in ys { }
          if let it = Items.find(Tok("d", "e")) { } else { }
        }
      }
      test "persists and reads back an item" {
        let i = Item.create({ name: "abc", tags: [] })
        let found = Item.findById(i.id)
        expect(found.name).toBe("abc")
      }
    }
  }
  api A from Sales
  storage pg { type: postgres }
  resource st { for: Shop, kind: state, use: pg }
  deployable api { platform: ${platform}  contexts: [Shop]  dataSources: [st]  serves: A  port: 8080 }
}
`;

const ADAPTERS = [
  ["efcore", "dotnet"],
  ["dapper", "dotnet { persistence: dapper }"],
] as const;

const cache = new Map<string, Map<string, string>>();
async function file(platform: string, suffix: string): Promise<string> {
  let f = cache.get(platform);
  if (!f) {
    f = await generateSystemFiles(SRC(platform));
    cache.set(platform, f);
  }
  const key = [...f.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return f.get(key!)!;
}

describe.each(ADAPTERS)("%s: .NET residual /warnaserror failures", (adapter, platform) => {
  it("the context integration test boots the deployable's own persistence adapter", async () => {
    const t = await file(platform, "Tests/Api.Tests/ShopIntegrationTests.cs");
    if (adapter === "dapper") {
      expect(t).not.toContain("EntityFrameworkCore");
      expect(t).not.toContain("AppDbContext");
      expect(t).toContain("using Npgsql;");
      expect(t).toContain("await using var db = NpgsqlDataSource.Create(ConnString());");
      expect(t).toContain("await DbSchema.EnsureAsync(db);");
      expect(t).toContain("var itemRepo = new ItemRepository(db, events);");
    } else {
      expect(t).toContain("using Microsoft.EntityFrameworkCore;");
      expect(t).toContain("await db.Database.MigrateAsync();");
      expect(t).toContain(
        "var itemRepo = new ItemRepository(db, events, NullLogger<ItemRepository>.Instance);",
      );
    }
  });

  it("count() reads the Count property in every position (CA1829)", async () => {
    const item = await file(platform, "Domain/Items/Item.cs");
    expect(item).toContain("public int TagCount => (this.Tags).Count;");
    expect(item).toContain("public int PartCount => (this.Parts).Count;");
    expect(item).toMatch(/\(this\.Tags\)\.Count <= 20/);
    expect(item).toMatch(/\(ts\)\.Count < 5/);
    const crit = await file(platform, "Domain/Criteria/FewTagsCriterion.cs");
    expect(crit).toMatch(/\.Tags\)\.Count < 10/);
    const validator = await file(platform, "Application/Items/Commands/RetagCommandValidator.cs");
    expect(validator).toContain("(x.Ts).Count < 5");
    for (const src of [item, crit, validator]) expect(src).not.toMatch(/\bCount\(\)/);
  });

  it("a domain service's single-result criterion find reads the first row by list pattern (CA1826)", async () => {
    const svc = await file(platform, "Domain/Services/Lookup.cs");
    expect(svc).toContain("switch { [var __first, ..] => __first, _ => null }) != null;");
    expect(svc).not.toContain("FirstOrDefault()");
  });

  it("aggregate Module: CA1716 is in the API project's NoWarn", async () => {
    const csproj = await file(platform, "api/Api.csproj");
    expect(csproj).toMatch(/<NoWarn>[^<]*\bCA1716\b[^<]*<\/NoWarn>/);
    expect(await file(platform, "Domain/Modules/Module.cs")).toContain("class Module");
  });

  it("a read param named cancellationToken / bypass keeps its name; the method's own param yields", async () => {
    const port = await file(platform, "Domain/Items/IItemRepository.cs");
    expect(port).toContain(
      "ByToken(string cancellationToken, CancellationToken __cancellationToken = default);",
    );
    expect(port).toContain(
      "RunByTokenAsync(string cancellationToken, (int? offset, int? limit)? page = null, FilterBypass bypass = default, CancellationToken __cancellationToken = default);",
    );
    expect(port).toContain(
      "RunFindAllByTokAsync(string cancellationToken, string bypass, (int? offset, int? limit)? page = null, FilterBypass __bypass = default, CancellationToken __cancellationToken = default);",
    );
    // A read whose params miss the plumbing names is unchanged.
    expect(port).toContain("ByName(string name, CancellationToken cancellationToken = default);");

    const impl = await file(platform, "Infrastructure/Repositories/ItemRepository.cs");
    expect(impl).toContain(
      "ByToken(string cancellationToken, CancellationToken __cancellationToken = default)",
    );
    // Every plumbing use inside the renamed method reads the yielded name.
    const body = (sig: string): string => {
      const at = impl.indexOf(sig);
      expect(at, sig).toBeGreaterThan(-1);
      return impl.slice(at, impl.indexOf("\n    }\n", at));
    };
    const byToken = body("ByToken(string cancellationToken, CancellationToken __cancellationToken");
    expect(byToken).toMatch(/\(__cancellationToken\)|cancellationToken: __cancellationToken/);
    const tok = body("RunFindAllByTokAsync(string cancellationToken, string bypass,");
    expect(tok).toMatch(/\(__cancellationToken\)|cancellationToken: __cancellationToken/);
    if (adapter === "efcore") {
      expect(tok).toContain("if (__bypass.All)");
      expect(tok).toContain(".ApplyPaging(page).ToListAsync(__cancellationToken)");
    }

    const wf = await file(platform, "Application/Workflows/FollowStartItemNamedHandler.cs");
    expect(wf).toContain('RunByTokenAsync("a", __cancellationToken: cancellationToken)');
    expect(wf).toContain(
      'RunFindAllByTokAsync("b", "c", __bypass: FilterBypass.BypassAll(), __cancellationToken: cancellationToken)',
    );
    expect(wf).toContain(
      'RunFindAllByTokAsync("d", "e", (null, 1), __cancellationToken: cancellationToken)',
    );
    const svc = await file(platform, "Domain/Services/Lookup.cs");
    expect(svc).toContain("RunFindAllByTokAsync(a, a, __cancellationToken: cancellationToken)");
  });
});
