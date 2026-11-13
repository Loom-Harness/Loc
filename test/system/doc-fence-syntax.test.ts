// Every ```ddd fence a reader can see parses.
//
// `first-run-examples-parse.test.ts` VALIDATES the fences that are whole
// programs (`system …`) and syntax-checks `subdomain` / `context` fragments.
// That leaves most fences — a lone aggregate, an operation, a page body, a
// `deployable`, a sketch with `…` — unread, and those are where stale syntax
// accumulates.  This gate asks the weaker SYNTAX question of every fence: is
// there a minimal host the fragment parses in?
//
// A fence passes when, as written or with its elision markers (`…` / `...`)
// removed, ANY host below parses it with no lexer or parser error.  The hosts
// are the places a fragment can legitimately live: as a whole file, split by
// declaration kind into system / subdomain / context / aggregate / ui / api
// members, as statements in an operation or test body, as a page body.  A
// fence none of them accepts is either stale syntax (fix the doc) or a block
// that is invalid on purpose (a doc showing an error); both go on WAIVERS —
// an explicit, ratcheted list: a waiver whose fence now parses, or whose
// marker no longer matches exactly one fence, fails the gate.
//
// The adopter-path docs (ADOPTER_DOCS) take no stale-syntax waiver at all:
// only blocks that are invalid on purpose.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRawResult } from "../_helpers/index.js";

const ROOT = join(import.meta.dirname, "..", "..");

/** The docs a newcomer reads in their first hour. */
const ADOPTER_DOCS: readonly RegExp[] = [
  /^README\.md$/,
  /^docs\/README\.md$/,
  /^docs\/language-reference\//,
  /^docs\/page-metamodel\.md$/,
  /^docs\/scaffold-macros\.md$/,
  /^docs\/customization-gradient\.md$/,
  /^examples\/[^/]+\.md$/,
];

type Waiver = {
  readonly doc: string;
  /** Text unique to the one fence this waiver covers. */
  readonly marker: string;
  /** `intentional: <why>` for a block that is invalid on purpose; otherwise
   *  the issue that tracks fixing the doc (`#NNNN`). */
  readonly why: string;
};

const WAIVERS: readonly Waiver[] = [
  // Invalid on purpose.
  {
    doc: "docs/language-reference/10-repositories-and-queries.md",
    marker: "find byCode(c: string): Order? where this.code == c",
    why: "intentional: shows that a `find` in a repository body is a parse error",
  },
  {
    doc: "docs/language-reference/AUTHORING.md",
    marker: "<minimal .ddd source that isolates this feature>",
    why: "intentional: the chapter template's placeholder",
  },
  {
    doc: "docs/provenance.md",
    marker: "total: int = 0 provenanced",
    why: "intentional: shows the parse error next to the fix",
  },
  {
    doc: "docs/workflow.md",
    marker: "// before — no longer parses",
    why: "intentional: before/after columns of a removed form",
  },
  // Stale syntax, tracked per doc.
  { doc: "docs/architecture.md", marker: "api Mktg:  MarketingApi", why: "#3629" },
  { doc: "docs/architecture.md", marker: "Mktg:  marketingApi", why: "#3629" },
  { doc: "docs/decisions/D-STORAGE-SPLIT.md", marker: "dataSource ordersState", why: "#4930" },
  { doc: "docs/domain-services.md", marker: "module Sales {", why: "#4931" },
  { doc: "docs/domain-services.md", marker: "function shippingFor(", why: "#4931" },
  { doc: "docs/extern.md", marker: "workflow placeAndConfirm(orderId: Order id)", why: "#3631" },
  { doc: "docs/generators.md", marker: "find byDef(def: string)", why: "#4932" },
  { doc: "docs/language.md", marker: "ssn: string sensitive(pii, audited)", why: "#3642" },
  { doc: "docs/workflow.md", marker: "workflow transferCredit(...)", why: "#3631" },
];

// ---------------------------------------------------------------------------

function mdFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "_site" || e.name === "_template") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) mdFiles(p, acc);
    else if (e.name.endsWith(".md")) acc.push(p);
  }
  return acc;
}

const CORPUS = [
  join(ROOT, "README.md"),
  ...mdFiles(join(ROOT, "docs")),
  ...mdFiles(join(ROOT, "examples")),
  ...mdFiles(join(ROOT, "journey")),
  ...readdirSync(join(ROOT, "packages"))
    .map((p) => join(ROOT, "packages", p, "README.md"))
    .filter(existsSync),
  join(ROOT, "vscode", "README.md"),
].filter(existsSync);

type Fence = { readonly rel: string; readonly line: number; readonly text: string };

