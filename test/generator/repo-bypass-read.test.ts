// `ignoring …` on the single-row reads `Repo.find(<Criterion>)` and
// `Repo.findById(id)`, on all five backends.
//
// A widened read calls a repository method of its own
// (`findFirstProductsInRegionIgnoringSoftDeletable`, `findByIdIgnoringSoftDeletable`)
// that skips the capability filter it names, while the plain read keeps
// running the shared method — the criterion's retrieval, which still filters.
// The fixture is the compile-gate one
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

/** The text of `src` from `start` up to the first `end` after it. */
function block(src: string, start: string, end: string): string {
  const at = src.indexOf(start);
  expect(at, `${start} not emitted`).toBeGreaterThanOrEqual(0);
  return src.slice(at, src.indexOf(end, at + start.length));
}

describe("node", () => {
  it("the widened reads drop the softDeletable predicate; the plain retrieval keeps it", () => {
    const repo = file("node_api/db/repositories/product-repository.ts");
    const crit = block(
      repo,
      "async findFirstProductsInRegionIgnoringSoftDeletable(region: string): Promise<Product | null>",
      "\n  }\n",
    );
    expect(crit).toContain("where(productsInRegionCriterion(region))");
    expect(crit).toContain(".limit(1)");
    expect(crit).not.toContain("isDeleted, true");
    const byId = block(
      repo,
      "async findByIdIgnoringSoftDeletable(id: Ids.ProductId): Promise<Product | null>",
      "\n  }\n",
    );
    expect(byId).toContain("where(eq(schema.products.id, id))");
    expect(byId).not.toContain("isDeleted, true");
    expect(block(repo, "async runFindAllByProductsInRegion(", "\n  }\n")).toContain(
      "not(eq(schema.products.isDeleted, true))",
    );
    const wf = file("node_api/http/workflows.ts");
    expect(wf).toContain("await products.findFirstProductsInRegionIgnoringSoftDeletable(region)");
    expect(wf).toContain("await products.findFirstProductsInRegionIgnoringAll(region)");
    expect(wf).toContain("await products.findFirstProductsInRegionIgnoringSoftDeletable(c.region)");
    const svc = file("node_api/domain/services.ts");
    expect(svc).toContain("(await products.findFirstProductsInRegionIgnoringAll(region)) !== null");
    expect(svc).toContain("(await products.findByIdIgnoringSoftDeletable(id)) !== null");
  });
});

describe("dotnet (EF)", () => {
  it("the widened reads ignore the IsDeleted query filter", () => {
    const repo = file("dotnet_api/Infrastructure/Repositories/ProductRepository.cs");
    expect(repo).toContain(
      '_db.Products.IgnoreQueryFilters(["IsDeletedFilter"]).Where(new ProductsInRegionCriterion(region).ToExpression()).FirstOrDefaultAsync(cancellationToken)',
    );
    expect(repo).toContain(
      "_db.Products.IgnoreQueryFilters().Where(new ProductsInRegionCriterion(region).ToExpression())",
    );
    expect(repo).toContain(
      '_db.Products.IgnoreQueryFilters(["IsDeletedFilter"]).Where(x => x.Id == id).FirstOrDefaultAsync(cancellationToken)',
    );
    expect(file("Application/Products/Commands/ArchiveFirstInRegionHandler.cs")).toContain(
      "await _products.FindFirstProductsInRegionIgnoringSoftDeletable(command.Region, cancellationToken)",
    );
    expect(file("Application/Workflows/ListingWatchOnListingClosedHandler.cs")).toContain(
      "await _products.FindFirstProductsInRegionIgnoringSoftDeletable(notification.Region, cancellationToken)",
    );
    const svc = file("dotnet_api/Domain/Services/ProductQueries.cs");
    expect(svc).toContain(
      "(await _products.FindByIdIgnoringSoftDeletable(id, cancellationToken)) != null",
    );
  });
});

