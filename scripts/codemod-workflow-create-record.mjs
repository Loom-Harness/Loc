// Codemod for the hard cutover that made the record form the only factory
// call in a workflow / handler body (`loom.workflow-positional-create`).  A
// positional or named `Agg.create(…)` is rewritten to the record form, the one
// the lowering creates and saves:
//
//   before                                  after
//   let s = Survey.create(e.ticket, e.note) let s = Survey.create({ ticket: e.ticket, note: e.note })
//   let a = Account.create(name: n)         let a = Account.create({ name: n })
//   let x = Counter.create()                let x = Counter.create({})
//
// A positional argument list maps onto the aggregate's create input in order:
// the parameters of its declared `create(…)` when it has one (they ARE the
// input's fields), else its declared properties minus the server-owned ones
// (`managed` / `token` / `internal`) and the `derived` ones.  That is the
// order the factory's input has on every backend.
//
//   node scripts/codemod-workflow-create-record.mjs [--check] [--list] <path>...
//
//   <path>   a `.ddd` file or a directory (walked recursively, skipping
//            node_modules / .git / dist / out / .loom).  Defaults to `.`.
//   --check  write nothing; exit 1 when any file still needs a rewrite.
//   --list   write nothing; print the files that would change.
//
// Text-level and deliberately conservative: it never re-parses or reprints a
// file, so formatting and comments survive outside the calls it rewrites.  It
// is comment- and string-aware and idempotent (a file with only record-form
// calls is left byte-identical).
//
// A call is NOT rewritten — it stays where it is, with a
// `// codemod-workflow-create-record: not rewritten — <reason>` line above it,
// the file is reported and the run exits non-zero — when no faithful record
// exists for it:
//   - a positional list whose length is not the create input's field count
//     (an omitted trailing field may be optional or defaulted, or the call may
//     be wrong; which field each position means is then a guess);
//   - an empty list on an aggregate with a required create-input field;
//   - positional and named arguments mixed in one call.
// Rewrite those by hand.  The compiler still validates the rewritten record
// (`loom.create-unknown-field`, `loom.create-field-type`, the missing-field
// gate), so anything this text-level pass cannot see is reported there.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "out", ".loom"]);
const MARKER = "// codemod-workflow-create-record: not rewritten";
const SERVER_OWNED = new Set(["managed", "token", "internal"]);

/** Per-offset flag: 1 when the character is code (not in a comment or a
 *  double-quoted string). */
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
const OPEN = { "{": "}", "(": ")", "[": "]" };

