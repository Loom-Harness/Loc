// The shared walker core names no framework.
//
// `walker-core.ts` and `_walker/primitives/**` are the half of the page walker
// every frontend shares.  Each framework's differences live behind the
// `WalkerTarget` seams, in its own target file.  A branch on a framework name
// inside the shared half — `if (ctx.target.framework === "phoenixLiveView")`,
// a `heex` import, an `elixir`-only arm — makes one target a special case of
// the core, which is the coupling the seams exist to prevent.  Phoenix/HEEx is
// the target most at risk: it is moving onto this core, and each primitive it
// moves tempts a local exception.
//
// So the code (comments excluded, string literals and identifiers included) of
// those files must not contain `heex`, `elixir`, `liveview` or `phoenix`, in
// any case.  A framework difference the core needs is a new `WalkerTarget`
// seam, not a name check.
//
// The same files must not speak one KIND of target's data access either.  A
// client-state target reads the server through a hook over the generated HTTP
// API client; a server-session target (LiveView) calls its context in-process
// and has neither.  The core says only "this body reads X / calls op Y",
// through the data-access seam (`_walker/data-access.ts`), and each target
// binds that its own way.  Hook and HTTP-client vocabulary in the core would
// make every target a hook target, so `walker-core.ts` carries none.  The
// shared primitives still carry some; each file's count is pinned below and
// may only fall — a fix lowers its ceiling in the same change, and a file that
// reaches zero leaves the table.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";

const FORBIDDEN = /heex|elixir|liveview|phoenix/i;

/** Hook and HTTP-client vocabulary: React-style `use*` hooks and their
 *  libraries, the generated `../api/<module>` client, and raw HTTP calls. */
const DATA_ACCESS_VOCABULARY =
  /hook|tanstack|query-core|usequery|usemutation|\/api\/|api-client|apiclient|httpclient|\bfetch\b|axios/i;

/** The data-access vocabulary each shared primitive still carries.  Exact:
 *  a count above its ceiling is a new leak, a count below it is a stale
 *  ceiling to lower.  `walker-core.ts` is absent, so its ceiling is zero. */
const DATA_ACCESS_CEILINGS: Readonly<Record<string, number>> = {
  "src/generator/_walker/primitives/controls.ts": 9,
  "src/generator/_walker/primitives/forms.ts": 23,
};

const WALKER_CORE = "src/generator/_walker/walker-core.ts";
const PRIMITIVES_DIR = "src/generator/_walker/primitives";

function tsFilesUnder(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return tsFilesUnder(p);
      return p.endsWith(".ts") ? [p] : [];
    })
    .sort();
}

/** Every non-comment token of `text`, with its 1-based line. */
function codeTokens(text: string): { line: number; text: string }[] {
  // The parser, not the bare scanner: only the parser knows which `}` closes a
  // template substitution and which `/` opens a regex.  Comments are trivia, so
  // they are never tokens; JSDoc blocks are attached as nodes and skipped.
  const sf = ts.createSourceFile("census.ts", text, ts.ScriptTarget.Latest, true);
  const out: { line: number; text: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) {
      return;
    }
    const children = node.getChildren(sf);
    if (children.length === 0) {
      const start = node.getStart(sf);
      out.push({
        line: sf.getLineAndCharacterOfPosition(start).line + 1,
        text: text.slice(start, node.getEnd()),
      });
      return;
    }
    for (const c of children) visit(c);
  };
  visit(sf);
  return out;
}

/** `file:line: token` for every framework-naming token in `text`. */
function frameworkMentions(file: string, text: string): string[] {
  return mentions(file, text, FORBIDDEN);
}

/** `file:line: token` for every token of `text` matching `pattern`. */
function mentions(file: string, text: string, pattern: RegExp): string[] {
  return codeTokens(text)
    .filter((t) => pattern.test(t.text))
    .map((t) => `${file}:${t.line}: ${t.text}`);
}

describe("walker-core framework census", () => {
  const files = [WALKER_CORE, ...tsFilesUnder(PRIMITIVES_DIR)];

  it("scans the shared walker core and every shared primitive", () => {
    expectReach("shared walker files", files.length, 17);
  });

  it("names no framework outside comments", () => {
    const hits = files.flatMap((f) => frameworkMentions(f, readFileSync(f, "utf8")));
    expect(
      hits,
      "The shared walker names a framework.  Move the difference behind a WalkerTarget seam " +
        "and implement it in that framework's target file.",
    ).toEqual([]);
  });

  // The census reads code, not comments.  Both halves of that are what make it
  // useful: a comment explaining why HEEx differs is allowed, and a string or
  // identifier that names it is caught.
  it("ignores comments and catches identifiers, strings and template text", () => {
    const sample = [
      "// HEEx renders this differently",
      "/* Phoenix LiveView note */",
      "const x = 1;",
      'if (ctx.target.framework === "phoenixLiveView") {}',
      "import { renderHeex } from './x.js';",
      "const s = `a ${b} elixir`;",
    ].join("\n");
    expect(frameworkMentions("sample.ts", sample)).toEqual([
      'sample.ts:4: "phoenixLiveView"',
      "sample.ts:5: renderHeex",
      "sample.ts:6: } elixir`",
    ]);
  });

  it("speaks no hook or HTTP-client vocabulary outside the data-access seam", () => {
    const over: string[] = [];
    const stale: string[] = [];
    for (const f of files) {
      const hits = mentions(f, readFileSync(f, "utf8"), DATA_ACCESS_VOCABULARY);
      const ceiling = DATA_ACCESS_CEILINGS[f] ?? 0;
      if (hits.length > ceiling)
        over.push(`${f}: ${hits.length} > ${ceiling}\n  ${hits.join("\n  ")}`);
      else if (hits.length < ceiling) stale.push(`${f}: ${hits.length} < ${ceiling}`);
    }
    expect(
      over,
      "The shared walker names a hook or the HTTP API client.  Route the read or call " +
        "through `_walker/data-access.ts` and bind it in the target's `bindDataAccess`.",
    ).toEqual([]);
    expect(stale, "A ceiling is stale.  Lower it to the file's count.").toEqual([]);
    for (const f of Object.keys(DATA_ACCESS_CEILINGS)) expect(files).toContain(f);
  });

  it("recognises hook and HTTP-client vocabulary in code, not in comments", () => {
    const sample = [
      "// the hook is declared once per page",
      "const a = 1;",
      "import { tryDetectApiHook } from './api-hook-detector.js';",
      'addImport(ctx, "../api/client", "ApiError");',
      "const r = await fetch(url);",
    ].join("\n");
    expect(mentions("sample.ts", sample, DATA_ACCESS_VOCABULARY)).toEqual([
      "sample.ts:3: tryDetectApiHook",
      "sample.ts:3: './api-hook-detector.js'",
      'sample.ts:4: "../api/client"',
      "sample.ts:5: fetch",
    ]);
  });
});
