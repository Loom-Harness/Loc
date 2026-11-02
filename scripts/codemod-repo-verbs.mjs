// Codemod for the hard cutover that renamed the repository contract's verbs
// (D-REPO-VERBS):
//
//   before                                          after
//   Orders.getById(id)                              Orders.get(id)
//   Orders.findById(id)                             Orders.find(id)
//   Orders.findAll(C, page: p) / Orders.run(C)      Orders.all(C, page: p) / Orders.all(C)
//   Orders.run(R(args), page: p)                    Orders.all(R(args), page: p)
//   Orders.run(retrieval { where: C sort: [s] })    Orders.all(C, sort: [s])
//   Orders.findAll()                                Orders.all()
//   Orders.delete(o)                                Orders.remove(o)
//
// `find(C)`, `getBy` / `findBy` and `all()` are unchanged.
//
//   node scripts/codemod-repo-verbs.mjs [--check] [--list] <path>...
//
//   <path>   a `.ddd` / `.md` / `.ts` file or a directory (walked recursively,
//            skipping node_modules / .git / dist / out / .loom).  Defaults to
//            the tracked corpus: examples/, web/src/examples/, journey*/,
//            eval-*/, docs/ (minus the frozen old/, audits/, new-plan/), test/.
//   --check  write nothing; exit 1 when any file still spells an old verb.
//   --list   write nothing; print the files that would change.
//
// Text-level, because it must run on sources the new grammar no longer
// parses.  A call is rewritten only when its receiver is a bare name declared
// as a `repository` in the SAME file (or, for the reads a context `test` body
// spells on the aggregate — `getById` / `findById` / `findAll` — an
// `aggregate`), so a domain service's `Transfer.run(…)`, an e2e
// `api.orders.getById(…)` or an Ecto `Repo.delete(…)` in a test expectation
// is never touched.  In a Markdown file the placeholder receivers `Repo` /
// `<Repo>`, and any plural receiver, count as repositories too.  Idempotent:
// a migrated file is left byte-identical.
//
// An anonymous retrieval carrying `loads:` has no `all(…)` spelling; it is
// left in place and reported.

import fs from "node:fs";
import path from "node:path";

const RENAMES = {
  getById: "get",
  findById: "find",
  findAll: "all",
  run: "all",
  delete: "remove",
};
/** The reads a context integration test spells on the aggregate's own name. */
const AGGREGATE_VERBS = new Set(["getById", "findById", "findAll"]);

const declared = (src, keyword) => {
  const out = new Set();
  const re = new RegExp(`\\b${keyword}\\s+([A-Za-z_]\\w*)`, "g");
  for (const m of src.matchAll(re)) out.add(m[1]);
  return out;
};

/** The index just past the bracket that closes the one opening at `open`
 *  (`(`, `[` or `{`), skipping string literals; -1 when it never closes. */
function closeOf(src, open) {
  const pairs = { "(": ")", "[": "]", "{": "}" };
  const stack = [];
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      i++;
      while (i < src.length && src[i] !== '"') i += src[i] === "\\" ? 2 : 1;
      continue;
    }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === ")" || c === "]" || c === "}") {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i + 1;
    }
  }
  return -1;
}

/** Rewrite `retrieval { where: X sort: [S] }` (the text between the call's
 *  parentheses starting at `start`) to `X, sort: [S]`.  Returns the
 *  replacement and the end of the literal, or `undefined` when it cannot be
 *  expressed (a `loads:` clause, an unbalanced block). */
