// The first `.ddd` a new user copies must parse.
//
// It did not.  Every fenced `ddd`/`loom` block in the docs below was stale, and
// nothing checked them — so the README's headline "Quick example" failed on its
// SECOND LINE (`module` was renamed `subdomain` long ago), and `docs/workflow.md`
// — the reference for the feature — led with two workflows in a header-param
// form the grammar has not accepted since workflow bodies became members-only.
//
// Between them the blocks carried five separate retired spellings: `module`,
// comma-separated aggregate members, `expect x == y` (now needs a matcher),
// positional value-object construction `Money(a, b)` (now `Money { … }`), and
// the inline `name: string display` marker (now `derived display`).  The
// traceability example also used `modules:` on a deployable, which never
// existed — the clause is `contexts:`.
//
// This walks the docs and parses what they show.  It is deliberately a
// CORPUS test, not a fixed string: a doc block that goes stale later fails
// here, which is the whole point — the previous state of affairs was that
// nothing read these at all.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRawResult, parseString } from "../_helpers/index.js";

const ROOT = join(import.meta.dirname, "..", "..");

/** Fenced ```ddd / ```loom blocks that are WHOLE, parseable units.  A doc also
 *  shows fragments (a lone `operation` body, a two-line grammar sketch); those
 *  carry no `system` / `context` / `requirement` head and are skipped — this
 *  test is about the examples a reader would copy and run. */
function wholeBlocks(md: string): string[] {
  return [...md.matchAll(/```(?:ddd|loom)\n([\s\S]*?)```/g)]
    .map((m) => m[1] ?? "")
    .filter((b) => /^\s*(system|context|requirement)\b/m.test(b));
}

/** Wrap a bare `context … { }` block so it can be parsed on its own — the doc
 *  shows the context because the surrounding `system`/`subdomain` is noise for
 *  the feature being explained, not because it is optional. */
function asSystem(block: string): string {
  if (/^\s*system\b/m.test(block)) return block;
  if (/^\s*context\b/m.test(block.trimStart())) {
    return `system DocExample {\n  subdomain DocSub {\n${block}\n  }\n}\n`;
  }
  return block;
}

const DOCS = ["README.md", "docs/workflow.md", "docs/traceability.md"];

describe("the examples a new user copies actually parse", () => {
  for (const rel of DOCS) {
    it(`${rel}`, async () => {
      const blocks = wholeBlocks(readFileSync(join(ROOT, rel), "utf8"));
      // A matcher that silently matched zero blocks would make this pass by
      // vacuum — the failure mode the repo has been bitten by before.
      expect(blocks.length, `${rel} has at least one whole example`).toBeGreaterThan(0);
      for (const [i, block] of blocks.entries()) {
        const { errors } = await parseString(asSystem(block), { validate: true });
        expect(errors, `${rel} block ${i} parses and validates`).toEqual([]);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// The REFERENCE docs — a weaker question, asked of many more blocks (F-010).
//
// Two of them had drifted from the grammar with nothing to catch it: the
// formal reference (`docs/language.md`) documented `channel Name { carries:
// [Event, …] }`, a bracketed list the grammar has never taken (`Expecting token
// of type 'ID' but found '['`), and chapter 06 told the reader that "omitting
// the parens" silences `loom.create-params-not-wire` when `create { }` does not
// parse at all.  Both are lines a new user reads FIRST.
//
// The question here is SYNTAX ONLY — `parseRawResult`, not `parseString` — and
// that is deliberate, not laziness.  A reference doc's job is to show the
// SHAPE of a construct, so its examples legitimately name types, events and
// aggregates that are declared nowhere ("Could not resolve reference to
// NamedDecl named 'Status'"); demanding a linkable model would either fail on
// every honest illustration or push authors to pad each snippet into a whole
// runnable system.  Grammar drift is the failure these two exhibited, and
// syntax is exactly the half that detects it.
// ---------------------------------------------------------------------------

const REFERENCE_DOCS = [
  "docs/language.md",
  "docs/language-reference/06-behavior-and-statements.md",
];

/** The standard embeddings a reference snippet may be written against: as
 *  written (a whole `system`), inside a system's subdomain (a bare `context …`),
 *  or directly inside a system (a snippet mixing a `context` with system-scope
 *  members like `api` / a root `function`).  A block passes when ANY of them
 *  parses — the doc chose which surrounding to elide, and all three are real. */
function embeddings(block: string): string[] {
  return [
    block,
    `system DocExample {\n  subdomain DocSub {\n${block}\n  }\n}\n`,
    `system DocExample {\n${block}\n}\n`,
  ];
}

describe("the reference docs show syntax the grammar accepts", () => {
  for (const rel of REFERENCE_DOCS) {
    it(`${rel}`, () => {
      const blocks = wholeBlocks(readFileSync(join(ROOT, rel), "utf8"));
      expect(blocks.length, `${rel} has at least one whole example`).toBeGreaterThan(0);
      for (const [i, block] of blocks.entries()) {
        const attempts = embeddings(block).map((text) => parseRawResult(text).parserErrors);
        const best = attempts.find((errs) => errs.length === 0) ?? attempts[1]!;
        expect(
          best.map((e) => e.message),
          `${rel} block ${i} (first line: ${block.trim().split("\n")[0]}) parses`,
        ).toEqual([]);
      }
    });
  }
});
