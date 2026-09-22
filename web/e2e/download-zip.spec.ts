// Export-project-zip e2e: the "Download .zip" action in the Generated
// explorer packages the emitted project tree into a single archive — the
// bridge out of the browser for the backends/frontends the preview can't boot.
//
// Pure client-side (in-memory files → store-only ZIP → blob download). Asserts
// a real download fires and its bytes are a valid ZIP (PK\x03\x04 signature).

import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { waitForPlaygroundReady } from "./_helpers";

test("Download .zip exports the generated tree as a valid archive", async ({
  page,
}) => {
  await page.goto("/");
  await waitForPlaygroundReady(page);

  // Generate so the emitted tree is populated.
  await page.getByTestId("btn-generate").click();

  // Switch the explorer to the Generated tree, where the download lives.
  await page.getByTestId("explorer-mode").getByText("Generated").click();

  const downloadBtn = page.getByTestId("download-zip");
  await expect(downloadBtn).toBeVisible({ timeout: 30_000 });

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    downloadBtn.click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/\.zip$/);

  const path = await download.path();
  expect(path).toBeTruthy();
  const buf = readFileSync(path!);
  // Local-file-header signature — proves it's a real ZIP, not an empty/HTML blob.
  expect(buf.subarray(0, 4).toString("latin1")).toBe("PK\x03\x04");
  expect(buf.length).toBeGreaterThan(100);

  // The archive carries a ROOT README on running the tree (M-T8.23 slice 3).
  // The ZIP writer is STORE-only, so the entry name and its body are both
  // plain bytes in the archive — no inflate needed to assert on them.
  //
  // The name is matched through its local file header (signature + the 26-byte
  // fixed part) so it pins an entry at the ARCHIVE ROOT: a bare
  // `toContain("README.md")` would also pass on a per-project `api/README.md`
  // the generator emits, which is not what this ships.
  //
  // WHICH README.  Two can supply it, and F12 changed which one does.  The
  // playground appends its own (`web/src/util/export-readme.ts`) only
  // `if (!entries.some(e => e.path === EXPORT_README_PATH))` — a deliberate
  // don't-clobber guard — and `ddd generate system` now always emits one
  // (`src/system/readme.ts`), so the TOOLCHAIN's README is what ships here and
  // the playground's is the fallback for exports that are not a system tree.
  //
  // So the assertions below are deliberately toolchain-specific.  Asserting
  // only `docker compose up --build` would not do: BOTH READMEs contain that
  // line, which is why it kept passing while this test was failing on the
  // sentence that was unique to the playground's wording.
  const text = buf.toString("latin1");
  expect(text).toMatch(/PK\x03\x04[\s\S]{26}README\.md/);
  expect(text).toContain("docker compose up --build");
  expect(text).toContain("## `.loom/`");
  // ...and its closing sentence.  The middle of that section is a list built
  // from what was actually emitted, so the varying part is deliberately not
  // asserted.  Both of these strings appear ONLY in the toolchain README, so
  // this test now fails if the playground's fallback ever ships here again.
  //
  // Kept ASCII on purpose: `text` is decoded as latin1 (the ZIP is STORE-only
  // and read as raw bytes), so a UTF-8 em dash in the README would arrive as
  // mojibake and never match a `\u2014` in the expectation.
  expect(text).toContain("read them, don't edit them.");
});
