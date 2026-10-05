// Every `.ddd` DOCUMENT written inline in a `.ts` test file parses.
//
// `ddd-source-census.test.ts` covers the ~340 files git tracks as `.ddd`.  That
// is the smaller half of the corpus by a factor of six: the suite also carries
// ~2,000 complete `.ddd` documents as template literals inside `.ts` files, and
// until this gate nothing asked any of them anything.
//
// WHY PARSE ERRORS AND NOT VALIDATION.  Langium RECOVERS from a syntax error and
// hands back a PARTIAL AST — so a fixture with a typo silently describes a
// SMALLER model than its author wrote, every assertion still runs, and the test
// passes while testing less than it claims (`experience_gathered.md` §59, #2302).
// `parserErrors` is the only place that recovery is visible.  Validation is NOT
// swept: roughly half these literals are negative fixtures whose whole point is
// to produce a diagnostic, and this gate cannot know which — so it asks the one
// question every fixture must answer the same way.
//
// This gate's first run found 22 such fixtures, in tests that had been asserting
// against the recovered remainder — among them `test/ir/page-ir.test.ts`, the
// page-IR suite itself.  The dominant cause was a comma between `page`
// properties (`page Home { route: "/", body: … }`), which the grammar has never
// admitted; recovery dropped the `body:` and the tests kept passing.
//
// WHAT IT DOES NOT SEE, and why each is a scanner limit rather than a pin:
//
//   • Interpolated literals.  A `${…}` hole has no single substitution that is
//     valid in every position it can occupy (identifier, string body, number),
//     so guessing one would report parse failures this gate manufactured.
//     TypeScript's `NoSubstitutionTemplateLiteral` node type IS the
//     interpolation-free set, so the exclusion is structural, not a heuristic.
//   • Body FRAGMENTS (`Heading { "x" }`, a bare `aggregate … { }`) — not
//     documents, and not parseable alone.  A literal qualifies only when its
//     first meaningful line opens a top-level declaration.
//   • Document HALVES — a `PRELUDE` opening `system S {` that a test concatenates
//     with an `EPILOGUE` before parsing.  Recognised by unbalanced braces, which
//     is what makes them halves; no complete document can have them, so the test
//     cannot mistake a half for a whole.
//   • Placeholder-tokenized templates (`platform: __P__`), which are sources for
//     a substitution step rather than sources.
//
// The scan uses the TypeScript parser, not a regex: this repo's doc comments are
// full of backticked prose (`` `import { t }` ``), and a hand-rolled scanner
// reads those as literals.

import { describe, expect, it } from "vitest";
import { type InlineDoc, inlineDddDocuments as inlineDocuments } from "../_helpers/ddd-corpus.js";
import { parseRawResult } from "../_helpers/parse.js";

// ---------------------------------------------------------------------------
// The pins.  Each names source that is deliberately unparseable — never source
// that merely happens to fail.
//
// A pin without `contains` covers the WHOLE file, for suites that are negative
// wall to wall.  A pin WITH it covers only the documents containing that
// snippet, so a file carrying one deliberate refusal beside many valid fixtures
// keeps the rest of its fixtures gated.  Neither form uses a line number: those
// go stale on the next edit above them.
// ---------------------------------------------------------------------------
const DELIBERATELY_UNPARSEABLE: readonly { file: string; contains?: string; why: string }[] = [
  {
    file: "test/language/parsing/misplaced-declaration.test.ts",
    why: "every fixture puts a declaration in the wrong scope — the parse error's rewrite is the subject",
  },
  {
    file: "test/language/parsing/reserved-name-diagnostic.test.ts",
    contains: "deployable {\n",
    why: "a deployable with its name deleted, pinning the parse error's candidate list (keyword-sweep review)",
  },
  {
    file: "test/playground/builder-recovered-ast.test.ts",
    why: "its subject IS parse recovery — every fixture is a source mid-edit, and a parseable one would test nothing",
  },
  {
    file: "test/language/validation/validation.test.ts",
    why: "negative fixtures, including syntax-level ones",
  },
  {
    file: "test/language/parsing/parsing.test.ts",
    why: "asserts which sources the grammar REFUSES; the refused ones are the point",
  },
  {
    file: "test/language/parsing/reserved-in-expression.test.ts",
    why: "asserts what a keyword-where-a-name-was-legal REFUSAL says; a parseable fixture would reach no message at all",
  },
  {
    file: "test/language/parsing/store.test.ts",
    why: "negative fixtures for the `store` grammar",
  },
  {
    file: "test/language/validation/validator-never-throws.test.ts",
    why: "feeds partially-parsed sources on purpose — a validator that crashes on one is the defect under test",
  },
  {
    file: "test/language/lsp/lsp-definition.test.ts",
    why: "LSP fixtures are sources mid-edit, with the cursor where a token is still missing",
  },
  { file: "test/language/lsp/lsp-rename.test.ts", why: "same — a source mid-edit" },
  { file: "test/language/lsp/lsp-hover.test.ts", why: "same — a source mid-edit" },
  {
    file: "test/language/lsp/capability-completion.test.ts",
    why: "completion is requested at a point where the source is BY DEFINITION incomplete",
  },
  {
    file: "test/language/lsp/tenancy-completion.test.ts",
    why: "same — completion at an incomplete point",
  },
  {
    file: "test/playground/builder-pane-harness.test.ts",
    why: "drives the builder over a source being assembled",
  },
  {
    file: "test/playground/system-builder/model-context.test.ts",
    why: "the builder's model context is exercised on partial sources",
  },
  {
    file: "test/generator/react/extern-functions.test.ts",
    contains: "function f(name: string): string = name",
    why: 'the one negative in a file of valid fixtures — its test is named "a bodied (non-extern) ui-level function does not parse" and asserts the refusal',
  },
  {
    file: "test/macro/crudish.test.ts",
    contains: "count = 0",
    why: "asserts the macro reports the field's syntax error instead of throwing on it; a parseable fixture would test nothing",
  },
  {
    file: "test/ir/seed-lowering.test.ts",
    contains: 'seed Party { name: "x" }',
    why: "the one negative in a file of valid fixtures — `seed Party { … }` is the shape whose error recovery used to crash `lowerSeed` (audit 2026-09-03 F5); a parseable fixture would not reach the recovered `SeedRow` under test",
  },
  // The two below are the INTENDED-ERROR fixtures of M-FT.4, not rot.  That
  // mission is this census's own bug class one level up: it found ten fixtures
  // across nine files whose syntax error nobody had seen, passing only because
  // the validators ran over the recovered tree — and made "a document that does
  // not parse is not validated" the default.  Its own gates therefore need
  // sources that genuinely do not parse, and they are pinned by `contains` so
  // every OTHER fixture in both files stays gated.
  {
    file: "test/language/parsing/parse-error-reporting.test.ts",
    contains: "string = =",
    why: "the syntax error whose reporting is under test — that only the FIRST parse error is reported, and that no linking/validator diagnostic is invented over the recovered tree (F3/F4)",
  },
  {
    file: "test/system/diagnostic-firing-census.test.ts",
    contains: "design: mantinee",
    why: "the mistyped design pack that makes `loom.parse-error` fire, proving the closed-set 'did you mean mantine?' message replaced chevrotain's token-sequence dump (F6)",
  },
];

