// Every generated project that runs vitest must carry its own config — Wave 4 F-004.
//
// Vitest, finding no config in the directory it is run from, walks UPWARD
// looking for one.  A generated output tree lives exactly where there is
// something above it — inside the user's repo — so `npm test` in a generated
// project loaded the ANCESTOR's config and took the ancestor's `include` globs.
//
// TWO projects had the hole, and the BACKEND's version is the worse one:
//
//   <out>/e2e/        (vitest run, the api e2e suite)
//       → `No test files found, exiting with code 1`, printing the ancestor's
//         include globs — a confusing failure, but a failure.
//
//   <out>/<backend>/  (vitest run, the colocated domain/<agg>.test.ts files)
//       → measured: `numTotalTests = 0` and a clean exit.  Zero tests reads as
//         a PASS.  The same tree copied to /tmp (no ancestor config above it)
//         ran `1 passed (1)`.
//
// Measured both ways on the emitted backend, with a root `vitest.config.ts`
// planted above it:
//   without the config:  No test files found, exiting with code 1
//                        include: ancestor/**/*.spec.ts
//   with the config:     ✓ domain/order.test.ts (1 test) — 1 passed (1)
//
// Scope check — the other emitted projects are NOT affected, and for a reason
// rather than by luck: python ships its own `pyproject.toml` carrying
// `[tool.pytest.ini_options]` (pytest's rootdir stops there, and pytest
// collects from its arguments rather than from an inherited include glob),
// java has `settings.gradle.kts`, dotnet an `Api.csproj`, elixir a `mix.exs` —
// each of those runners is project-rooted by construction.  The frontend `web/`
// project runs no unit tests, and its Playwright `e2e/` already emits
// `playwright.config.ts` (Playwright does not walk upward).

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const SYS = `
  system Shop {
    subdomain Sales {
      context Orders {
        aggregate Order with crudish {
          code: string
          qty: int
          function doubled(): int = qty * 2
          test "doubled doubles" {
            let o = Order.create({ code: "c", qty: 3 })
            expect(o.doubled()).toBe(6)
          }
        }
        repository Orders for Order { }
      }
    }
    storage pg { type: postgres }
    resource s { for: Orders, kind: state, use: pg }
    deployable api {
      platform: node
      contexts: [Orders]
      dataSources: [s]
      port: 4000
    }
    test e2e "round trip" against api {
      let o = api.orders.create({ code: "c", qty: 1 })
      let r = api.orders.getById(o)
      expect(r.code).toBe("c")
    }
  }
`;

/** The same system with the `test e2e` block removed — the e2e project is
 *  emitted only when a system declares one, and the config must follow that
 *  gate rather than appear unconditionally. */
const SYS_NO_E2E = SYS.replace(/test e2e[\s\S]*?\n {4}\}\n/, "");

/** The single line whose absence is the whole bug: the root pin.  Asserted on
 *  both configs — a config file alone stops the upward search when run from its
 *  own directory, and the pin keeps that true when it is passed by path. */
const ROOT_PIN = 'root: fileURLToPath(new URL(".", import.meta.url))';

describe("generated e2e project is self-contained", () => {
  it("emits its own vitest.config.ts beside the spec", async () => {
    const files = await generateSystemFiles(SYS);
    expect([...files.keys()]).toContain("e2e/vitest.config.ts");
  });

  it("pins root to the config's own directory, so vitest never walks upward", async () => {
    const cfg = (await generateSystemFiles(SYS)).get("e2e/vitest.config.ts")!;
    expect(cfg).toContain(ROOT_PIN);
    expect(cfg).toContain('import { fileURLToPath } from "node:url"');
  });

  it("includes the shape the e2e renderer actually emits", async () => {
    const files = await generateSystemFiles(SYS);
    expect(files.get("e2e/vitest.config.ts")!).toContain('include: ["**/*.e2e.test.ts"]');
    // …and the emitted spec really matches that glob — an `include` naming a
    // shape nothing emits would pass the assertion above and still find no
    // tests.
    const specs = [...files.keys()].filter((p) => p.startsWith("e2e/") && p.endsWith(".ts"));
    expect(specs.filter((p) => p.endsWith(".e2e.test.ts"))).toEqual(["e2e/Shop.e2e.test.ts"]);
  });

  it("ships alongside the manifest that installs vitest", async () => {
    const pkg = (await generateSystemFiles(SYS)).get("e2e/package.json")!;
    // The config imports `vitest/config`; without the devDependency the config
    // would itself be the thing that breaks the project.
    expect(JSON.parse(pkg).devDependencies).toHaveProperty("vitest");
  });

  it("emits nothing at all when the system declares no e2e test", async () => {
    const files = await generateSystemFiles(SYS_NO_E2E);
    expect([...files.keys()].filter((p) => p.startsWith("e2e/"))).toEqual([]);
  });
});

describe("generated node backend project is self-contained", () => {
  it("emits its own vitest.config.ts beside the domain tests it runs", async () => {
    const files = await generateSystemFiles(SYS);
    expect([...files.keys()]).toContain("api/vitest.config.ts");
  });

  it("pins root to the project directory", async () => {
    const cfg = (await generateSystemFiles(SYS)).get("api/vitest.config.ts")!;
    expect(cfg).toContain(ROOT_PIN);
  });

  it("leaves the include set to vitest's default — the fix must not change which tests run", async () => {
    const cfg = (await generateSystemFiles(SYS)).get("api/vitest.config.ts")!;
    expect(cfg).not.toContain("include:");
  });

  it("actually has tests to find, and a script that runs them", async () => {
    const files = await generateSystemFiles(SYS);
    // Without this, the config above would be guarding an empty project and
    // every assertion here would be vacuous.
    expect([...files.keys()]).toContain("api/domain/order.test.ts");
    expect(JSON.parse(files.get("api/package.json")!).scripts.test).toBe("vitest run");
  });

  it("emits the config even for a test-free backend (the script is always there)", async () => {
    // `"test": "vitest run"` ships unconditionally, so the upward search is
    // reachable unconditionally — gating the config on "has domain tests" would
    // leave the empty-but-confusing case open.
    const noTests = SYS.replace(/test "doubled doubles"[\s\S]*?\n {10}\}\n/, "");
    const files = await generateSystemFiles(noTests);
    expect([...files.keys()]).toContain("api/vitest.config.ts");
  });
});
