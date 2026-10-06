// The parser's ambiguity channel stays SILENT — on the `toThrow(<kind>)` slot
// and across the whole `.ddd` corpus.
//
// WHY THIS EXISTS (testability re-audit 2026-10-04, finding N7).  Langium's
// ALL(*) lookahead (`chevrotain-allstar`) does not reject an ambiguous
// decision: it picks the lowest alternative and `console.log`s
//
//     Ambiguous Alternatives Detected: <0, 1> in <OR1> inside <PostfixSuffix> Rule,
//     <precondition, ), expect> may appears as a prefix path in all these alternatives.
//
// at RUNTIME, the first time a parse walks the ambiguous path.  So nothing
// fails — `ddd parse` / `generate` / `verify` exit 0 with correct output —
// and the user reads parser internals on stdout every run.  An ignored warning
// channel hides the next real one, so this file keeps it at zero.
//
// THE N7 MECHANISM.  `PostfixSuffix`'s member call reads
// `( throwKind=ThrowKind | (args+=CallArg …)? )`.  That is unambiguous only
// while the `ThrowKind` words (`precondition`, `invariant`) are HARD: the
// moment either one is admitted to `NameRefIdent` it is ALSO a one-token
// `CallArg`, and `toThrow(precondition)` parses two ways.  The 2026-09-28
// soft-keyword sweep (59d1b258d) did exactly that to `precondition`; the
// review that followed (f16b261b9) put it back to hard for an unrelated reason
// (a soft statement head turned a malformed gate into a silent call), which
// closed N7 by accident.  Nothing pinned the dependency, and the sweep's own
// policy is "every keyword is soft unless it is on the hard list" — so the
// next sweep could reopen it.  The structural pin below names the dependency;
// the runtime pin proves the channel is quiet.
//
// WHY A FRESH PARSER PER TEST.  The ALL(*) DFA is cached per parser instance
// and an ambiguity is reported only when a DFA edge is first COMPUTED.  A
// shared, already-warm parser would never re-log, and the test would pass
// vacuously.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { AstUtils, EmptyFileSystem, type Grammar, GrammarAST } from "langium";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDddServices } from "../../../src/language/ddd-module.js";
import { isMemberSuffix, type Model } from "../../../src/language/generated/ast.js";
import { DddGrammar } from "../../../src/language/generated/grammar.js";

const AMBIGUITY = "Ambiguous Alternatives Detected";

/** Parse each source through ONE fresh parser and return every ambiguity
 *  report the lookahead strategy logged, plus the parse results. */
function parseCapturingAmbiguity(sources: readonly string[]) {
  const reports: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    const msg = args.map(String).join(" ");
    if (msg.includes(AMBIGUITY)) reports.push(msg);
  });
  try {
    const parser = createDddServices(EmptyFileSystem).Ddd.parser.LangiumParser;
    const results = sources.map((s) => parser.parse<Model>(s));
    return { reports, results };
  } finally {
    log.mockRestore();
  }
}

afterEach(() => vi.restoreAllMocks());

/** Every shipped `toThrow` form, each FOLLOWED by another statement — the
 *  audit's exact path (`<precondition, ), expect>`): the ambiguous lookahead
 *  only surfaces when something comes after the closing paren. */
const ALL_TOTHROW_FORMS = `
system Probe {
  subdomain Ops {
    context Work {
      aggregate W with crudish {
        code: string
        open: bool = true
        invariant code != ""

        operation close() {
          precondition open
          open := false
        }

        test "precondition rung" {
          let w = W.create({ code: "a" })
          w.close()
          expect(w.close()).toThrow(precondition)
          expect(w.code).toBe("a")
        }

        test "invariant rung" {
          let w = W.create({ code: "a" })
          expect(W.create({ code: "" })).toThrow(invariant)
          expect(w.code).toBe("a")
        }

        test "bare" {
          let w = W.create({ code: "a" })
          w.close()
          expect(w.close()).toThrow()
          expect(w.code).toBe("a")
        }
      }
      repository Ws for W { }
    }
  }
  api WorkApi from Ops
  storage primary { type: postgres }
  resource workState { for: Work, kind: state, use: primary }
  deployable d {
    platform: node
    contexts: [Work]
    dataSources: [workState]
    serves: WorkApi
    port: 4000
  }

  test e2e "status rung" against d {
    expect(api.ws.create({ code: "" })).toThrow(422)
    expect(api.ws.getById("00000000-0000-0000-0000-0000000000ff")).toThrow(404)
  }
}
`;

