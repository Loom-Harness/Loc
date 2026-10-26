// Codemod for the hard cutover that retired the record form of an aggregate
// factory call (D-CREATE-CALL-STYLE).  An aggregate's `create` is a lifecycle
// method, called like any other method with positional or named arguments; the
// record form leaked the create-command wire record into the domain language.
// The codemod rewrites each record-form call into the NAMED call form, which
// keeps the call faithful key for key and independent of the input order:
//
//   before                                       after
//   let o = Order.create({                       let o = Order.create(
//     customerId: c,                               customerId: c,
//     total: m                                     total: m
//   })                                           )
//   let l = Line.create({ sku: "x", n: 1 })      let l = Line.create(sku: "x", n: 1)
//   let e = Empty.create({})                     let e = Empty.create()
//
//   node scripts/codemod-create-record-to-call.mjs [--check] [--list] <path>...
//
//   <path>   a `.ddd` or `.md` file or a directory (walked recursively,
//            skipping node_modules / .git / dist / out / .loom).  Defaults to
//            `.`.  In a `.md` file only fenced ```ddd blocks are rewritten.
//   --check  write nothing; exit 1 when any file still has a record-form call.
//   --list   write nothing; print the files that would change.
//
// A call is rewritten only when its receiver names an aggregate declared in
// one of the files the run reads (`aggregate <Name>`, `abstract aggregate
// <Name>`): `api.orders.create({ … })` in a `test e2e` body takes an HTTP
// request body, and a value-object brace literal `Money { … }` is no call at
// all — neither is touched.
//
// Text-level and deliberately conservative: it never re-parses or reprints a
// file, so formatting and comments survive.  It is comment- and string-aware
// and idempotent (a file with no record-form call is left byte-identical).
//
// A call is NOT rewritten — it stays where it is, with a
// `// codemod-create-record-to-call: not rewritten — <reason>` line above it,
// and the file is reported — when no faithful call form exists for it:
//   - the record is not the only argument (`Agg.create({ … }, x)`);
//   - the record names one key twice: the named form refuses a repeated name,
//     and which value the record kept depends on the backend.
// Rewrite those by hand: pass each input by name, or by position in the create
// input's order.
//
// A call whose argument is not a record LITERAL (`Agg.create(input)`) is
// already a call form and is left alone: it binds `input` to the first create
// input, and the compiler checks it there like any other positional call.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "out", ".loom"]);
const MARKER = "// codemod-create-record-to-call: not rewritten";

/** Per-offset flag: 1 when the character is code (not in a comment or a
 *  double-quoted string).  `.ddd` has `//` and `/* *\/` comments and
 *  double-quoted strings with backslash escapes. */
function codeMask(src) {
  const code = new Uint8Array(src.length);
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 2;
    } else if (c === '"') {
      i++;
      while (i < src.length && src[i] !== '"') i += src[i] === "\\" ? 2 : 1;
      i++;
    } else {
      code[i] = 1;
      i++;
    }
  }
  return code;
}

const isIdent = (ch) => ch !== undefined && /[A-Za-z0-9_]/.test(ch);

/** The offset of the bracket matching the opener at `open`, or -1. */
function matching(src, code, open) {
  const o = src[open];
  const c = o === "{" ? "}" : o === "(" ? ")" : "]";
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    if (!code[k]) continue;
    if (src[k] === o) depth++;
    else if (src[k] === c) {
      depth--;
      if (depth === 0) return k;
    }
  }
  return -1;
}

/** The first code offset at or after `from` that is not whitespace (comments
 *  are skipped as non-code). */
function nextCode(src, code, from, to = src.length) {
  for (let k = from; k < to; k++) if (code[k] && !/\s/.test(src[k])) return k;
  return to;
}

/** The aggregate names `src` declares. */
export function declaredAggregates(src) {
  const code = codeMask(src);
  const names = new Set();
  const re = /\baggregate\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (code[m.index] && !isIdent(src[m.index - 1])) names.add(m[1]);
  }
  return names;
}