function rewriteRetrievalLiteral(src, start) {
  const m = /^retrieval\s*\{/.exec(src.slice(start));
  if (!m) return undefined;
  const open = start + m[0].length - 1;
  const end = closeOf(src, open);
  if (end < 0) return undefined;
  const body = src.slice(open + 1, end - 1);
  const where = /^\s*where\s*:\s*/.exec(body);
  if (!where) return undefined;
  // The `where:` expression runs to the first top-level `sort:` / `loads:`.
  let i = where[0].length;
  let depth = 0;
  let exprEnd = body.length;
  for (; i < body.length; i++) {
    const c = body[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (depth === 0 && /^\s(sort|loads)\s*:/.test(body.slice(i))) {
      exprEnd = i;
      break;
    }
  }
  const expr = body.slice(where[0].length, exprEnd).trim();
  const rest = body.slice(exprEnd).trim();
  let sort;
  if (rest) {
    const s = /^sort\s*:\s*/.exec(rest);
    if (!s) return undefined; // `loads:` — no `all(…)` spelling
    const lb = s[0].length;
    if (rest[lb] !== "[") return undefined;
    const rb = closeOf(rest, lb);
    if (rb < 0 || rest.slice(rb).trim()) return undefined; // trailing `loads:`
    sort = rest.slice(lb, rb).trim();
  }
  return { text: sort === undefined ? expr : `${expr}, sort: ${sort}`, end };
}

/** Rewrite every old repository verb in `src`.  `markdown` admits the doc
 *  placeholders `Repo` / `<Repo>` as repository receivers. */
export function rewriteRepoVerbs(src, { markdown = false } = {}) {
  const repos = declared(src, "repository");
  const aggs = declared(src, "aggregate");
  if (markdown) repos.add("Repo");
  const counts = {};
  const refused = [];
  const re = /(<Repo>|(?<![\w.$])[A-Za-z_]\w*)\.(getById|findById|findAll|run|delete)\(/g;
  let out = "";
  let last = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const [whole, head, verb] = m;
    // A doc's snippets rarely carry their `repository` declarations, so in
    // Markdown a plural receiver (`Orders`, `Technicians`) counts as one too;
    // a singular one (`Transfer.run`, a domain service) does not.
    const isRepo =
      head === "<Repo>" ? markdown : repos.has(head) || (markdown && /^[A-Z]\w*[a-z]s$/.test(head));
    const isAgg = !isRepo && aggs.has(head) && AGGREGATE_VERBS.has(verb);
    if (!isRepo && !isAgg) continue;
    const argStart = m.index + whole.length;
    let replacement = `${head}.${RENAMES[verb]}(`;
    let resume = argStart;
    if (verb === "run") {
      const lit = /^\s*retrieval\s*\{/.test(src.slice(argStart));
      if (lit) {
        const ws = /^\s*/.exec(src.slice(argStart))[0].length;
        const r = rewriteRetrievalLiteral(src, argStart + ws);
        if (!r) {
          refused.push({ index: m.index, call: src.slice(m.index, argStart + 40) });
          continue;
        }
        replacement += r.text;
        resume = r.end;
        counts["run(retrieval {…})"] = (counts["run(retrieval {…})"] ?? 0) + 1;
      } else counts[verb] = (counts[verb] ?? 0) + 1;
    } else counts[verb] = (counts[verb] ?? 0) + 1;
    out += src.slice(last, m.index) + replacement;
    last = resume;
    re.lastIndex = resume;
  }
  out += src.slice(last);
  const changed = Object.values(counts).reduce((n, c) => n + c, 0);
  return { text: changed ? out : src, changed, counts, refused };
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "out", ".loom"]);
// The codemod's own test spells the retired verbs on purpose.
const SKIP_FILES = new Set(["codemod-repo-verbs.test.ts"]);
const FROZEN_DOCS = ["docs/old", "docs/audits", "docs/new-plan"];
const EXTS = new Set([".ddd", ".md", ".ts"]);

function* walk(p) {
  const st = fs.statSync(p);
  if (st.isFile()) {
    if (EXTS.has(path.extname(p))) yield p;
    return;
  }
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name) || SKIP_FILES.has(e.name)) continue;
    const child = path.join(p, e.name);
    if (FROZEN_DOCS.some((d) => path.relative(".", child) === d)) continue;
    if (e.isDirectory()) yield* walk(child);
    else if (EXTS.has(path.extname(e.name))) yield child;
  }
}

const DEFAULT_ROOTS = () => [
  "examples",
  "web/src/examples",
  "docs",
  "test",
  ...fs.readdirSync(".").filter((d) => /^(journey|eval-)/.test(d) && fs.statSync(d).isDirectory()),
];

function main(argv) {
  const check = argv.includes("--check");
  const list = argv.includes("--list");
  const roots = argv.filter((a) => !a.startsWith("--"));
  const totals = {};
  let files = 0;
  let pending = 0;
  for (const root of roots.length ? roots : DEFAULT_ROOTS()) {
    if (!fs.existsSync(root)) continue;
    for (const file of walk(root)) {
      const src = fs.readFileSync(file, "utf8");
      const r = rewriteRepoVerbs(src, { markdown: file.endsWith(".md") });
      for (const x of r.refused) {
        const line = src.slice(0, x.index).split("\n").length;
        console.log(
          `${file}:${line}: not rewritten (a retrieval literal with 'loads:'): ${x.call}`,
        );
      }
      if (!r.changed) continue;
      files++;
      pending += r.changed;
      for (const [k, n] of Object.entries(r.counts)) totals[k] = (totals[k] ?? 0) + n;
      if (list || check) console.log(`${file}: ${r.changed}`);
      else fs.writeFileSync(file, r.text, "utf8");
    }
  }
  const by = Object.entries(totals)
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
  console.log(
    `${check || list ? "would rewrite" : "rewrote"} ${pending} call(s) in ${files} file(s)${by ? ` (${by})` : ""}`,
  );
  if (check && pending > 0) process.exit(1);
}

if (import.meta.url === `file://${path.resolve(process.argv[1] ?? "")}`)
  main(process.argv.slice(2));
