// `README.md` at the generated system root (testability audit finding F12).
//
// The generated tree used to say nothing about itself: `api/`, `web_app/`,
// `e2e/` and `.loom/` with no page explaining what they were, that the `e2e`
// directories are standalone npm projects, or what state they assume.  These
// pin the two properties that make the file worth having — it EXISTS, and it
// is DERIVED (a system with no frontend must not describe one; a system that
// emitted no `e2e/` must not describe an e2e project) — plus the
// scaffold-once marker, which is what stops it clobbering `ddd new`'s README
// or a reader's own edits.

import { describe, expect, it } from "vitest";
import { isScaffoldOnce } from "../../src/util/scaffold-once.js";
import { generateSystemFiles } from "../_helpers/generate.js";

/** A one-backend, no-UI system, with unit `test` blocks but no `test e2e`. */
const BACKEND_ONLY = `
  system Ledger {
    subdomain Core {
      context Accounting {
        aggregate Entry with crudish {
          memo: string
          amount: int

          test "an entry keeps its memo" {
            let e = Entry.create({ memo: "rent", amount: 100 })
            expect(e.memo).toBe("rent")
          }
        }
      }
    }
    storage pg { type: postgres }
    resource accountingState { for: Accounting, kind: state, use: pg }
    deployable api {
      platform: node, contexts: [Accounting],
      dataSources: [accountingState], port: 3000
    }
  }
`;

/** Backend + React frontend + an e2e block — the shape the audit ran. */
const BACKEND_AND_UI = `
  system Storefront {
    subdomain Core {
      context Catalog {
        aggregate Product with crudish {
          sku: string
        }
      }
    }
    storage pg { type: postgres }
    resource catalogState { for: Catalog, kind: state, use: pg }
    ui WebApp with scaffold(subdomains: [Core]) { }
    deployable api {
      platform: node, contexts: [Catalog],
      dataSources: [catalogState], port: 3000
    }
    deployable webApp { platform: react, targets: api, ui: WebApp, port: 3001 }
    test e2e "create a product" against api {
      let p = api.products.create({ sku: "WIDGET-1" })
      expect(p.sku).toBe("WIDGET-1")
    }
  }
`;

/** Two backends, no frontend. */
const TWO_BACKENDS = `
  system Split {
    subdomain Core {
      context Orders { aggregate Order with crudish { ref: string } }
      context Billing { aggregate Invoice with crudish { ref: string } }
    }
    storage pg { type: postgres }
    resource ordersState { for: Orders, kind: state, use: pg }
    resource billingState { for: Billing, kind: state, use: pg }
    deployable ordersApi {
      platform: node, contexts: [Orders], dataSources: [ordersState], port: 3000
    }
    deployable billingApi {
      platform: node, contexts: [Billing], dataSources: [billingState], port: 3100
    }
    test e2e "create an order" against ordersApi {
      let o = api.orders.create({ ref: "A-1" })
      expect(o.ref).toBe("A-1")
    }
  }
`;

/** One .NET backend — its connection string is ADO.NET-keyword shaped. */
const DOTNET_BACKEND = `
  system Ledger {
    subdomain Core {
      context Accounting { aggregate Entry with crudish { memo: string } }
    }
    storage pg { type: postgres }
    resource accountingState { for: Accounting, kind: state, use: pg }
    deployable api {
      platform: dotnet, contexts: [Accounting],
      dataSources: [accountingState], port: 8080
    }
  }
`;

async function readme(source: string): Promise<string> {
  const files = await generateSystemFiles(source);
  const md = files.get("README.md");
  expect(md, "generate system must emit a README.md at the output root").toBeDefined();
  return md!;
}

describe("README.md — it is emitted at all", () => {
  it("writes one at the system root", async () => {
    const files = await generateSystemFiles(BACKEND_ONLY);
    expect([...files.keys()]).toContain("README.md");
  });

  it("titles it with the system name", async () => {
    expect(await readme(BACKEND_ONLY)).toContain("# Ledger");
  });
});

describe("README.md — scaffold-once", () => {
  // Load-bearing: `ddd new` writes its own README.md at this exact path and
  // then tells the author to generate into that same directory.  Without the
  // marker the first `ddd generate system` destroys it.  The marker is
  // detected in-band by the CLI writer, so it also buys `--dry-run`,
  // `.loomignore` and prune participation with no change to that writer.
  it("marks the file scaffold-once so regeneration never overwrites it", async () => {
    expect(isScaffoldOnce(await readme(BACKEND_ONLY))).toBe(true);
  });

  it("carries the marker in an HTML comment, so the rendered page is unaffected", async () => {
    const first = (await readme(BACKEND_ONLY)).split("\n")[0];
    expect(first.startsWith("<!--")).toBe(true);
    expect(first.endsWith("-->")).toBe(true);
  });
});