/** The top-level comma offsets of the text between `open` and `close`
 *  (exclusive), ignoring commas nested in brackets, strings and comments. */
function topLevelCommas(src, code, open, close) {
  const commas = [];
  let depth = 0;
  for (let k = open + 1; k < close; k++) {
    if (!code[k]) continue;
    const ch = src[k];
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) commas.push(k);
  }
  return commas;
}

/** The start of the line holding `at`, and that line's indentation. */
function lineOf(src, at) {
  const start = src.lastIndexOf("\n", at - 1) + 1;
  const indent = /^[ \t]*/.exec(src.slice(start))[0];
  return { start, indent };
}

/** Rewrite every record-form factory call `Agg.create({ … })` in `src` whose
 *  receiver is one of `aggregates` (default: the aggregates `src` declares)
 *  into the named call form.  `changed` counts the rewritten calls; `refused`
 *  names the ones left in place (marked with a
 *  `// codemod-create-record-to-call: not rewritten — …` line). */
export function rewriteCreateRecords(src, aggregates = declaredAggregates(src)) {
  const code = codeMask(src);
  const edits = [];
  const refused = [];
  const marked = new Set();
  let changed = 0;
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*create\s*\(/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const at = m.index;
    if (!code[at] || isIdent(src[at - 1])) continue;
    // A receiver reached through a member (`api.orders.create`) is not an
    // aggregate name.
    let b = at - 1;
    while (b >= 0 && /\s/.test(src[b])) b--;
    if (src[b] === ".") continue;
    const agg = m[1];
    if (!aggregates.has(agg)) continue;
    const paren = at + m[0].length - 1;
    const close = matching(src, code, paren);
    if (close < 0) continue;
    const first = nextCode(src, code, paren + 1, close);
    if (first === close) continue; // `Agg.create()` — already a call
    const refuse = (reason) => {
      const line = lineOf(src, at);
      refused.push({ aggregate: agg, line: src.slice(0, at).split("\n").length, reason });
      const prev = src.slice(src.lastIndexOf("\n", line.start - 2) + 1, line.start);
      if (marked.has(line.start) || prev.trim().startsWith(MARKER)) return;
      marked.add(line.start);
      edits.push({
        at: line.start,
        end: line.start,
        insert: `${line.indent}${MARKER} — ${reason}\n`,
      });
    };
    // Already a call form (positional / named): nothing to do.
    if (src[first] !== "{") continue;
    const brace = first;
    const braceClose = matching(src, code, brace);
    if (braceClose < 0 || braceClose > close) continue;
    if (nextCode(src, code, braceClose + 1, close) !== close) {
      refuse(`'${agg}.create({ … }, …)' passes more than the record; rewrite it by hand`);
      continue;
    }
    const commas = topLevelCommas(src, code, brace, braceClose);
    // The keys, to refuse a repeated one.
    const keys = [];
    let from = brace + 1;
    for (const end of [...commas, braceClose]) {
      const k = nextCode(src, code, from, end);
      const km = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(src.slice(k, end));
      if (km) keys.push(km[1]);
      from = end + 1;
    }
    const dup = keys.find((k, i) => keys.indexOf(k) !== i);
    if (dup) {
      refuse(`'${agg}.create({ … })' names '${dup}' twice; pass each input once`);
      continue;
    }
    changed++;
    // A trailing comma: the call form takes none.
    const last = commas[commas.length - 1];
    if (last !== undefined && nextCode(src, code, last + 1, braceClose) === braceClose) {
      edits.push({ at: last, end: last + 1 });
    }
    // The braces go, with the spaces that padded them on their own line —
    // `({ a: 1 })` → `(a: 1)` — while a field or a `}` on a line of its own
    // keeps that line.
    const inner = src.slice(brace + 1, braceClose);
    if (inner.trim() === "") {
      edits.push({ at: paren + 1, end: close }); // `({ })` → `()`
      continue;
    }
    const lead = /^[ \t]*/.exec(inner)[0].length;
    const trail = /[ \t]*$/.exec(inner)[0].length;
    const openAlone = /^(\r?\n|\/\/|\/\*)/.test(inner.slice(lead));
    const closeAlone = /\n[ \t]*$/.test(inner);
    edits.push({ at: paren + 1, end: brace + 1 + (openAlone ? 0 : lead) });
    edits.push({ at: closeAlone ? braceClose : braceClose - trail, end: close });
  }
  if (edits.length === 0) return { text: src, changed, refused };
  let out = src;
  for (const e of [...edits].sort((a, b) => b.at - a.at || b.end - a.end)) {
    out = out.slice(0, e.at) + (e.insert ?? "") + out.slice(e.end);
  }
  return { text: out, changed, refused };
}

