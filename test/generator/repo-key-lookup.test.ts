// Natural-key reads (D-REPO-KEY-LOOKUP) on all five backends.
//
// Each backend emits ONE repository method per used (verb, tuple, `ignoring`
// stance), named from the tuple's columns, with a WHERE on exactly those
// columns; `getBy` answers the find-absence 404 on a miss, `findBy` returns
// absence.  The fixture is the compile-gate one
// (`test/e2e/fixtures/elixir-vanilla-build/key-lookup.ddd`), so what is pinned
// here is what the `LOOM_*_BUILD` legs compile.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "..", "e2e", "fixtures", "elixir-vanilla-build", "key-lookup.ddd");

let files: Map<string, string>;
beforeAll(async () => {
  files = await generateSystemFiles(fs.readFileSync(FIXTURE, "utf8"));
});

function file(suffix: string): string {
  const hit = [...files.keys()].find((k) => k.endsWith(suffix));
  if (!hit) throw new Error(`no generated file ends with ${suffix}`);
  return files.get(hit)!;
}

describe("node", () => {
  it("emits the methods, throwing on a getBy miss and honouring ignoring *", () => {
    const repo = file("node_api/db/repositories/product-repository.ts");
    const get = repo.slice(
      repo.indexOf("async getBySku("),
      repo.indexOf("async findByRegionAndName("),
    );
    expect(get).toContain("eq(schema.products.sku, sku)");
    expect(get).toContain("not(eq(schema.products.isDeleted, true))");
    expect(get).toContain('throw new AggregateNotFoundError("not_found")');
    expect(repo).toContain("async findBySku(sku: string): Promise<Product | null>");
    const any = repo.slice(repo.indexOf("async getBySkuIgnoringAll("));
    expect(any.slice(0, any.indexOf("\n  }"))).not.toContain("not(eq(schema.products.isDeleted");
    expect(file("node_api/http/workflows.ts")).toContain("await products.getBySku(sku)");
    expect(file("node_api/domain/services.ts")).toContain(
      "(await products.findBySku(sku)) !== null",
    );
  });
});

describe("dotnet", () => {
  it("emits the methods; getBy throws, ignoring * drops the query filters", () => {
    const repo = file("dotnet_api/Infrastructure/Repositories/ProductRepository.cs");
    expect(repo).toContain(
      "public async Task<Product> GetBySku(string sku, CancellationToken cancellationToken = default)",
    );
    expect(repo).toContain(
      '_db.Products.Where(x => x.Sku == sku).FirstOrDefaultAsync(cancellationToken) ?? throw new AggregateNotFoundException("not_found")',
    );
    expect(repo).toContain("_db.Products.IgnoreQueryFilters().Where(x => x.Sku == sku)");
    expect(repo).toContain(
      "public async Task<Product?> FindByRegionAndName(string region, string name",
    );
    // An `if let` source injects the repository it reads through.
    expect(file("ArchiveListingHandler.cs")).toContain("IProductRepository products");
  });
});

describe("java", () => {
  it("emits a @Query per method, getBy raising AggregateNotFoundException", () => {
    const jpa = file("features/products/ProductJpaRepository.java");
    expect(jpa).toContain(
      '@Query("select e from Product e where e.sku = :sku")\n    Product getBySku(',
    );
    expect(jpa).toContain(
      '@Query("select e from Product e where e.region = :region and e.name = :name")\n    Product findByRegionAndName(',
    );
    const impl = file("features/products/ProductRepositoryImpl.java");
    const get = impl.slice(impl.indexOf("public Product getBySku("));
    expect(get.slice(0, get.indexOf("\n    }"))).toContain(
      'if (result == null) throw new AggregateNotFoundException("not_found");',
    );
    const find = impl.slice(impl.indexOf("public Product findBySku("));
    expect(find.slice(0, find.indexOf("\n    }"))).not.toContain("AggregateNotFoundException");
  });
});

describe("python", () => {
  it("emits the methods, getBy raising AggregateNotFoundError", () => {
    const repo = file("python_api/app/db/repositories/product_repository.py");
    const get = repo.slice(repo.indexOf("async def get_by_sku("));
    expect(get).toMatch(/^async def get_by_sku\(self, sku: str\) -> Product:/);
    expect(get.slice(0, get.indexOf("_hydrate"))).toContain(
      'raise AggregateNotFoundError("not_found")',
    );
    expect(repo).toContain(
      "async def find_by_region_and_name(self, region: str, name: str) -> Product | None:",
    );
    const any = repo.slice(repo.indexOf("async def get_by_sku_ignoring_all("));
    expect(any.slice(0, any.indexOf("_hydrate"))).not.toContain("is_deleted");
  });
});

describe("elixir", () => {
  it("emits the repository functions + facade, getBy answering {:error, :not_found}", () => {
    const repo = file("elixir_api/lib/elixir_api/catalog/product_repository.ex");
    const get = repo.slice(repo.indexOf("def get_by_sku(sku)"));
    expect(get.slice(0, get.indexOf("\n  end"))).toContain("nil -> {:error, :not_found}");
    const find = repo.slice(repo.indexOf("def find_by_sku(sku)"));
    expect(find.slice(0, find.indexOf("\n  end"))).toContain("{:ok, Repo.one(query)}");
    expect(repo).toContain(
      "where: (record.region == ^region and record.name == ^name) and (not record.is_deleted)",
    );
    expect(file("elixir_api/lib/elixir_api/catalog.ex")).toContain(
      "defdelegate get_by_sku_product(sku), to: ElixirApi.Catalog.ProductRepository, as: :get_by_sku",
    );
  });
});