describe("README.md — it names every deployable", () => {
  it("names the single backend, its platform and its port", async () => {
    const md = await readme(BACKEND_ONLY);
    expect(md).toContain("`api/`");
    expect(md).toContain("node");
    expect(md).toContain("3000");
    expect(md).toContain("`Accounting`");
  });

  it("names both a backend and a frontend, each with its own port", async () => {
    const md = await readme(BACKEND_AND_UI);
    expect(md).toContain("| `api/` | node | 3000 |");
    expect(md).toContain("| `web_app/` | react | 3001 |");
    // The frontend row says what it serves and who it talks to.
    expect(md).toContain("`WebApp` UI, calling `api`");
  });

  it("names BOTH backends of a two-backend system, each at its own port", async () => {
    const md = await readme(TWO_BACKENDS);
    expect(md).toContain("| `orders_api/` | node | 3000 |");
    expect(md).toContain("| `billing_api/` | node | 3100 |");
    expect(md).toContain("`Orders`");
    expect(md).toContain("`Billing`");
  });
});

describe("README.md — run recipes", () => {
  it("gives the compose recipe", async () => {
    expect(await readme(BACKEND_ONLY)).toContain("docker compose up --build");
  });

  it("gives a backend the DATABASE_URL it cannot boot without, pointed at localhost", async () => {
    const md = await readme(BACKEND_ONLY);
    expect(md).toContain("DATABASE_URL=postgres://postgres:postgres@localhost:5432/api");
    expect(md).toContain("npm run dev");
    // The compose hostname must not survive into a recipe meant for the host.
    expect(md).not.toContain("@db:5432");
  });

  it("binds each of two backends to its OWN port and database", async () => {
    const md = await readme(TWO_BACKENDS);
    expect(md).toContain("localhost:5432/orders_api");
    expect(md).toContain("localhost:5432/billing_api");
    expect(md).toContain("PORT=3000");
    expect(md).toContain("PORT=3100");
  });

  // .NET spells its connection string in ADO.NET keywords (`Host=db;Port=…`),
  // where the host and port are separate fields, so the `db:5432` rewrite the
  // other four backends need never fires. Missing it silently dropped
  // `ConnectionStrings__Default` from every dotnet recipe — the one variable
  // that deployable cannot boot without.
  it("rewrites the .NET connection string's host, not just URL-shaped ones", async () => {
    const md = await readme(DOTNET_BACKEND);
    expect(md).toContain("ConnectionStrings__Default=");
    expect(md).toContain("Host=localhost;Port=5432;Database=api");
    expect(md).not.toContain("Host=db;");
  });

  it("builds a vite frontend and pins it to the model's port, not the container default", async () => {
    const md = await readme(BACKEND_AND_UI);
    expect(md).toContain("npm run build");
    // Outside compose there is no port mapping, so `vite preview`'s baked-in
    // container port (3000) would otherwise collide with the backend's.
    expect(md).toContain("npm run preview -- --port 3001");
  });

  it("does not ask for env a native run does not need", async () => {
    const md = await readme(BACKEND_AND_UI);
    // Compose sets `VITE_API_PROXY_TARGET` because inside its network the
    // backend is a SERVICE name.  On the host it is not needed: the emitted
    // vite config already bakes `http://localhost:<target port>` as the
    // fallback, and the backend recipe above binds exactly that port.  Only
    // env the host rewrite actually changes is listed, which is what keeps
    // the recipe to the lines that matter.
    expect(md).not.toContain("VITE_API_PROXY_TARGET");
  });

  it("hands the reader a database that is actually reachable from the host", async () => {
    const md = await readme(BACKEND_ONLY);
    // NOT `docker compose up -d db`: the compose `db` service publishes no
    // port, so that leaves `localhost:5432` refused and every native recipe
    // above broken. Measured — it is why this names a `docker run` instead.
    expect(md).not.toContain("docker compose up -d db");
    expect(md).toContain("docker run --rm -d --name loom-db -p 5432:5432");
    // The emitted db-init is what creates each backend's database.
    expect(md).toContain('-v "$PWD/db-init:/docker-entrypoint-initdb.d:ro"');
    // Same image the compose stack runs, threaded through rather than retyped.
    expect(md).toContain("postgres:18-alpine");
  });
});

