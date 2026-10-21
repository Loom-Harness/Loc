// No python repository builder hand-assembles an `app.auth.user` import.
//
// This file used to pin "one `authUserImport(...)` call per builder": the
// helper returned a whole `from app.auth.user import …` line, so two reasons
// for a principal symbol flowing into two calls emitted two import lines from
// one module, and ruff failed the generated project on the redefinition (it ran
// red for real when #2694 and pairwise F6 each added a call to the
// event-sourced builder).
//
// M-T9.84 closed the class structurally: a builder now writes the principal
// accessors (`current_user`, `require_current_user`, `User`) through `ref()`
// markers at the use site, and the module finalizer derives ONE de-duplicated
// import block from them, so two reasons can no longer become two lines.  The
// helper is deleted.  What is left to pin is that the hand-assembled shape does
// not come back: no builder spells an `app.auth.user` import literal.

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const BUILDERS = [
  "repository-builder.ts",
  "repository-document-builder.ts",
  "repository-embedded-builder.ts",
  "repository-eventsourced-builder.ts",
] as const;

const dir = path.resolve(__dirname, "../../../src/generator/python");

describe("no python repository builder hand-assembles an app.auth.user import", () => {
  for (const file of BUILDERS) {
    it(file, () => {
      const src = readFileSync(path.join(dir, file), "utf8");
      const literals = [...src.matchAll(/["'`]from app\.auth\.user import/g)];
      expect(
        literals.length,
        `${file} spells an \`app.auth.user\` import by hand; write the symbol through ` +
          `pyRef("app.auth.user", …) at its use site instead (M-T9.84).`,
      ).toBe(0);
    });
  }
});