/** The offset of the bracket matching the opener at `open`, or -1. */
function matching(src, code, open) {
  const o = src[open];
  const c = OPEN[o];
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

function wordAt(src, code, at, word) {
  return (
    code[at] === 1 &&
    src.startsWith(word, at) &&
    !isIdent(src[at - 1]) &&
    !isIdent(src[at + word.length])
  );
}

/** Every `<kw> <Name> … { … }` block in `[from, to)`. */
function blocksOf(src, code, kw, from = 0, to = src.length) {
  const out = [];
  let i = from;
  while (i < to) {
    const at = src.indexOf(kw, i);
    if (at < 0 || at >= to) break;
    i = at + kw.length;
    if (!wordAt(src, code, at, kw)) continue;
    const m = /^\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(src.slice(at + kw.length));
    if (!m) continue;
    let j = at + kw.length + m[0].length;
    while (j < to && !(code[j] && src[j] === "{")) j++;
    if (j >= to) break;
    const close = matching(src, code, j);
    if (close < 0) break;
    out.push({ at, name: m[1], open: j, close });
    i = close + 1;
  }
  return out;
}

/** The depth-0 members of the block `(open, close)`, as text chunks split at
 *  newlines that sit at depth 0 (one member per line, the `.ddd` convention),
 *  each with its offset. */
function topLevelLines(src, code, open, close) {
  const lines = [];
  let depth = 0;
  let start = open + 1;
  for (let k = open + 1; k < close; k++) {
    if (code[k]) {
      if (OPEN[src[k]]) depth++;
      else if (src[k] === "}" || src[k] === ")" || src[k] === "]") depth--;
    }
    if (src[k] === "\n" && depth === 0) {
      lines.push({ at: start, text: src.slice(start, k) });
      start = k + 1;
    }
  }
  lines.push({ at: start, text: src.slice(start, close) });
  return lines;
}

/** The create input of an aggregate block: the declared unnamed `create(…)`'s
 *  parameters when there is one, else the client-writable properties.  Each
 *  field says whether it may be omitted (optional type or a default). */
function createInput(src, code, agg) {
  const lines = topLevelLines(src, code, agg.open, agg.close);
  for (const l of lines) {
    const m = /^\s*create\s*\(/.exec(l.text);
    if (!m) continue;
    const paren = l.at + m[0].length - 1;
    const close = matching(src, code, paren);
    if (close < 0) break;
    return splitArgs(src, code, paren + 1, close)
      .filter((a) => a.text.trim() !== "")
      .map((a) => {
        const p = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:([^=]*)(=)?/.exec(a.text);
        return p ? { name: p[1], omittable: !!p[3] || /\?\s*$/.test(p[2]) } : undefined;
      })
      .filter(Boolean);
  }
  const fields = [];
  for (const l of lines) {
    // Each line may carry several members on one line; take every
    // `name: Type …` that starts a member (after a newline or two spaces).
    for (const seg of l.text.split(/\s{2,}|\t/)) {
      const p = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^=]*?)\s*(=.*)?$/.exec(seg);
      if (!p || /^(derived|operation|create|destroy|function|invariant|check)$/.test(p[1])) {
        continue;
      }
      const words = p[2].split(/\s+/);
      if (words.some((w) => SERVER_OWNED.has(w))) continue;
      fields.push({ name: p[1], omittable: !!p[3] || /\?$/.test(words[0] ?? "") });
    }
  }
  return fields;
}

/** The top-level comma-separated arguments in `[from, to)`. */
function splitArgs(src, code, from, to) {
  const args = [];
  let depth = 0;
  let start = from;
  for (let k = from; k < to; k++) {
    if (!code[k]) continue;
    if (OPEN[src[k]]) depth++;
    else if (src[k] === "}" || src[k] === ")" || src[k] === "]") depth--;
    else if (src[k] === "," && depth === 0) {
      args.push({ at: start, text: src.slice(start, k) });
      start = k + 1;
    }
  }
  if (src.slice(start, to).trim() !== "" || args.length > 0) {
    args.push({ at: start, text: src.slice(start, to) });
  }
  return args;
}

/** The body spans a workflow / handler body lowers: every `create` / `on` /
 *  `handle` member body of a workflow, and every `commandHandler` /
 *  `queryHandler` body. */
function bodySpans(src, code, from, to) {
  const spans = [];
  for (const wf of blocksOf(src, code, "workflow", from, to)) {
    let depth = 0;
    for (let k = wf.open + 1; k < wf.close; k++) {
      if (!code[k]) continue;
      if (OPEN[src[k]]) depth++;
      else if (src[k] === "}" || src[k] === ")" || src[k] === "]") depth--;
      if (depth !== 0) continue;
      const kw = ["create", "on", "handle"].find((w) => wordAt(src, code, k, w));
      if (!kw) continue;
      let p = k + kw.length;
      while (p < wf.close && !(code[p] && src[p] === "(")) p++;
      const pc = p < wf.close ? matching(src, code, p) : -1;
      if (pc < 0) continue;
      let b = pc + 1;
      while (b < wf.close && !(code[b] && src[b] === "{")) b++;
      const bc = b < wf.close ? matching(src, code, b) : -1;
      if (bc < 0) continue;
      spans.push([b, bc]);
      k = bc;
    }
  }
  for (const kw of ["commandHandler", "queryHandler"]) {
    for (const h of blocksOf(src, code, kw, from, to)) spans.push([h.open, h.close]);
  }
  return spans;
}

/** Rewrite every non-record `Agg.create(…)` in a workflow / handler body of
 *  `src` to the record form.  Returns the new text, the number of calls
 *  rewritten, and the ones refused (with the reason) — refused calls stay in
 *  place, marked.  `changed === 0 && refused.length === 0` ⇒ `text === src`. */