function fencesOf(file: string): Fence[] {
  const md = readFileSync(file, "utf8");
  const rel = relative(ROOT, file);
  return [...md.matchAll(/```(?:ddd|loom)[^\n]*\n([\s\S]*?)```/g)].map((m) => ({
    rel,
    line: md.slice(0, m.index).split("\n").length,
    text: m[1] ?? "",
  }));
}

// --- the hosts -------------------------------------------------------------

/** Column-0 declaration heads, by the host they belong in. */
const TOP = /^(system|requirement|solution|testCase|import|macro|migration)\b/;
const SUBDOMAIN_MEMBER = /^(context|permissions)\b/;
const CONTEXT_MEMBER =
  /^(abstract\s+)?(aggregate|valueobject|enum|event|repository|criterion|retrieval|workflow|commandHandler|queryHandler|error|command|query|response|payload|domainService|projection|policy|channel|filter|stamp|seed)\b/;
const AGGREGATE_MEMBER =
  /^(operation|invariant|private\s+invariant|derived|entity|contains|create|destroy|apply|unique|index|implements|[a-z]\w*\s*:(?!=))/;
const UI_MEMBER = /^(page|component|area|menu|store)\b/;
const PAGE_MEMBER = /^(state|action|(route|title)\s*:)/;
const API_MEMBER = /^route\b/;
const STATEMENT =
  /^(let|for|if|return|emit|expect|precondition|requires|match|[a-z]\w*(\.\w+)*\s*(:=|\+=|-=)|[A-Za-z]\w*(\.\w+)*\()/;
const UI_EXPRESSION = /^[A-Z]\w*\s*[{(]/;
const UI_ARGUMENT = /^(data|empty|loading|trigger):/;

/** Drop a trailing `// …` comment from the last line of `expr` — one that
 *  starts outside a string literal. */
function stripLineComment(expr: string): string {
  let inString = false;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === '"' && expr[i - 1] !== "\\") inString = !inString;
    else if (!inString && c === "/" && expr[i + 1] === "/") {
      const lineEnd = expr.indexOf("\n", i);
      if (lineEnd === -1) return expr.slice(0, i).trimEnd();
    }
  }
  return expr;
}

/** Split a fragment at column-0 declaration heads and put each chunk in the
 *  host its head belongs in.  Continuation lines (indented, closing braces,
 *  comments) stay with the current chunk. */
function byKind(block: string): string {
  const b: Record<string, string[]> = {
    top: [],
    sub: [],
    ctx: [],
    agg: [],
    stmt: [],
    ui: [],
    page: [],
    body: [],
    arg: [],
    api: [],
    sys: [],
  };
  let into = b.sys;
  for (const line of block.split("\n")) {
    if (/^[^\s/}\])]/.test(line)) {
      into = TOP.test(line)
        ? b.top
        : SUBDOMAIN_MEMBER.test(line)
          ? b.sub
          : CONTEXT_MEMBER.test(line)
            ? b.ctx
            : UI_ARGUMENT.test(line)
              ? b.arg
              : AGGREGATE_MEMBER.test(line)
                ? b.agg
                : UI_MEMBER.test(line)
                  ? b.ui
                  : PAGE_MEMBER.test(line)
                    ? b.page
                    : API_MEMBER.test(line)
                      ? b.api
                      : UI_EXPRESSION.test(line)
                        ? b.body
                        : STATEMENT.test(line)
                          ? b.stmt
                          : b.sys;
    }
    into.push(line);
  }
  const join_ = (xs: string[]) => xs.join("\n");
  const aggregate =
    b.agg.length || b.stmt.length
      ? `aggregate DocAgg {\n${join_(b.agg)}\n${b.stmt.length ? `operation docOp() {\n${join_(b.stmt)}\n}\n` : ""}}\n`
      : "";
  const context =
    b.ctx.length || aggregate ? `context DocCtx {\n${join_(b.ctx)}\n${aggregate}}\n` : "";
  const subdomain =
    context || b.sub.length ? `subdomain DocSub {\n${context}${join_(b.sub)}\n}\n` : "";
  // One body expression per column-0 line; a trailing `// …` comment would
  // swallow the separating comma, so it goes first.
  const expressions = [
    ...b.body
      .join("\n")
      .split(/\n(?=\S)/)
      .map((e) => stripLineComment(e).replace(/,\s*$/, ""))
      .filter((e) => e.trim() !== ""),
    ...(b.arg.length ? [`QueryView { of: docRows, ${join_(b.arg)} }`] : []),
  ];
  const page =
    b.page.length || b.body.length || b.arg.length
      ? `page DocPage {\n${join_(b.page)}\n${
          b.body.length || b.arg.length ? `body: Stack {\n${expressions.join(",\n")}\n}\n` : ""
        }}\n`
      : "";
  const ui = b.ui.length || page ? `ui DocUi {\n${join_(b.ui)}\n${page}}\n` : "";
  const api = b.api.length ? `api DocApi from DocSub {\n${join_(b.api)}\n}\n` : "";
  return `${join_(b.top)}\nsystem DocSystem {\n${subdomain}${ui}${api}${join_(b.sys)}\n}\n`;
}