/** The pins that match a given document. */
function pinsFor(doc: InlineDoc): typeof DELIBERATELY_UNPARSEABLE {
  return DELIBERATELY_UNPARSEABLE.filter(
    (p) => p.file === doc.file && (p.contains === undefined || doc.text.includes(p.contains)),
  );
}

describe("inline `.ddd` source census — the documents that live in `.ts` files", () => {
  const docs = inlineDocuments();

  it("finds the whole population (the scanner must not silently shrink)", () => {
    // Guards the scanner: a broken `git ls-files`, a TypeScript API change or a
    // too-strict filter would make the assertion below pass vacuously.
    expect(docs.length).toBeGreaterThan(1500);
    expect(new Set(docs.map((d) => d.file)).size).toBeGreaterThan(600);
  });

  it("parses every inline `.ddd` document with zero parser errors", () => {
    const failed: string[] = [];
    for (const doc of docs) {
      if (pinsFor(doc).length > 0) continue;
      const result = parseRawResult(doc.text);
      const first = result.parserErrors[0];
      if (first === undefined) continue;
      const at = (first as { token?: { startLine?: number } }).token?.startLine;
      const offending = at === undefined ? "" : ` — ${doc.text.split("\n")[at - 1]?.trim() ?? ""}`;
      failed.push(`${doc.file}:${doc.line}: ${first.message.split("\n")[0]}${offending}`);
    }
    expect(
      failed,
      "an inline `.ddd` document no longer parses. Langium RECOVERS from a syntax " +
        "error and returns a PARTIAL AST, so the test around it keeps passing while " +
        "asserting against a smaller model than the fixture describes. Fix the " +
        "fixture, or — if the source is unparseable on purpose — pin its file in " +
        "DELIBERATELY_UNPARSEABLE with the reason.",
    ).toEqual([]);
    // Explicit budget: ~2,000 parses, and CI runs this under 4-way shard
    // contention with coverage instrumentation attached.
  }, 300_000);

  it("pins no file whose documents all parse (a stale pin is a lie)", () => {
    const stale = DELIBERATELY_UNPARSEABLE.filter((pin) => {
      const own = docs.filter(
        (d) => d.file === pin.file && (pin.contains === undefined || d.text.includes(pin.contains)),
      );
      return own.length > 0 && own.every((d) => parseRawResult(d.text).parserErrors.length === 0);
    }).map((p) => `${p.file}${p.contains === undefined ? "" : ` (${p.contains})`}`);
    expect(
      stale,
      "these files are pinned as carrying unparseable fixtures, but every inline " +
        "document in them parses clean — delete the pin",
    ).toEqual([]);
  }, 120_000);

  it("names a file for every pin (a pin for a file with no inline documents is dead)", () => {
    const orphans = DELIBERATELY_UNPARSEABLE.filter(
      (pin) =>
        !docs.some(
          (d) =>
            d.file === pin.file && (pin.contains === undefined || d.text.includes(pin.contains)),
        ),
    ).map((p) => `${p.file}${p.contains === undefined ? "" : ` (${p.contains})`}`);
    expect(
      orphans,
      "pins that match no inline `.ddd` document at all — the file was renamed or " +
        "deleted, or its `contains` snippet was edited; drop or update the pin",
    ).toEqual([]);
  });
});