describe("README.md — the test projects", () => {
  it("points at the backend's own unit tests", async () => {
    const md = await readme(BACKEND_ONLY);
    expect(md).toContain("### `api/` — unit tests");
    expect(md).toContain("npm test");
  });

  it("says the e2e project is standalone and needs its own install", async () => {
    const md = await readme(BACKEND_AND_UI);
    expect(md).toContain("### `e2e/` — API tests over HTTP");
    expect(md).toContain("cd e2e");
    expect(md).toContain("npm install");
    expect(md).toContain("its own npm project");
  });

  it("names the per-deployable base-URL variable the e2e project actually reads", async () => {
    const md = await readme(BACKEND_AND_UI);
    expect(md).toContain("E2E_API_BASE=http://localhost:3000");
    expect(md).toContain("E2E_WEB_APP_BASE=http://localhost:3001");
  });

  it("names one base-URL variable per backend in a two-backend system", async () => {
    const md = await readme(TWO_BACKENDS);
    expect(md).toContain("E2E_ORDERS_API_BASE=http://localhost:3000");
    expect(md).toContain("E2E_BILLING_API_BASE=http://localhost:3100");
  });

  it("describes the frontend's Playwright project, browser install included", async () => {
    const md = await readme(BACKEND_AND_UI);
    expect(md).toContain("### `web_app/e2e/` — browser tests");
    expect(md).toContain("npx playwright install chromium");
    expect(md).toContain("npx playwright test");
    expect(md).toContain("E2E_BASE_URL");
  });

  // F3, true on this merge base: the emitted suite has no reset hooks, so it
  // is green on an empty database and can be red on a second run.  If a
  // generated reset seam lands, this expectation is the one that must change
  // with it — a README describing isolation the suite does not have would be
  // worse than the silence it replaced.
  it("states the fresh-database requirement wherever an e2e suite was emitted", async () => {
    const md = await readme(BACKEND_AND_UI);
    expect(md).toContain("It expects a fresh database");
    expect(md).toContain("no reset hooks");
    expect(md).toContain("docker compose down -v");
  });

  // Measured: recreating the database under a RUNNING backend fails all four
  // tests, not three — each backend applies its migrations once at boot, so
  // the fresh database has no tables at all. A reset instruction that omits
  // the restart sends the reader from a real problem to a worse one.
  it("says the backends must restart with the database, not just the database", async () => {
    const md = await readme(BACKEND_AND_UI);
    expect(md).toContain("restart the backends with it");
    expect(md).toContain("migrations once, at boot");
  });
});

describe("README.md — it is derived, not a static blob", () => {
  it("does not describe an e2e project for a model that emitted none", async () => {
    const md = await readme(BACKEND_ONLY);
    expect(md).not.toContain("### `e2e/`");
    expect(md).not.toContain("playwright");
    // ...and therefore must not claim a state contract for a suite that
    // does not exist.
    expect(md).not.toContain("It expects a fresh database");
  });

  it("does not describe a frontend for a system that has none", async () => {
    const md = await readme(TWO_BACKENDS);
    expect(md).not.toContain("react");
    expect(md).not.toContain("web_app");
    expect(md).not.toContain("browser tests");
  });

  it("does not describe browser tests for a backend-only system with e2e", async () => {
    const md = await readme(TWO_BACKENDS);
    // The API e2e project IS emitted here...
    expect(md).toContain("### `e2e/` — API tests over HTTP");
    // ...but no deployable mounts a UI, so there is no Playwright project.
    expect(md).not.toContain("playwright");
  });

  it("only lists the `.loom/` artifacts this model actually produced", async () => {
    const md = await readme(BACKEND_ONLY);
    expect(md).toContain("## `.loom/`");
    expect(md).toContain("the wire spec");
    // No requirement / solution / testCase in this model, so no traceability
    // artifact is emitted — and the README must not advertise one.
    const files = await generateSystemFiles(BACKEND_ONLY);
    expect(files.has(".loom/traceability.md")).toBe(false);
    expect(md).not.toContain("requirement traceability");
  });
});

describe("README.md — regeneration", () => {
  it("explains the overwrite contract and how `.loomignore` pins an edit", async () => {
    const md = await readme(BACKEND_ONLY);
    expect(md).toContain("`.loomignore`");
    expect(md).toContain("--dry-run");
    expect(md).toContain("overwrite a file you hand-edited");
  });
});
