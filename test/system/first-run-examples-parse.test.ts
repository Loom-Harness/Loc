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
//
// ---------------------------------------------------------------------------
// The corpus was THREE hand-listed files, and the other ~50 docs with fenced
// `ddd` blocks were unchecked.  Sweeping all of them found three stale ones the
// three-file list could never reach:
//
//   - `docs/tenancy.md` wrote `crossTenant aggregate Plan` as a PREFIX in its
//     headline example, where the grammar puts `crossTenant` in the header
//     region after the name — a parse error in the flagship example of the
//     tenancy reference, which the same doc spells correctly 80 lines later.
//     A language-docs audit had already reported it (`docs/audits/
//     2026-09-03-language-docs-audit-findings.md`, F40) and it was still there
//     eleven days on, because nothing gated it.
//   - `docs/auth.md`'s full auth example referenced `Customer id` without ever
//     declaring `aggregate Customer`, so it did not link.
//   - `docs/api-toolkit.md` demonstrated `loom.bare-aggregate-in-type` with a
//     source that dies at PARSE (`aggregate Order { line Item }` — no colon,
//     and `Item` undeclared), so the diagnostic it documents was never the one
//     the block produced; the JSON it pinned as "the shape" named a node path
//     and `sourceText` the validator does not emit.
//
// Two tiers, because a doc block is not always a whole program:
//
//   - WHOLE (`system …`) — parsed AND validated.  This is a program a reader
//     can paste into a file and run `ddd parse` on, so nothing less is honest.
//   - FRAGMENT (`subdomain …` / `context …`) — wrapped and parsed only.  These
//     legitimately reference types the surrounding prose declared in a
//     different block, so link-resolution failures here are elision, not rot;
//     syntax is what the block still promises.  Measured: 45 fragments, all
//     clean; under validation 14 would fail, every one of them on a
//     `Could not resolve reference` or a sibling declaration shown separately.
//
// Blocks carrying an elision marker (`…` or `...`) are skipped outright — they
// announce themselves as sketches — as are ones with unbalanced braces, and
// everything under `docs/old/` (frozen design record) and `docs/audits/`
// (snapshot records of broken input, deliberately invalid by nature).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { parseErrorsOf, parseRawResult, parseString } from "../_helpers/index.js";

const ROOT = join(import.meta.dirname, "..", "..");

type Block = { readonly text: string; readonly line: number; readonly whole: boolean };

/** Fenced ```ddd / ```loom blocks that are self-contained units.
 *
 *  `whole` ⇔ the block's first declaration is a `system`, i.e. a complete
 *  program.  A `subdomain`/`context` head is a fragment: real syntax, but
 *  deliberately missing the surroundings.  Anything else (a lone `operation`
 *  body, a two-line grammar sketch, a fence showing three unrelated
 *  declarations side by side) is not a unit and is not read here. */
function blocksOf(md: string): Block[] {
  const out: Block[] = [];
  for (const m of md.matchAll(/```(?:ddd|loom)\n([\s\S]*?)```/g)) {
    const text = m[1] ?? "";
    // An elision marker is the author saying "this is a sketch"; unbalanced
    // braces say the same thing without saying it.
    if (/…|\.\.\./.test(text)) continue;
    if ((text.match(/{/g) ?? []).length !== (text.match(/}/g) ?? []).length) continue;
    const first = text.split("\n").find((l) => l.trim() && !l.trim().startsWith("//")) ?? "";
    const whole = /^\s*system\b/.test(first);
    if (!whole && !/^\s*(subdomain|context)\b/.test(first)) continue;
    out.push({ text, line: md.slice(0, m.index).split("\n").length, whole });
  }
  return out;
}

/** Wrap a fragment so it can be parsed on its own — the doc shows the context
 *  because the surrounding `system`/`subdomain` is noise for the feature being
 *  explained, not because it is optional.
 *
 *  A fragment routinely shows a `context` NEXT TO a system-level sibling the
 *  prose is really about (`api X from Y`, `storage`, `deployable`).  `context`
 *  is a `subdomain` member and those are `system` members, so the two halves
 *  need different homes: splitting at column-0 declaration boundaries puts the
 *  contexts under a synthetic subdomain and everything else directly under the
 *  system.  Wrapping the whole fragment in one or the other instead makes the
 *  doc look broken when it is the wrapper that is. */
