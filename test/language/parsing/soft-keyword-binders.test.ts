// A body binding — `let x = …`, `if let x = …`, `for x in …` — admits the same
// words a bare name-ref does (`CommonSoftKeywords`), so a binding can be read
// back: `let event = n + 1` then `event * 2`.  Hard words stay hard: a binding
// named `match` / `let` / `requires` would make the statement after it
// ambiguous.

import { AstUtils } from "langium";
import { describe, expect, it } from "vitest";
import { parseRawResult } from "../../_helpers/index.js";
import { extractErrors, parseString } from "../../_helpers/parse.js";

const SOFT = ["event", "system", "theme", "layout", "write", "enum", "aggregate", "channel"];
const HARD = ["match", "let", "requires", "if", "this"];

const body = (stmts: string) => `context C {
  aggregate A {
    n: int
    tags: string[]
    operation op(k: int) {
      ${stmts}
    }
  }
  repository As for A { find byN(n: int): A? where this.n == n }
}`;

const handler = (stmts: string) => `context C {
  aggregate A { n: int  operation bump(k: int) { n := n + k } }
  repository As for A { find byN(n: int): A? where this.n == n }
  commandHandler H(q: int) {
    ${stmts}
  }
}`;

/** Every binder name in the parse — `LetStmt.name`, `IfLetStmt.var`, `ForStmt.var`. */
function binders(src: string): string[] {
  const out: string[] = [];
  for (const n of AstUtils.streamAst(parseRawResult(src).value)) {
    const o = n as unknown as { $type: string; name?: string; var?: string };
    if (o.$type === "LetStmt" && o.name) out.push(o.name);
    if ((o.$type === "IfLetStmt" || o.$type === "ForStmt") && o.var) out.push(o.var);
  }
  return out;
}

function errors(src: string): string[] {
  return parseRawResult(src).parserErrors.map((e) => e.message);
}

describe("soft keywords as body binders", () => {
  for (const w of SOFT) {
    it(`\`let ${w}\` binds and reads back`, () => {
      const src = body(`let ${w} = k + 1\n      n := ${w} * 2`);
      expect(errors(src), src).toEqual([]);
      expect(binders(src)).toContain(w);
    });

    it(`\`if let ${w}\` binds and reads back`, () => {
      const src = handler(`if let ${w} = As.byN(q) {\n      ${w}.bump(1)\n    }`);
      expect(errors(src), src).toEqual([]);
      expect(binders(src)).toContain(w);
    });

    it(`\`for ${w} in …\` binds`, () => {
      const src = handler(`for ${w} in xs {\n      let y = ${w}\n    }`);
      expect(errors(src), src).toEqual([]);
      expect(binders(src)).toContain(w);
    });
  }

  for (const w of HARD) {
    it(`\`let ${w}\` still fails — ${w} is a hard word`, () => {
      expect(errors(body(`let ${w} = k + 1`)).length).toBeGreaterThan(0);
    });
  }

  it("a `let` missing its name lists `<ID>`, not the soft keywords it now admits", async () => {
    // The colon-guarded soft keywords (`check`, `mask`, …) lex through a custom
    // pattern, so they reach the candidate list as terminals — filtered too.
    const { doc } = await parseString(body("let = k + 1"));
    const msg = extractErrors(doc.diagnostics).join("\n");
    expect(msg).toContain("Expected one of: <ID>.");
    expect(msg).not.toContain("<check>");
  });
});
