// Phase 3 of the IDE refactor: workspace edits flow through an
// IDB-backed VFS so they survive reload.  This spec drives the
// editor, types into it, reloads the page, and asserts the source
// comes back from the active workspace's autosaved git store.
//
// With the multi-workspace model the active workspace IS the
// persisted content — there's no "Workspace (autosaved)" pseudo-
// example any more — so we assert the workspace switcher shows the
// default "My workspace" and the editor restored the typed marker.
//
// No network needed — runs everywhere the playground bundle does.

import { expect, test } from "@playwright/test";
import { prependMarker, waitForPlaygroundReady } from "./_helpers";

test("editor change → reload → source restored from IDB", async ({ page, context }) => {
  await context.clearCookies();
  // Wipe IDB so the test starts from a known-clean state.
  await page.goto("/");
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases?.();
    for (const { name } of dbs ?? []) {
      if (name?.startsWith("loom-")) {
        await new Promise<void>((resolve) => {
          const req = indexedDB.deleteDatabase(name!);
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
          req.onblocked = () => resolve();
        });
      }
    }
  });

  await page.reload();
  await waitForPlaygroundReady(page);

  // Prepend a uniquely identifiable comment through the automation seam,
  // which dispatches Monaco's change event exactly as a keystroke does.
  const marker = `// loom-persistence-test-${Date.now()}`;
  await prependMarker(page, marker);

  // Wait past the autosave-commit debounce (1.5 s in `startAutoCommit`), the
  // same budget `multi-tab.spec.ts` uses.  The previous 800 ms was attributed
  // to "the IDB flush debounce (~250ms in IdbVfs)" — a constant that is not in
  // the code: the write path is `WorkspaceSourcesController.write`, awaited per
  // change, and the only debounce above it is the 1.5 s autosave.  A budget
  // shorter than the constant it is meant to clear is not a budget.
  await page.waitForTimeout(2200);

  // Reload via the bare playground URL, dropping the `#s=` hash
  // that `scheduleHashSync` wrote during typing.  The hash always
  // wins over IDB (sharing is explicit user intent — see App.tsx
  // boot-order comment); to exercise the IDB-restore path the
  // user has to revisit a hash-free URL.  Same contract as
  // visiting the playground for the first time after closing
  // a shared-link tab.
  await page.goto("/");
  await waitForPlaygroundReady(page);

  // After reload, the active workspace is the default "My workspace"
  // (Mantine Select renders the active option's label as the textbox
  // value), and its autosaved content is restored below.
  await expect(
    page.getByRole("textbox", { name: "Choose workspace" }),
  ).toHaveValue("My workspace", { timeout: 10_000 });

  // The editor's first line should be the marker we typed before
  // reload.  Monaco renders text inside `.view-line` divs.
  const firstLine = page.locator(".monaco-editor .view-line").first();
  await expect(firstLine).toContainText(marker, { timeout: 10_000 });
});
