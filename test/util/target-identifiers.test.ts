// The per-target reserved-identifier contract (src/util/target-identifiers.ts):
// ONE table, ONE escaping path, and a fixture that cannot drift from it.
//
// Three things are pinned here:
//
//   1. COVERAGE against an authoritative source where one runs in CI: python's
//      own `keyword` module, and the TypeScript scanner's reserved-word range.
//      A table that silently lacks a keyword is the #3102 defect shape.
//   2. The escape path: a reserved word is escaped in each target's idiom; any
//      other name passes through byte-identically (no churn for the common case).
//   3. DRIFT between the table and `test/fixtures/corpus/target-reserved-words.ddd`
//      — the adversarial fixture every backend's compile leg builds.  Every table
//      entry the `.ddd` grammar admits as a field / enum value / operation /
//      parameter must appear there in that position, so adding a word to the
//      table puts it in front of five compilers.  A position the grammar refuses
//      is proved refused (by parsing), not assumed; a word a backend cannot yet
//      spell in a position is a named, ratcheting KNOWN_GAP.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  escapeTargetIdent,
  escapeTargetMember,
  IDENT_TARGETS,
  isReserved,
  reservedWords,
} from "../../src/util/target-identifiers.js";
import { REPO_ROOT } from "../_helpers/ddd-corpus.js";
import { extractErrors, parseString } from "../_helpers/parse.js";

const FIXTURE = resolve(REPO_ROOT, "test/fixtures/corpus/target-reserved-words.ddd");

/** Words a backend still cannot spell in one position, each with the mission
 *  that drains it.  A stale entry fails below. */
const KNOWN_GAPS: Record<"field" | "enum" | "op" | "param", Record<string, string>> = {
  field: {
    constructor:
      "ts: a field's getter cannot be named `constructor` (TS1341); escaping it moves every " +
      "aggregate read site — M-T6.86",
  },
  enum: {},
  op: {},
  param: {},
};

describe("coverage against authoritative keyword lists", () => {
  it("python: every `keyword.kwlist` entry and the `match`/`case` soft keywords are reserved", () => {
    const out = execFileSync(
      "python3",
      ["-c", "import keyword, json; print(json.dumps(keyword.kwlist + ['match', 'case']))"],
      { encoding: "utf8" },
    );
    const missing = (JSON.parse(out) as string[]).filter((k) => !isReserved("python", k));
    expect(missing).toEqual([]);
  });

  it("ts: every reserved and strict-mode future-reserved word of the TS scanner, plus arguments/eval", () => {
    const words: string[] = ["arguments", "eval"];
    for (let k = ts.SyntaxKind.FirstReservedWord; k <= ts.SyntaxKind.LastReservedWord; k++)
      words.push(ts.tokenToString(k) as string);
    for (
      let k = ts.SyntaxKind.FirstFutureReservedWord;
      k <= ts.SyntaxKind.LastFutureReservedWord;
      k++
    )
      words.push(ts.tokenToString(k) as string);
    expect(words.length).toBeGreaterThan(40);
    expect(words.filter((w) => !isReserved("ts", w))).toEqual([]);
  });
});

describe("the one escaping path", () => {
  it("escapes in each target's idiom", () => {
    expect(escapeTargetIdent("csharp", "base")).toBe("@base");
    expect(escapeTargetIdent("fsharp", "member")).toBe("``member``");
    expect(escapeTargetIdent("python", "def")).toBe("def_");
    expect(escapeTargetIdent("elixir", "end")).toBe("end_");
    expect(escapeTargetIdent("java", "record")).toBe("record_");
    expect(escapeTargetIdent("ts", "eval")).toBe("eval_");
    expect(escapeTargetIdent("dart", "rethrow")).toBe("rethrow_");
    expect(escapeTargetMember("ts", "then")).toBe("then_");
    expect(escapeTargetMember("ts", "constructor")).toBe("constructor_");
  });

  it("passes a non-reserved name through unchanged on every target", () => {
    for (const t of IDENT_TARGETS) {
      expect(escapeTargetIdent(t, "orderTotal")).toBe("orderTotal");
      expect(escapeTargetMember(t, "orderTotal")).toBe("orderTotal");
    }
  });
});