/** Apply `rewriteCreateRecords` to every fenced ```ddd block of a Markdown
 *  document.  A doc snippet rarely declares the aggregate it builds, so with
 *  no names given every capitalised receiver counts: in `.ddd` source a
 *  `Name.create({ … })` call on a capitalised name is an aggregate factory. */
export function rewriteMarkdown(src, aggregates) {
  const fence = /(^|\n)[ \t]*```ddd[^\n]*\n([\s\S]*?)\n[ \t]*```/g;
  const blocks = [];
  for (let m = fence.exec(src); m; m = fence.exec(src)) {
    const body = m[2];
    const start = m.index + m[0].indexOf(body, m[1].length);
    blocks.push({ start, end: start + body.length, body });
  }
  const names = aggregates ?? { has: (n) => /^[A-Z]/.test(n) };
  let out = src;
  let changed = 0;
  const refused = [];
  for (const b of blocks.reverse()) {
    const r = rewriteCreateRecords(b.body, names);
    changed += r.changed;
    refused.push(...r.refused);
    out = out.slice(0, b.start) + r.text + out.slice(b.end);
  }
  return { text: out, changed, refused };
}

async function* walk(p) {
  const st = await fs.stat(p);
  if (st.isFile()) {
    if (p.endsWith(".ddd") || p.endsWith(".md")) yield p;
    return;
  }
  for (const e of await fs.readdir(p, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name) || e.isSymbolicLink()) continue;
    yield* walk(path.join(p, e.name));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const list = args.includes("--list");
  const roots = args.filter((a) => !a.startsWith("--"));
  const files = [];
  for (const root of roots.length ? roots : ["."]) for await (const f of walk(root)) files.push(f);
  files.sort();
  // A multi-file project declares an aggregate in one file and builds it in
  // another, so the aggregate names come from every `.ddd` the run reads.
  const sources = new Map();
  const aggregates = new Set();
  for (const f of files) {
    const src = await fs.readFile(f, "utf8");
    sources.set(f, src);
    if (f.endsWith(".ddd")) for (const n of declaredAggregates(src)) aggregates.add(n);
  }
  let changedFiles = 0;
  let rewritten = 0;
  let refusedCount = 0;
  for (const f of files) {
    const src = sources.get(f);
    const { text, changed, refused } = f.endsWith(".md")
      ? rewriteMarkdown(src)
      : rewriteCreateRecords(src, aggregates);
    for (const r of refused) {
      console.log(`not rewritten  ${f}:${r.line}: ${r.aggregate}.create — ${r.reason}`);
    }
    refusedCount += refused.length;
    if (!changed && refused.length === 0) continue;
    changedFiles++;
    rewritten += changed;
    if (check || list) console.log(f);
    else if (text !== src) {
      await fs.writeFile(f, text);
      console.log(`rewrote ${changed} call(s)  ${f}`);
    }
  }
  const verb = check || list ? "would rewrite" : "rewrote";
  console.log(
    `${verb} ${rewritten} record-form create call(s) in ${changedFiles} of ${files.length} file(s); ${refusedCount} need a hand rewrite`,
  );
  if ((check && changedFiles > 0) || refusedCount > 0) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