describe("java", () => {
  it("the widened reads disable the promoted softDeletable filter and take the first row", () => {
    const jpa = file("features/products/ProductJpaRepository.java");
    expect(jpa).toContain(
      '@Query("select e from Product e where e.region = :region order by e.id")\n    java.util.List<Product> findFirstProductsInRegionIgnoringSoftDeletable(@Param("region") String region, Pageable pageable);',
    );
    const impl = file("features/products/ProductRepositoryImpl.java");
    const crit = block(
      impl,
      "public Product findFirstProductsInRegionIgnoringSoftDeletable(String region) {",
      "\n    }\n",
    );
    expect(crit).toContain('__session.disableFilter("softDeletable");');
    expect(crit).toContain(
      "jpa.findFirstProductsInRegionIgnoringSoftDeletable(region, PageRequest.of(0, 1)).stream().findFirst().orElse(null)",
    );
    const byId = block(
      impl,
      "public Product findByIdIgnoringSoftDeletable(ProductId id) {",
      "\n    }\n",
    );
    expect(byId).toContain('__session.disableFilter("softDeletable");');
    expect(file("application/workflows/CatalogDispatcher.java")).toContain(
      "productsRepository.findFirstProductsInRegionIgnoringSoftDeletable(c.region())",
    );
    expect(file("domain/services/ProductQueries.java")).toContain(
      "productsRepository.findByIdIgnoringSoftDeletable(id) != null",
    );
  });
});

describe("python", () => {
  it("the widened reads run with the loom_ignoring execution option", () => {
    const repo = file("python_api/app/db/repositories/product_repository.py");
    expect(
      block(repo, "async def find_first_products_in_region_ignoring_soft_deletable(", "\n\n"),
    ).toContain('execution_options(loom_ignoring=frozenset({"softDeletable"}))');
    expect(block(repo, "async def find_first_products_in_region_ignoring_all(", "\n\n")).toContain(
      'execution_options(loom_ignoring=frozenset({"*"}))',
    );
    expect(block(repo, "async def find_by_id_ignoring_soft_deletable(", "\n\n")).toContain(
      'select(ProductRow).where((ProductRow.id == id)).execution_options(loom_ignoring=frozenset({"softDeletable"}))',
    );
    expect(file("python_api/app/dispatch.py")).toContain(
      "await products.find_first_products_in_region_ignoring_soft_deletable(c.region)",
    );
  });
});

describe("elixir", () => {
  it("the widened reads omit the is_deleted conjunct; a criterion read takes one row", () => {
    const repo = file("elixir_api/lib/elixir_api/catalog/product_repository.ex");
    const crit = block(repo, "def find_first_products_in_region_ignoring_soft_deletable(", "  end");
    expect(crit).toContain("where: record.region == ^region)");
    expect(crit).not.toContain("is_deleted");
    expect(crit).toContain("Repo.one(from(record in query, order_by: [asc: record.id], limit: 1))");
    const byId = block(repo, "def find_by_id_ignoring_soft_deletable(", "  end");
    expect(byId).toContain("where: record.id == ^id)");
    expect(byId).not.toContain("is_deleted");
    expect(block(repo, "def find_by_sku(", "  end")).toContain("not record.is_deleted");
    // The correlated reactor's `if let` calls the widened method too.
    const reactor = file("catalog/workflows/listing_watch/on_listing_closed.ex");
    expect(reactor).toContain(
      "case ElixirApi.Catalog.find_first_products_in_region_ignoring_soft_deletable_product(event.region) do",
    );
    expect(reactor).toContain("{:ok, %{} = p} ->");
  });
});

describe("dotnet (Dapper)", () => {
  const SRC = `
    system S {
      capability softDeletable { isDeleted: bool  filter this.isDeleted == false }
      subdomain D { context C {
        criterion Big(min: int) of Order = this.total > min
        aggregate Order with softDeletable { total: int }
        repository Orders for Order { }
        domainService Q {
          operation everBig(min: int): bool { return Orders.find(Big(min)) ignoring softDeletable != null }
          operation ever(id: Order id): bool { return Orders.findById(id) ignoring * != null }
        }
      }}
      storage primary { type: postgres }
      resource st { for: C, kind: state, use: primary }
      deployable api { platform: dotnet { persistence: dapper }  contexts: [C]  dataSources: [st]  port: 3000 }
    }`;
  it("the widened reads leave the is_deleted predicate out of their SQL", async () => {
    const out = await generateSystemFiles(SRC);
    const key = [...out.keys()].find((k) =>
      k.endsWith("Infrastructure/Repositories/OrderRepository.cs"),
    );
    const repo = out.get(key!)!;
    expect(block(repo, "FindFirstBigIgnoringSoftDeletable(", "\n    }\n")).toContain(
      'FROM orders WHERE (total > @min) LIMIT 1"',
    );
    expect(block(repo, "FindByIdIgnoringAll(", "\n    }\n")).toContain(
      'FROM orders WHERE (id = @id) LIMIT 1"',
    );
    // The plain by-id load keeps the predicate.
    expect(repo).toContain("FROM orders WHERE id = @id AND (is_deleted = FALSE)");
  });
});
