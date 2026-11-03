import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateSystemFilesFromProject } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// verify that the e2e renderer dispatches to `phoenixLiveView`
// deployables and emits `/api/…` prefixed URL paths (Phoenix routes all
// its HTTP API inside `scope "/api"`).
//
// The fixture is a minimal system with one Phoenix backend that serves a
// single aggregate module and has a couple of `test e2e` blocks against it.
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");

const FIXTURE_SOURCE = `system PhoenixShop {

  subdomain Store {
    context Store with scaffoldGet(of: ByName) {
      aggregate Item with crudish {
        name: string
        derived display: string = name
        price: decimal
        invariant price > 0
        operation archive() {
          price := 0
        }
      }
      repository Items for Item { }
      criterion ByName(name: string) of Item = this.name == name
    }
  }

  api StoreApi with scaffoldGetApi(of: ByName) from Store

  storage pg { type: postgres }
  resource storeState { for: Store, kind: state, use: pg }

  deployable shopBackend {
    platform: elixir,
    contexts: [Store],
    dataSources: [storeState],
    serves: StoreApi,
    port: 4000
  }

  test e2e "create an item, look it up" against shopBackend {
    let it = api.items.create({ name: "Gadget", price: 19.99 })
    let read = api.items.getById(it)
    expect(read.name).toBe("Gadget")
  }

  test e2e "archive an item via operation" against shopBackend {
    let it = api.items.create({ name: "Old", price: 5.00 })
    api.items.archive(it)
  }

  test e2e "find items by name" against shopBackend {
    let result = api.store.getItemByName("Gadget")
  }
}
`;

async function buildFixture(): Promise<Map<string, string>> {
  // Write to a temp dir so the Langium document URI is stable.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-phx-e2e-"));
  const file = path.join(dir, "phoenix-shop.ddd");
  fs.writeFileSync(file, FIXTURE_SOURCE);
  return generateSystemFilesFromProject(file);
}

describe("e2e dispatch to phoenixLiveView", () => {
  it("emits e2e/<system>.e2e.test.ts for a phoenix deployable", async () => {
    const files = await buildFixture();
    // The e2e spec must be generated.
    expect(files.has("e2e/PhoenixShop.e2e.test.ts")).toBe(true);
  });

  it("includes the phoenix deployable in the ENDPOINTS table", async () => {
    const files = await buildFixture();
    const e2e = files.get("e2e/PhoenixShop.e2e.test.ts")!;
    // ENDPOINTS entry uses the service slug derived from the deployable name.
    expect(e2e).toMatch(/shop_backend: process\.env\.E2E_SHOP_BACKEND_BASE/);
    expect(e2e).toMatch(/http:\/\/localhost:4000/);
  });

  it("prefixes aggregate CRUD calls with /api for phoenix", async () => {
    const files = await buildFixture();
    const e2e = files.get("e2e/PhoenixShop.e2e.test.ts")!;
    // POST /api/items  — create
    expect(e2e).toMatch(/__post\(`\$\{base\}\/api\/items`/);
    // GET  /api/items/{id}  — getById (auto-.id on let-bound result)
    expect(e2e).toMatch(/__get\(`\$\{base\}\/api\/items\/\$\{it\.id\}`\)/);
  });

  it("prefixes aggregate operation calls with /api for phoenix", async () => {
    const files = await buildFixture();
    const e2e = files.get("e2e/PhoenixShop.e2e.test.ts")!;
    // POST /api/items/{id}/archive
    expect(e2e).toMatch(/__post\(`\$\{base\}\/api\/items\/\$\{it\.id\}\/archive`/);
  });

  it("prefixes a routed single-row read (scaffoldGet) with /api for phoenix", async () => {
    const files = await buildFixture();
    const e2e = files.get("e2e/PhoenixShop.e2e.test.ts")!;
    // GET /api/items/by_name?name=...
    expect(e2e).toContain('__route("GET", __qs(`${base}/api/items/by_name`, { name: "Gadget" }))');
  });

  it("adds the /api prefix to hono/dotnet deployables too", async () => {
    // The existing acme.ddd system has dotnet and hono deployables.
    // Every backend now mounts its domain routes under the shared /api base.
    const files = await generateSystemFilesFromProject(path.join(repoRoot, "examples/acme.ddd"));
    const e2e = files.get("e2e/Acme.e2e.test.ts")!;
    // These must hit /api/products (every backend mounts under /api now).
    expect(e2e).toMatch(/__post\(`\$\{base\}\/api\/products`/);
    expect(e2e).toMatch(/__get\(`\$\{base\}\/api\/products\/\$\{p\.id\}`\)/);
  });
});
