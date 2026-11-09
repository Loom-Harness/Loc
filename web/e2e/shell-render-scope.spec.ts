// Typing in the editor re-renders the editor's own subtree, not the shell —
// no network.
//
// App holds the playground's state and publishes it as one `ctx`; the shell's
// panels subscribe to the fields they read (`src/layout/ctx-store.tsx`).  A
// keystroke changes the editor tick and the active file's content, so App and
// the editor-side panes re-render — the desktop layout, the dev-tools dock and
// the preview must not: re-rendering the whole shell costs ~40 ms of React work
// per keystroke.
//
// The render-count probe (`window.__loomRenderCounts`) is off unless installed
// before the page loads.

import { expect, test, type Page } from "@playwright/test";
import { waitForPlaygroundReady } from "./_helpers";

type Counts = Record<string, number>;

async function renderCounts(page: Page): Promise<Counts> {
  return page.evaluate(() => ({
    ...(window as unknown as { __loomRenderCounts: Record<string, number> }).__loomRenderCounts,
  }));
}

const grew = (before: Counts, after: Counts, name: string): number =>
  (after[name] ?? 0) - (before[name] ?? 0);

test("an editor keystroke does not re-render the shell", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __loomRenderCounts: Record<string, number> }).__loomRenderCounts = {};
  });
  await page.goto("/");
  await waitForPlaygroundReady(page);

  // Settle: the first auto-Generate (and everything it re-renders) is done.
  await expect(page.getByText(/generated \d+ file\(s\)/)).toBeVisible({ timeout: 60_000 });
  const before0 = await renderCounts(page);
  expect(before0.DesktopShell ?? 0, "the probe sees the shell").toBeGreaterThan(0);

  // Type on a fresh comment line at the end of the file.  Measured right after
  // the burst, before the idle auto-Generate would legitimately re-render the
  // pipeline surfaces.
  await page.locator(".monaco-editor .view-lines").first().click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("//");
  await page.waitForTimeout(1_000);
  await expect(page.getByText(/generated \d+ file\(s\)/)).toBeVisible();

  const before = await renderCounts(page);
  await page.keyboard.type("render-probe", { delay: 30 });
  await page.waitForTimeout(150);
  const after = await renderCounts(page);

  expect(grew(before, after, "App"), "App re-renders on typing (the probe works)").toBeGreaterThan(0);
  for (const name of ["DesktopShell", "DevToolsDock", "PreviewPane", "DesktopHeader", "CommandPalette"]) {
    expect(grew(before, after, name), `${name} re-rendered on an editor keystroke`).toBe(0);
  }
});