const wrap =
  (...open: string[]) =>
  (block: string) =>
    `${open.map((o) => `${o} {\n`).join("")}${block}\n${"}\n".repeat(open.length)}`;

const HOSTS: readonly ((block: string) => string)[] = [
  (block) => block,
  byKind,
  wrap("system S"),
  wrap("system S", "subdomain D", "context C"),
  wrap("system S", "subdomain D", "context C", "aggregate A"),
  wrap("system S", "subdomain D", "context C", "aggregate A", "operation o()"),
  wrap("system S", "subdomain D", "context C", "workflow w"),
  wrap("system S", 'test e2e "t" against x'),
  wrap("system S", "ui U"),
  wrap("system S", "ui U", "page P"),
  (block) => `system S {\nui U {\npage P {\nbody: ${block}\n}\n}\n}\n`,
];

const parses = (text: string): boolean => {
  const r = parseRawResult(text);
  return r.lexerErrors.length === 0 && r.parserErrors.length === 0;
};

/** The block with its elision markers removed, and the separators they leave
 *  dangling (`{ a, … }` → `{ a }`). */
const deElided = (block: string): string =>
  block.replace(/…|\.\.\./g, "").replace(/,(\s*[}\])])/g, "$1");

/** A fence inside a list item is indented as a whole; drop the common indent
 *  so its declarations sit at column 0, where `byKind` reads their heads. */
function dedent(block: string): string {
  const lines = block.split("\n");
  const indent = Math.min(
    ...lines.filter((l) => l.trim() !== "").map((l) => l.match(/^ */)?.[0].length ?? 0),
  );
  return Number.isFinite(indent) ? lines.map((l) => l.slice(indent)).join("\n") : block;
}

function fenceParses(text: string): boolean {
  return [dedent(text), deElided(dedent(text))].some((variant) =>
    HOSTS.some((host) => parses(host(variant))),
  );
}

/** The first parse error under the split-by-kind host — the most specific
 *  one — for the failure message. */
function firstError(text: string): string {
  const r = parseRawResult(byKind(deElided(dedent(text))));
  return [...r.lexerErrors, ...r.parserErrors][0]?.message ?? "(no error)";
}

// ---------------------------------------------------------------------------

describe("every ```ddd fence in the docs parses in some minimal host", () => {
  const fences = CORPUS.flatMap(fencesOf);
  const failing = fences.filter((f) => !fenceParses(f.text));
  const waiverFor = (f: Fence) =>
    WAIVERS.filter((w) => w.doc === f.rel && f.text.includes(w.marker));

  it("reaches a real corpus", () => {
    // A matcher that silently found nothing would pass every check below.
    expect(fences.length).toBeGreaterThan(400);
    expect(new Set(fences.map((f) => f.rel)).size).toBeGreaterThan(40);
  });

  it("every failing fence is fixed or waived", () => {
    const unwaived = failing
      .filter((f) => waiverFor(f).length === 0)
      .map(
        (f) => `${f.rel}:${f.line} — ${firstError(f.text)}\n    ${f.text.trim().split("\n")[0]}`,
      );
    expect(unwaived, "fix the fence, or waive it below with the tracking issue").toEqual([]);
  });

  it("the adopter-path docs waive only blocks that are invalid on purpose", () => {
    const bad = WAIVERS.filter(
      (w) => ADOPTER_DOCS.some((re) => re.test(w.doc)) && !w.why.startsWith("intentional:"),
    ).map((w) => `${w.doc}: ${w.marker}`);
    expect(bad).toEqual([]);
  });

  it("no fence is waived twice (a duplicate entry outlives its fix)", () => {
    const keys = WAIVERS.map((w) => `${w.doc} :: ${w.marker}`);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });

  it("every waiver names a fence that still fails (the list ratchets)", () => {
    const stale = WAIVERS.filter((w) => {
      const hits = fences.filter((f) => f.rel === w.doc && f.text.includes(w.marker));
      return hits.length !== 1 || fenceParses(hits[0]!.text);
    }).map((w) => `${w.doc}: ${w.marker}`);
    expect(stale, "the fence parses now (delete the waiver) or the marker is ambiguous").toEqual(
      [],
    );
    for (const w of WAIVERS) expect(w.why).toMatch(/^(intentional: .+|#\d+)$/);
  });
});
