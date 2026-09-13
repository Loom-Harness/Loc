import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CODE_DOCS_ANCHORS,
  codeDocsPath,
  codeDocsUrl,
  githubHeadingSlug,
} from "../../src/diagnostics/code-docs.js";
import { codeOfMessageKey, DIAGNOSTIC_MESSAGES } from "../../src/diagnostics/messages.js";
import { UNDOCUMENTED_CODES } from "./diagnostic-docs-undocumented.js";

// ---------------------------------------------------------------------------
// The Problems panel links a `loom.*` code to the language-reference section
// that documents it (M-T8.18).  Two things keep that honest:
//
//   1. Every anchor in `CODE_DOCS_ANCHORS` resolves to a heading that exists
//      in `docs/language-reference/` — under the same GitHub slug rule the
//      docs site stamps on its headings — so a link never lands on a 404 or
//      at the top of the wrong page.
//   2. The set of codes WITHOUT an anchor is a ratchet: every catalog code is
//      either documented or listed in `diagnostic-docs-undocumented.ts`, no
//      code is both, and nothing in that list is stale.  The list may only
//      shrink.
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const refDir = path.join(repoRoot, "docs", "language-reference");

/** Heading slugs per chapter file, read straight from the markdown.  Fenced
 *  code is skipped so a `## ` inside an example is not a heading. */
function headingSlugs(file: string): Set<string> {
  const out = new Set<string>();
  let inFence = false;
  for (const line of fs.readFileSync(path.join(refDir, file), "utf-8").split("\n")) {
    if (line.startsWith("```")) inFence = !inFence;
    if (inFence) continue;
    const m = /^#{1,6}\s+(.*)$/.exec(line);
    if (m) out.add(githubHeadingSlug(m[1]));
  }
  return out;
}

const catalogCodes = new Set(
  Object.keys(DIAGNOSTIC_MESSAGES).map((k) =>
    codeOfMessageKey(k as keyof typeof DIAGNOSTIC_MESSAGES),
  ),
);

describe("codeDocsUrl — every anchor resolves", () => {
  it("scans a real catalog and a real reference", () => {
    expect(catalogCodes.size).toBeGreaterThan(300);
    expect(fs.readdirSync(refDir).filter((f) => /^\d\d-.*\.md$/.test(f)).length).toBeGreaterThan(
      15,
    );
  });

  const slugCache = new Map<string, Set<string>>();
  for (const [code, target] of Object.entries(CODE_DOCS_ANCHORS)) {
    it(`${code} → ${target}`, () => {
      expect(catalogCodes.has(code), `${code} is not a catalog code`).toBe(true);
      const [file, anchor] = target.split("#");
      expect(anchor, "an entry names a section, not just a chapter").toBeTruthy();
      expect(fs.existsSync(path.join(refDir, file)), `${file} exists`).toBe(true);
      let slugs = slugCache.get(file);
      if (!slugs) {
        slugs = headingSlugs(file);
        slugCache.set(file, slugs);
      }
      expect(slugs.has(anchor), `#${anchor} is a heading in ${file}`).toBe(true);
    });
  }

  it("builds the relative path and the absolute site URL, and nothing for an undocumented code", () => {
    expect(codeDocsPath("loom.bare-aggregate-in-type")).toBe(
      "language-reference/04-type-system.md#x-id--cross-aggregate-references",
    );
    expect(codeDocsUrl("loom.bare-aggregate-in-type")).toBe(
      "https://lemmit.github.io/Loc/language-reference/04-type-system.html#x-id--cross-aggregate-references",
    );
    expect(codeDocsUrl("loom.no-such-code")).toBeUndefined();
    expect(codeDocsUrl("loom.blank-message")).toBeUndefined();
  });

  it("slugs headings the way GitHub does", () => {
    expect(githubHeadingSlug("`X id` — cross-aggregate references")).toBe(
      "x-id--cross-aggregate-references",
    );
    expect(githubHeadingSlug("Fields (`Property`)")).toBe("fields-property");
    expect(githubHeadingSlug("  Options — `T?` ")).toBe("options--t");
  });
});

describe("the undocumented-codes ratchet", () => {
  it("every catalog code is documented or listed — and never both", () => {
    const listed = new Set(UNDOCUMENTED_CODES);
    const documented = new Set(Object.keys(CODE_DOCS_ANCHORS));
    const missing = [...catalogCodes].filter((c) => !documented.has(c) && !listed.has(c)).sort();
    expect(
      missing,
      "new catalog codes: add a docs anchor in src/diagnostics/code-docs.ts or list them in diagnostic-docs-undocumented.ts",
    ).toEqual([]);
    const both = [...listed].filter((c) => documented.has(c)).sort();
    expect(
      both,
      "documented now — delete from diagnostic-docs-undocumented.ts (the ratchet shrinks)",
    ).toEqual([]);
  });

  it("carries no stale entry", () => {
    const stale = UNDOCUMENTED_CODES.filter((c) => !catalogCodes.has(c));
    expect(
      stale,
      "not a catalog code any more — delete from diagnostic-docs-undocumented.ts",
    ).toEqual([]);
    expect(new Set(UNDOCUMENTED_CODES).size, "no duplicates").toBe(UNDOCUMENTED_CODES.length);
  });
});

// ---------------------------------------------------------------------------
// The LENGTH of the undocumented list is a ratchet too (M-T9.56).
//
// The two assertions above pin MEMBERSHIP — every catalog code is documented or
// listed, no code is both, nothing is stale.  What they do not pin is the
// list's SIZE, and membership alone is satisfied by adding the new code to the
// undocumented list.  So the rule as written reads "document it OR do not", and
// a new code could land wholly undocumented forever without any gate noticing:
// the list grew by one, and nothing was looking at the total.
//
// Pinning the length turns that into a deliberate act.  Growing the list now
// requires editing this number, in the same change, with the reviewer seeing
// it — which is the difference between a backlog and a leak.
// ---------------------------------------------------------------------------

/** Measured 2026-09-11.  Shrink-only: documenting a code lowers it. */
const UNDOCUMENTED_BASELINE = 369;

describe("the undocumented-codes LENGTH ratchet", () => {
  it("only shrinks", () => {
    expect(
      UNDOCUMENTED_CODES.length,
      `The undocumented-code list GREW to ${UNDOCUMENTED_CODES.length} (pinned ` +
        `${UNDOCUMENTED_BASELINE}).  A new \`loom.*\` code is owed a docs anchor in ` +
        `src/diagnostics/code-docs.ts pointing at the language-reference section that ` +
        `explains the construct — the Problems panel links it.  Parking it in ` +
        `diagnostic-docs-undocumented.ts instead satisfies the membership check above ` +
        `but ships a code the user cannot look up; if that is genuinely the right call ` +
        `for this code, raise this baseline deliberately and say why in the PR.`,
    ).toBeLessThanOrEqual(UNDOCUMENTED_BASELINE);
    expect(
      UNDOCUMENTED_BASELINE - UNDOCUMENTED_CODES.length,
      `The list shrank to ${UNDOCUMENTED_CODES.length} but UNDOCUMENTED_BASELINE still ` +
        `says ${UNDOCUMENTED_BASELINE}.  Lower it in the same PR — slack in a ratchet is ` +
        `how it stops ratcheting (allowlist-ratchet.test.ts, same rule).`,
    ).toBeLessThan(1);
  });
});
