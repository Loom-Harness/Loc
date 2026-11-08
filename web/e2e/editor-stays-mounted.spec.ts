// The source editor is never remounted by ordinary editing or by a content
// replacement under the same file — no network.
//
// A remount disposes the Monaco instance and builds a new one: the pane
// blinks and the view jumps back to line 1, losing scroll and caret.  It is
// right only for a DOCUMENT change (another workspace, another file).  The
// active file's content being replaced from outside (History → Restore,
// another tab's write) used to be one too, via the editor's `key`; now the
// editor reseeds in place.
//
// Identity is tracked by tagging the live `.monaco-editor` element: a remount
// replaces it with an untagged one.

import { expect, test, type Page } from "@playwright/test";
import { openExampleWorkspace, prependMarker, waitForPlaygroundReady } from "./_helpers";

// Long enough that the editor scrolls well past its first screen.
const LONG_EXAMPLE = "Pokémon World (Hono + React)";

async function tagEditor(page: Page): Promise<void> {
  await page
    .locator(".monaco-editor")
    .first()
    .evaluate((el) => {
      (el as unknown as { __loomProbe?: boolean }).__loomProbe = true;
    });
}

async function editorIsTagged(page: Page): Promise<boolean> {
  return page
    .locator(".monaco-editor")
    .first()
    .evaluate((el) => (el as unknown as { __loomProbe?: boolean }).__loomProbe === true);
}

/** Monaco's vertical scroll offset, read off the translated lines layer. */
async function scrollTop(page: Page): Promise<number> {
  return page
    .locator(".monaco-editor .lines-content")
    .first()
    .evaluate((el) => -Number.parseFloat((el as HTMLElement).style.top || "0"));
}

async function scrollEditorDown(page: Page): Promise<number> {
  // Retried as a whole: a freshly opened workspace remounts its editor once
  // its content lands, which can swallow a scroll made just before.
  await expect(async () => {
    await page.locator(".monaco-editor").first().hover();
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 400);
    await expect.poll(() => scrollTop(page), { timeout: 2_000 }).toBeGreaterThan(1_000);
  }).toPass({ timeout: 30_000 });
  return scrollTop(page);
}

test("click, typing and idle never remount the editor or reset its scroll", async ({ page }) => {
  await page.goto("/");
  await waitForPlaygroundReady(page);
  await openExampleWorkspace(page, LONG_EXAMPLE);
  await page.getByTestId("doc-tab-source").click();

  const before = await scrollEditorDown(page);
  await tagEditor(page);

  // Click inside the visible text, type, then idle past the autosave commit
  // debounce and an auto-generate.
  const lines = page.locator(".monaco-editor .view-lines").first();
  const box = await lines.boundingBox();
  if (!box) throw new Error("editor has no layout");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press("End");
  await page.keyboard.type(" // stays");
  await page.waitForTimeout(5_000);

  expect(await editorIsTagged(page), "the editor was remounted").toBe(true);
  expect(Math.abs((await scrollTop(page)) - before)).toBeLessThan(200);
});

test("History → Restore reseeds the editor in place, keeping scroll", async ({ page }) => {
  await page.goto("/");
  await waitForPlaygroundReady(page);
  await openExampleWorkspace(page, LONG_EXAMPLE);
  await page.getByTestId("doc-tab-source").click();

  // Two autosave commits: a base, then one that adds a marker line.  Opening
  // a workspace records none, so the base edit is what gives History an
  // older commit to restore.
  const marker = `// restore-probe-${Date.now()}`;
  for (const line of ["// restore-base", marker]) {
    await prependMarker(page, line);
    await page.waitForTimeout(2_200);
  }

  await page.getByTestId("devtools-tab-history").click();
  const rows = page.getByTestId("history-row");
  await expect.poll(() => rows.count(), { timeout: 10_000 }).toBeGreaterThan(1);

  const before = await scrollEditorDown(page);
  await tagEditor(page);

  await rows.nth(1).click();
  await page.getByTestId("history-restore").first().click();
  await page.getByTestId("history-restore-do").first().click();

  // The restore really reached the editor: the marker line is gone.
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (window as unknown as { __loomGetSource: () => string }).__loomGetSource(),
        ),
      { timeout: 15_000 },
    )
    .not.toContain(marker);
  expect(await editorIsTagged(page), "the restore remounted the editor").toBe(true);
  expect(Math.abs((await scrollTop(page)) - before)).toBeLessThan(200);
});

test("another tab's write reseeds the watching tab's editor in place, keeping scroll", async ({
  page,
  context,
}) => {
  const writer = page;
  await writer.goto("/");
  await waitForPlaygroundReady(writer);
  await openExampleWorkspace(writer, LONG_EXAMPLE);
  await expect(writer.getByTestId("pipeline-count-validate")).toHaveText("0 errors", {
    timeout: 30_000,
  });

  // A second tab on the same workspace: a live, read-only reader.  Every
  // write the other tab makes replaces this tab's active-file content.
  const reader = await context.newPage();
  await reader.goto("/");
  await waitForPlaygroundReady(reader);
  await expect(reader.getByTestId("workspace-readonly-banner")).toBeVisible({ timeout: 20_000 });
  await expect(reader.locator(".monaco-editor").first()).toBeVisible();
  const before = await scrollEditorDown(reader);
  await tagEditor(reader);

  const marker = `// other-tab-${Date.now()}`;
  await prependMarker(writer, marker);
  await expect
    .poll(
      () =>
        reader.evaluate(() =>
          (window as unknown as { __loomGetSource: () => string }).__loomGetSource(),
        ),
      { timeout: 15_000 },
    )
    .toContain(marker);
  expect(await editorIsTagged(reader), "the other tab's write remounted the editor").toBe(true);
  expect(Math.abs((await scrollTop(reader)) - before)).toBeLessThan(200);
});
