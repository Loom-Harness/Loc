// The Tests tab discovers and runs a generated suite whose domain code imports
// npm packages.  The generated aggregate imports `uuidv7` for its ids (and
// `decimal.js` for money fields); the test build installs the suite's bare
// imports from the deployable's package.json before bundling, because a blob
// module cannot resolve a bare specifier on its own.  Discovery therefore
// lists the unit suite and it passes, and the API suite runs against the
// booted backend.
//
// Needs the npm registry (or the deployed npm mirror), so it self-skips when
// the browser cannot reach the network.

import { expect, test } from "./_test";
import {
  browserCanReachNetwork,
  recordAndGenerate,
  waitForBundle,
  waitForPlaygroundReady,
} from "./_helpers";

const MODEL = `system Shop {
  subdomain Core {
    context Projects {
      aggregate Project with crudish {
        name: string
        budget: int
        price: money?
        invariant name.length > 0
        derived display: string = name
        test "a project keeps its name" { let p = Project.create(name: "x", budget: 3)  expect(p.name).toBe("x") }
      }
      repository Projects for Project { }
    }
  }
  test e2e "create a project" against api { let p = api.projects.create({ name: "A", budget: 2 })  let r = api.projects.getById(p)  expect(r.name).toBe("A") }
  ui WebApp with scaffold(subdomains: [Core]) { }
  storage primary { type: postgres }
  resource appState { for: Projects, kind: state, use: primary }
  deployable api { platform: node, contexts: [Projects], dataSources: [appState], port: 3000 }
  deployable webApp { platform: react, targets: api, ui: WebApp, port: 3001, design: mantine }
}
`;

test("Tests tab installs the generated suites' npm deps, then lists and runs the unit and API tests", async ({
  page,
}) => {
  await page.goto("/");
  await waitForPlaygroundReady(page);
  if (!(await browserCanReachNetwork(page))) {
    test.skip(true, "browser cannot reach the npm registry from this environment");
  }

  await page.waitForFunction(
    () => typeof (window as unknown as { __loomSetSource?: unknown }).__loomSetSource === "function",
    null,
    { timeout: 45_000 },
  );
  await page.evaluate((src) => {
    (window as unknown as { __loomSetSource: (t: string) => void }).__loomSetSource(src);
  }, MODEL);
  await recordAndGenerate(page);

  await page.getByTestId("btn-bundle").click();
  await waitForBundle(page);
  await page.getByTestId("devtools-tab-backend").click();
  await page.getByTestId("btn-boot").click();
  await expect(page.getByTestId("backend-status")).toHaveText("booted", { timeout: 600_000 });

  await page.getByTestId("devtools-tab-tests").click();
  const hint = page.getByTestId("test-error-hint");
  const unit = page.locator('[data-testid^="test-suite-unit-"]').first();
  await expect(hint.or(unit).first()).toBeVisible({ timeout: 180_000 });
  if (await hint.isVisible()) {
    await page.getByTestId("test-error-toggle").click();
    const raw = await page.getByTestId("test-error").innerText();
    throw new Error(`Test discovery failed: ${await hint.innerText()}\n${raw}`);
  }

  await expect(unit).toContainText("a project keeps its name");
  await unit.locator('[data-testid^="btn-run-all-"]').click();
  await expect(unit.getByTestId("test-row").first()).toContainText("pass", { timeout: 60_000 });

  const api = page.getByTestId("test-suite-api");
  await expect(api).toContainText("create a project");
  await page.getByTestId("btn-run-all-api").click();
  await expect(api.getByTestId("test-row").first()).toContainText("pass", { timeout: 60_000 });
});
