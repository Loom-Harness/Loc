// Switching workspace leaves the language server with exactly the new
// workspace's documents — no network.
//
// Acme ERP and Acme (multi-deployable) both declare `valueobject Money`, and
// Acme's `aggregate Product with crudish { price: Money }` assigns through a
// macro-synthesised body.  When the previous workspace's documents stayed in
// the server, that body linked to one `Money` and the field to the other, so
// the second workspace reported `Cannot assign 'Money' to 'Money'` — though
// it is clean on a fresh page, in the CLI and in the toolkit — and Generate
// stayed blocked.

import { expect, test } from "@playwright/test";
import {
  expectCleanValidation,
  generateOk,
  openExampleWorkspace,
  openProblems,
  waitForPlaygroundReady,
} from "./_helpers";

const FIRST = "Acme ERP — full system, one file per subdomain + deploy";
const SECOND = "Acme (multi-deployable system)";

test("a workspace opened after another that declares the same types validates clean", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.goto("/");
  await waitForPlaygroundReady(page);
  await openProblems(page);

  await openExampleWorkspace(page, FIRST);
  await generateOk(page, FIRST);
  await expectCleanValidation(page, FIRST);

  await openExampleWorkspace(page, SECOND);
  await generateOk(page, SECOND);
  await expectCleanValidation(page, SECOND);
  await expect(page.getByTestId("problem-row")).toHaveCount(0);
});