/** Collect every `.toThrow(...)` member suffix as `throwKind` / arg count. */
function toThrowSuffixes(model: Model): string[] {
  return AstUtils.streamAst(model)
    .filter(isMemberSuffix)
    .filter((s) => s.member === "toThrow")
    .map((s) => (s.throwKind ? `kind:${s.throwKind}` : `args:${s.args.length}`))
    .toArray();
}

describe("toThrow(<kind>) — no grammar ambiguity (N7)", () => {
  it("every shipped toThrow form parses with no ambiguity report", () => {
    const { reports, results } = parseCapturingAmbiguity([ALL_TOTHROW_FORMS]);
    const [r] = results;
    expect([...r.lexerErrors, ...r.parserErrors].map((e) => e.message)).toEqual([]);
    expect(
      reports,
      "the ALL(*) lookahead logged an ambiguity — see N7 in this file's header",
    ).toEqual([]);
    // And each form landed in the slot it always did: the kind words in
    // `throwKind`, never as a `CallArg`; the status as one arg; bare as none.
    expect(toThrowSuffixes(r.value)).toEqual([
      "kind:precondition",
      "kind:invariant",
      "args:0",
      "args:1",
      "args:1",
    ]);
  });

  it("the ThrowKind words stay HARD — not readable as a NameRef — which is what keeps the slot unambiguous", () => {
    const grammar = DddGrammar();
    const throwKinds = [...keywordsOf(grammar, "ThrowKind")].sort();
    expect(throwKinds).toEqual(["invariant", "precondition"]);
    const readable = keywordsOf(grammar, "NameRefIdent");
    expect(
      throwKinds.filter((k) => readable.has(k)),
      "a ThrowKind word was softened into NameRefIdent: `toThrow(<word>)` now parses both as the " +
        "ThrowKind slot and as a CallArg NameRef, and every parse of it prints a Chevrotain ambiguity " +
        "warning (N7).  Keep the word on the hard list in ddd.langium, or move the matcher's kind to " +
        "an ordinary CallArg resolved in lowering.",
    ).toEqual([]);
  });
});

/** Every `.ddd` the repo carries: the shipped examples, the playground's, the
 *  journey, and every test fixture / corpus source. */
function corpusFiles(): string[] {
  const root = join(__dirname, "../../..");
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".ddd")) out.push(p);
    }
  };
  for (const d of ["examples", "web/src/examples", "journey", "test"]) walk(join(root, d));
  return out.sort().map((p) => relative(root, p));
}

describe("grammar ambiguity — the corpus parses silently", () => {
  it("no .ddd in the repo triggers an ALL(*) ambiguity report", () => {
    const root = join(__dirname, "../../..");
    const files = corpusFiles();
    // A floor, so a moved directory can't turn this into a sweep over nothing.
    expect(files.length).toBeGreaterThan(300);
    const { reports } = parseCapturingAmbiguity(
      files.map((f) => readFileSync(join(root, f), "utf8")),
    );
    expect(reports).toEqual([]);
    // ~15s on an idle core (one cold parser over ~430 sources); headroom for a
    // loaded `npm test` run.
  }, 120_000);
});

/** Keywords a rule admits, including those it inherits through rule calls
 *  (`NameRefIdent` pulls in `CommonSoftKeywords`).  Same walk as
 *  `src/language/soft-keywords.ts`, which does not export it. */
function keywordsOf(grammar: Grammar, ruleName: string, seen = new Set<string>()): Set<string> {
  const out = new Set<string>();
  if (seen.has(ruleName)) return out;
  seen.add(ruleName);
  const rule = grammar.rules.find(
    (r): r is GrammarAST.ParserRule => GrammarAST.isParserRule(r) && r.name === ruleName,
  );
  if (!rule) return out;
  for (const node of AstUtils.streamAllContents(rule)) {
    if (GrammarAST.isKeyword(node)) out.add(node.value);
    else if (GrammarAST.isRuleCall(node)) {
      const target = node.rule.ref?.name;
      if (target) for (const k of keywordsOf(grammar, target, seen)) out.add(k);
    }
  }
  return out;
}
