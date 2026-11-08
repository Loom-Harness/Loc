// Every shipped example, opened one after another in ONE page, validates
// clean and generates — no network.
//
// One page on purpose: that is how the playground is used, and it is what
// exposes state leaking from one workspace into the next (a language server
// that kept the previous workspace's documents reported false
// `Cannot assign 'Money' to 'Money'` errors on half the examples).
//
// The example list is read from `src/examples/index.ts` itself rather than
// from the picker, so an example that is in the list but missing from the
// picker fails here instead of being silently skipped.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  expectCleanValidation,
  generateOk,
  openExampleWorkspace,
  openProblems,
  waitForPlaygroundReady,
} from "./_helpers";

/** Labels of every entry of `examples` in `src/examples/index.ts`, in order.
 *  The module itself cannot be imported here (its sources are Vite `?raw`
 *  imports), so the array literal is read as text. */
function exampleLabels(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const text = readFileSync(resolve(here, "../src/examples/index.ts"), "utf8");
  const start = text.indexOf("export const examples");
  const end = text.indexOf("\n];", start);
  if (start < 0 || end < 0) throw new Error("could not find the `examples` array in index.ts");
  const labels = [...text.slice(start, end).matchAll(/^\s*label:\s*"((?:[^"\\]|\\.)*)",?$/gm)].map(
    (m) => JSON.parse(`"${m[1]}"`) as string,
  );
  const ids = [...text.slice(start, end).matchAll(/^\s*id:\s*"/gm)];
  if (labels.length === 0 || labels.length !== ids.length) {
    throw new Error(`read ${labels.length} labels for ${ids.length} examples from index.ts`);
  }
  return labels;
}

const LABELS = exampleLabels();

test(`every example (${LABELS.length}) validates clean and generates, in one page`, async ({
  page,
}) => {
  test.setTimeout(LABELS.length * 120_000);
  await page.goto("/");
  await waitForPlaygroundReady(page);
  await openProblems(page);

  for (const label of LABELS) {
    await test.step(label, async () => {
      await openExampleWorkspace(page, label);
      await generateOk(page, label);
      await expectCleanValidation(page, label);
    });
  }
  expect(LABELS.length).toBeGreaterThan(20);
});