describe("the adversarial fixture covers the table (drift ratchet)", () => {
  const src = readFileSync(FIXTURE, "utf8");
  const enumLine = /enum Keyword \{([^}]*)\}/.exec(src)?.[1] ?? "";
  const keywordsBody = /aggregate Keywords with crudish \{([\s\S]*?)\n {6}\}/.exec(src)?.[1] ?? "";
  const verbsBody = /aggregate Verbs with crudish \{([\s\S]*?)\n {6}\}/.exec(src)?.[1] ?? "";
  const present = {
    enum: new Set(enumLine.split(",").map((s) => s.trim())),
    field: new Set([...keywordsBody.matchAll(/^ {8}(\w+): /gm)].map((m) => m[1] as string)),
    op: new Set([...verbsBody.matchAll(/operation (\w+)\(/g)].map((m) => m[1] as string)),
    param: new Set([...verbsBody.matchAll(/[(,] ?(\w+): int/g)].map((m) => m[1] as string)),
  };

  /** The union of every target's binding table, lower-case-initial — the names
   *  a `.ddd` member can carry.  (Capitalised entries — `True`, `None` — are
   *  type-position names, the BCL / global type-name half of the class.) */
  const words = [...new Set(IDENT_TARGETS.flatMap((t) => reservedWords(t)))]
    .filter((w) => /^[a-z]/.test(w))
    .sort();

  const shapes: Record<keyof typeof present, (w: string) => string> = {
    field: (w) => `aggregate A { ${w}: string }`,
    param: (w) => `aggregate A { x: string  operation op(${w}: string) { x := ${w} } }`,
    op: (w) => `aggregate A { x: string  operation ${w}() { x := "y" } }`,
    enum: (w) => `enum E { ${w} other }\n aggregate A { e: E }`,
  };
  async function admitted(pos: keyof typeof present, w: string): Promise<boolean> {
    const src2 =
      `system S { subdomain D { context C {\n ${shapes[pos](w)}\n } }\n storage p { type: postgres }\n` +
      ` resource r { for: C, kind: state, use: p }\n deployable api { platform: node, contexts: [C], dataSources: [r], port: 3000 } }`;
    const { doc } = await parseString(src2);
    return (
      doc.parseResult.lexerErrors.length + doc.parseResult.parserErrors.length === 0 &&
      extractErrors(doc.diagnostics).length === 0
    );
  }

  it("parses the fixture's four position lists (non-vacuity)", () => {
    expect(present.field.size).toBeGreaterThan(150);
    expect(present.enum.size).toBeGreaterThan(150);
    expect(present.op.size).toBeGreaterThan(150);
    expect(present.param.size).toBeGreaterThan(150);
  });

  it("every table word the grammar admits in a position appears there (or is a named gap)", async () => {
    const missing: string[] = [];
    for (const pos of Object.keys(present) as (keyof typeof present)[]) {
      for (const w of words) {
        if (present[pos].has(w) || w in KNOWN_GAPS[pos]) continue;
        if (await admitted(pos, w)) missing.push(`${pos} ${w}`);
      }
    }
    expect(
      missing,
      "the grammar admits these table words in a position the fixture does not exercise — add them to target-reserved-words.ddd",
    ).toEqual([]);
  }, 300_000);

  it("every KNOWN_GAP is still a gap (the list ratchets)", () => {
    const stale = Object.entries(KNOWN_GAPS).flatMap(([pos, gaps]) =>
      Object.keys(gaps).filter((w) => present[pos as keyof typeof present].has(w)),
    );
    expect(stale, "the fixture now exercises it — delete the gap").toEqual([]);
  });
});