export function rewriteFactoryCalls(src) {
  const code = codeMask(src);
  /** @type {{ at: number, end: number, text: string }[]} */
  const edits = [];
  const refused = [];
  let changed = 0;
  const contexts = blocksOf(src, code, "context");
  const scopes = contexts.length > 0 ? contexts : [{ open: -1, close: src.length }];
  for (const ctx of scopes) {
    const aggs = new Map(
      blocksOf(src, code, "aggregate", ctx.open + 1, ctx.close).map((a) => [a.name, a]),
    );
    const markedLines = new Set();
    for (const [from, to] of bodySpans(src, code, ctx.open + 1, ctx.close)) {
      const re = /([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*create\s*\(/g;
      re.lastIndex = from;
      for (let m = re.exec(src); m && m.index < to; m = re.exec(src)) {
        if (!code[m.index] || isIdent(src[m.index - 1]) || src[m.index - 1] === ".") continue;
        const agg = aggs.get(m[1]);
        if (!agg) continue;
        const paren = m.index + m[0].length - 1;
        const close = matching(src, code, paren);
        if (close < 0) continue;
        re.lastIndex = close;
        const args = splitArgs(src, code, paren + 1, close);
        if (args.length === 1 && /^\s*\{/.test(args[0].text) && /\}\s*$/.test(args[0].text)) {
          continue; // already the record form
        }
        const named = args.map((a) =>
          /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:(?!:)/.exec(a.text) ? true : false,
        );
        const input = createInput(src, code, agg);
        let record;
        let why;
        if (args.length === 0) {
          const required = input.filter((f) => !f.omittable).map((f) => f.name);
          if (required.length > 0) {
            why = `'${m[1]}.create()' leaves out required field(s) ${required.map((f) => `'${f}'`).join(", ")}`;
          } else record = "{}";
        } else if (named.every(Boolean)) {
          record = `{ ${args.map((a) => a.text.trim()).join(", ")} }`;
        } else if (named.some(Boolean)) {
          why = "it mixes positional and named arguments";
        } else if (args.length !== input.length) {
          why = `${args.length} positional argument(s), but '${m[1]}' has ${input.length} create-input field(s) (${input.map((f) => f.name).join(", ")}) — which field each one means is a guess`;
        } else {
          record = `{ ${args.map((a, i) => `${input[i].name}: ${a.text.trim()}`).join(", ")} }`;
        }
        if (record !== undefined) {
          edits.push({ at: paren + 1, end: close, text: record });
          changed++;
          continue;
        }
        refused.push({ aggregate: m[1], call: src.slice(m.index, close + 1), reason: why });
        const lineStart = src.lastIndexOf("\n", m.index - 1) + 1;
        const prevStart = src.lastIndexOf("\n", lineStart - 2) + 1;
        if (markedLines.has(lineStart) || src.slice(prevStart, lineStart).includes(MARKER)) {
          continue;
        }
        markedLines.add(lineStart);
        const indent = /^[\t ]*/.exec(src.slice(lineStart))[0];
        edits.push({ at: lineStart, end: lineStart, text: `${indent}${MARKER} — ${why}\n` });
      }
    }
  }
  if (edits.length === 0) return { text: src, changed, refused };
  let out = src;
  for (const e of [...edits].sort((a, b) => b.at - a.at || b.end - a.end)) {
    out = out.slice(0, e.at) + e.text + out.slice(e.end);
  }
  return { text: out, changed, refused };
}

async function* walk(p) {
  const st = await fs.stat(p);
  if (st.isFile()) {
    if (p.endsWith(".ddd")) yield p;
    return;
  }
  for (const e of await fs.readdir(p, { withFileTypes: true })) {
    // A symlink is not followed: a linked `node_modules` can loop.
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
  let changedFiles = 0;
  let rewritten = 0;
  let refusedCount = 0;
  for (const f of files) {
    const src = await fs.readFile(f, "utf8");
    const { text, changed, refused } = rewriteFactoryCalls(src);
    for (const r of refused) console.log(`not rewritten  ${f}: ${r.call} — ${r.reason}`);
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
    `${verb} ${rewritten} factory call(s) in ${changedFiles} of ${files.length} file(s); ${refusedCount} need a hand rewrite`,
  );
  if ((check && changedFiles > 0) || refusedCount > 0) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
