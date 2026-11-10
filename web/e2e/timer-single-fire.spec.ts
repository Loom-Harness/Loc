// `every:` timers in the playground fire once per period (decision
// D-TIMER-SINGLE-FIRE).  The shared-storage example — two Node deployables on
// one PGlite — gains an `every: 2s` timer whose tick creates one saga row.
// Under `infra: "in-process"` each poll runs the same `__loom_timer` claim as
// compose, on the storage's single connection, so the tick neither deadlocks
// nor fires twice in a period.  Needs real internet, like
// multi-deployable-ui.spec.ts.

import { expect, test } from "@playwright/test";
import {
  browserCanReachNetwork,
  readEditorSource,
  recordAndGenerate,
  startFromExample,
  waitForBundle,
} from "./_helpers";

const PERIOD_MS = 2_000;
const WINDOW_PERIODS = 8;

test("shared storage: an every: timer fires once per period", async ({ page }) => {
  test.setTimeout(900_000);
  await page.goto("/");
  await startFromExample(page, /Shared storage/);

  if (!(await browserCanReachNetwork(page))) {
    test.skip(true, "browser cannot reach the npm registry from this environment");
  }

  await test.step("Add an every: 2s timer to the shared Catalog context", async () => {
    const source = await readEditorSource(page);
    const edited = source
      .replace(
        "        derived display: string = sku\n      }\n",
        "        derived display: string = sku\n      }\n" +
          "      aggregate Sweep { note: string }\n" +
          "      event SweepTick { sweep: Sweep id, at: datetime }\n" +
          "      workflow SweepRun {\n" +
          "        sweep: Sweep id\n" +
          "        firedAt: datetime\n" +
          "        create(t: SweepTick) by t.sweep { firedAt := t.at }\n" +
          "      }\n",
      )
      .replace("  storage primary", "  timerSource sweep { for: SweepTick, every: 2s }\n\n  storage primary");
    expect(edited).toContain("timerSource sweep");
    expect(edited).toContain("workflow SweepRun");
    await page.evaluate(
      (t) => (window as unknown as { __loomSetSource: (s: string) => void }).__loomSetSource(t),
      edited,
    );
    await expect(page.getByTestId("btn-validate")).toHaveAttribute("data-state", "ok");
  });

  await test.step("Generate, bundle, boot both deployables on one storage", async () => {
    await recordAndGenerate(page);
    await page.getByTestId("btn-bundle").click();
    await waitForBundle(page);
    await page.getByTestId("devtools-tab-backend").click();
    await page.getByTestId("btn-boot").click();
    await expect(page.getByTestId("backend-status")).toHaveText("booted", { timeout: 600_000 });
    await expect(page.getByTestId("deployable-state-admin")).toHaveText("booted");
    await expect(page.getByTestId("deployable-state-storefront")).toHaveText("booted");
  });

  await test.step("One fire per period, and the timer keeps firing", async () => {
    await page.waitForTimeout(WINDOW_PERIODS * PERIOD_MS);
    await page.getByTestId("runtime-subview").getByText("Database").click();
    await page
      .getByTestId("sql-input")
      .fill(
        "SELECT CASE WHEN count(*) = count(DISTINCT floor(extract(epoch FROM fired_at) * 1000 / " +
          `${PERIOD_MS})) AND count(*) >= ${WINDOW_PERIODS - 3} THEN 'single-fire-ok' ` +
          "ELSE 'fires=' || count(*) || ' periods=' || count(DISTINCT floor(extract(epoch FROM fired_at) * 1000 / " +
          `${PERIOD_MS})) END AS verdict FROM catalog.sweep_runs`,
      );
    await page.getByTestId("btn-run-sql").click();
    await expect(page.getByTestId("sql-result")).toContainText("single-fire-ok", { timeout: 30_000 });
  });
});
