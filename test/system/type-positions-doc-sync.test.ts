// Drift gate for the generated type-position table in
// `docs/language-reference/04-type-system.md` — re-renders it from
// `src/language/type-positions.ts` and asserts the committed block matches.
// A change to the table without `npm run docs:types` fails here.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { withTypePositionsBlock } from "../../src/system/type-positions-doc.js";

const DOC_PATH = fileURLToPath(
  new URL("../../docs/language-reference/04-type-system.md", import.meta.url),
);

describe("docs/language-reference/04-type-system.md type-position table", () => {
  it("is in sync with the table (run `npm run docs:types` to refresh)", () => {
    const committed = readFileSync(DOC_PATH, "utf8");
    expect(committed).toBe(withTypePositionsBlock(committed));
  });
});