function asSystem(b: Block): string {
  if (b.whole) return b.text;
  const lines = b.text.split("\n");
  // Column-0 `context …` starts a context chunk; any other column-0 word
  // starts a system-member chunk.  Continuation lines inherit the current one.
  const inSub: string[] = [];
  const inSys: string[] = [];
  let target = /^context\b/.test(lines[0]?.trimEnd() ?? "") ? inSub : inSys;
  for (const l of lines) {
    if (/^\S/.test(l)) target = /^context\b/.test(l) ? inSub : inSys;
    target.push(l);
  }
  const sub = inSub.length ? `  subdomain DocSub {\n${inSub.join("\n")}\n  }\n` : "";
  return `system DocExample {\n${sub}${inSys.join("\n")}\n}\n`;
}

/** Blocks that are invalid ON PURPOSE — a doc demonstrating a diagnostic.
 *  Keyed `<doc>:<fence line>` → the `loom.*` code the prose promises, so the
 *  gate pins the promise instead of looking away: the block must produce THAT
 *  code, not merely fail somehow. */
const EXPECTED_INVALID: Record<string, string> = {
  "docs/api-toolkit.md:153": "loom.bare-aggregate-in-type",
};

/** Every `.md` under `docs/`, plus the README.  `old/` is the frozen design
 *  record and `audits/` are snapshot records of broken input — neither makes a
 *  claim about what parses today. */
function docFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "old" || e.name === "audits" || e.name === "node_modules") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) docFiles(p, acc);
    else if (e.name.endsWith(".md")) acc.push(p);
  }
  return acc;
}

const DOCS = [join(ROOT, "README.md"), ...docFiles(join(ROOT, "docs"))];

describe("the examples a new user copies actually parse", () => {
  const found = DOCS.flatMap((f) =>
    blocksOf(readFileSync(f, "utf8")).map((b) => ({ rel: relative(ROOT, f), b })),
  );

  it("the sweep reaches a real corpus", () => {
    // A matcher that silently matched zero blocks would make every assertion
    // below pass by vacuum — the failure shape this repo has been bitten by
    // before (`experience_gathered.md` §59/§63).  Measured at 9 whole + 45
    // fragments; the floor is deliberately well under that so ordinary doc
    // churn doesn't trip it, and well over zero so a broken matcher does.
    expect(found.filter((x) => x.b.whole).length).toBeGreaterThan(5);
    expect(found.filter((x) => !x.b.whole).length).toBeGreaterThan(25);
    expect(found.some((x) => x.rel === "README.md")).toBe(true);
  });

  for (const { rel, b } of found) {
    const key = `${rel}:${b.line}`;
    const expectedCode = EXPECTED_INVALID[key];

    if (expectedCode) {
      it(`${key} — shows ${expectedCode}`, async () => {
        const { errors } = await parseString(asSystem(b), { validate: true });
        expect(errors.join("\n"), `${key} should still be invalid`).not.toEqual("");
        // The doc names a diagnostic.  Failing for some OTHER reason (a parse
        // error, say) means the example no longer demonstrates what the prose
        // says it does — which is how this entry came to exist.
        const { validate } = await import("../../src/api/index.js");
        const codes = (await validate(asSystem(b))).diagnostics.map((d) => d.code);
        expect(codes, `${key} must raise the code its prose documents`).toContain(expectedCode);
      });
      continue;
    }

    if (b.whole) {
      it(`${key} — parses and validates`, async () => {
        const { errors } = await parseString(asSystem(b), { validate: true });
        expect(errors).toEqual([]);
      });
    } else {
      it(`${key} — parses (fragment)`, () => {
        // `parseErrorsOf`, not a `{ validate: false }` parse: the latter leaves
        // `errors` unconditionally empty, so it would assert nothing at all
        // (see `vacuous-parse-assertion.test.ts`).
        expect(parseErrorsOf(asSystem(b))).toEqual([]);
      });
    }
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

/** The block population for the SYNTAX-ONLY sweep below.  Deliberately NOT
 *  `blocksOf`: that one classifies whole-vs-fragment and drops elided or
 *  brace-unbalanced fences, because its caller then VALIDATES (names must
 *  resolve).  This sweep asks a weaker question of a wider set — it accepts a
 *  `requirement` head too, and judges only whether the grammar accepts the
 *  text.  Narrowing it to `blocksOf` would quietly shrink what the reference
 *  docs are checked against, so the two populations stay separate on purpose. */
function wholeBlocks(md: string): string[] {
  return [...md.matchAll(/```(?:ddd|loom)\n([\s\S]*?)```/g)]
    .map((m) => m[1] ?? "")
    .filter((b) => /^\s*(system|context|requirement)\b/m.test(b));
}

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
