// Codemod for the hard cutover that removed `requires` from repository finds.
// "Who may read aggregate X" is now one line in the context's policy block:
//
//   before                                          after
//   repository Orders for Order {                   repository Orders for Order {
//     find all(): Order[] requires G                  find all(): Order[]
//     find byId(id: Order id): Order? requires G      find byId(id: Order id): Order?
//   }                                               }
//                                                   policy { read Order requires G }
//
// and that one gate covers every read of X (the list and by-id routes, each
// find's route, the audit history read, the scaffolded List page).
//
//   node scripts/codemod-find-gate-to-policy.mjs [--check] [--list] [--embedded] <path>...
//
//   <path>      a file or a directory (walked recursively, skipping
//               node_modules / .git / dist / out / .loom).  Defaults to `.`.
//   --embedded  also rewrite `.ts` / `.tsx` / `.mjs` / `.md` / `.yml` files —
//               `.ddd` written inline in tests, docs and CI heredocs.  Without
//               it only `*.ddd` files are walked.
//   --check     write nothing; exit 1 when any file still has a find gate.
//   --list      write nothing; print the files that would change.
//
// Text-level and deliberately conservative: it never re-parses or reprints a
// file, so formatting and comments survive outside the clauses it moves.  It is
// comment- and string-aware and idempotent (a file with no `find … requires`
// is left byte-identical; a `read X requires` the context already has is not
// duplicated).
//
// What it does, per `repository R for X { … }`:
//   1. removes the `requires <gate>` clause from every find;
//   2. deletes a find that is then exactly what the compiler injects —
//      `find all(): X paged` with no `where` / `ignoring`.  Any other find
//      (a `find all(): X[]` keeps its unpaged shape; a `find byId(…)` keeps its
//      own `/by_id` route) stays, so the wire surface is unchanged;
//   3. inserts `policy { read X requires <gate> }` right after the repository.
//
// A repository whose finds carried DIFFERENT gates cannot be expressed one to
// one any more — the policy gate is per aggregate.  The codemod keeps the
// gate of the list read `all` (else the first one), writes a
// `// codemod-find-gate-to-policy: …` comment naming the dropped gates above
// the inserted line, and reports the file, so the author reviews the merge.
// A find that had NO gate beside gated ones is now gated too (the policy gate
// covers every read) — the conservative direction.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "out", ".loom"]);
const EMBEDDED_EXTS = [".ts", ".tsx", ".mjs", ".md", ".yml", ".yaml"];

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
      while (i < src.length && src[i] !== '"' && src[i] !== "\n") i += src[i] === "\\" ? 2 : 1;
      i++;
    } else {
      code[i] = 1;
      i++;
    }
  }
  return code;
}

const isIdent = (ch) => ch !== undefined && /[A-Za-z0-9_]/.test(ch);

/** True when `word` starts at `k` as a whole code token. */
function wordAt(src, code, k, word) {
  return (
    code[k] === 1 &&
    src.startsWith(word, k) &&
    !isIdent(src[k - 1]) &&
    !isIdent(src[k + word.length])
  );
}

const REPO_HEAD = /\brepository\s+([A-Za-z_][A-Za-z0-9_]*)\s+for\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;

/** Operators that cannot end an expression — a gate line ending in one
 *  continues on the next line. */
const CONTINUES = /(\|\||&&|==|!=|<=|>=|[<>+\-*/(,.!])\s*$/;

/** Every `repository R for X { … }` block: name, aggregate, brace offsets. */
export function findRepositories(src) {
  const code = codeMask(src);
  const out = [];
  REPO_HEAD.lastIndex = 0;
  for (let m = REPO_HEAD.exec(src); m; m = REPO_HEAD.exec(src)) {
    if (!code[m.index]) continue;
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let k = open; k < src.length; k++) {
      if (!code[k]) continue;
      if (src[k] === "{") depth++;
      else if (src[k] === "}" && --depth === 0) {
        close = k;
        break;
      }
    }
    if (close < 0) break;
    out.push({ start: m.index, open, close, name: m[1], aggregate: m[2] });
    REPO_HEAD.lastIndex = close + 1;
  }
  return out;
}

/** The finds of one repository body, each with its `requires` clause span
 *  (when it has one).  Offsets are absolute. */
function findsIn(src, code, open, close) {
  const starts = [];
  let depth = 0;
  for (let k = open + 1; k < close; k++) {
    if (!code[k]) continue;
    const ch = src[k];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (depth === 0 && wordAt(src, code, k, "find")) starts.push(k);
  }
  return starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : close;
    const find = { start, end, name: /find\s+(\w+)/.exec(src.slice(start))?.[1] ?? "" };
    let d = 0;
    for (let k = start; k < end; k++) {
      if (!code[k]) continue;
      const ch = src[k];
      if (ch === "(" || ch === "[" || ch === "{") d++;
      else if (ch === ")" || ch === "]" || ch === "}") d--;
      else if (d === 0 && wordAt(src, code, k, "requires")) {
        find.requiresAt = k;
        let ge = gateEnd(src, code, k + "requires".length, end);
        // The whitespace after the gate belongs to what follows it.
        while (ge > k && /\s/.test(src[ge - 1])) ge--;
        find.gateEnd = ge;
        break;
      }
    }
    return find;
  });
}

/** Where the gate expression that starts at `from` ends: before a depth-0
 *  `where` / `ignoring`, a comment, or a newline that does not continue it. */
function gateEnd(src, code, from, limit) {
  let d = 0;
  for (let k = from; k < limit; k++) {
    if (!code[k]) {
      // A comment ends the gate; a string literal is part of it.
      if (src[k] === "/" && (src[k + 1] === "/" || src[k + 1] === "*") && d === 0) return k;
      continue;
    }
    const ch = src[k];
    if (ch === "(" || ch === "[" || ch === "{") d++;
    else if (ch === ")" || ch === "]" || ch === "}") d--;
    else if (d === 0 && (wordAt(src, code, k, "where") || wordAt(src, code, k, "ignoring"))) {
      return k;
    } else if (d === 0 && ch === "\n") {
      if (!CONTINUES.test(src.slice(from, k))) return k;
    }
  }
  return limit;
}

const norm = (s) => s.replace(/\s+/g, " ").trim();

/** The `{ … }` span that encloses offset `at` (the whole text when none). */
function enclosingBlock(src, at) {
  const code = codeMask(src);
  let depth = 0;
  let open = -1;
  for (let k = at - 1; k >= 0; k--) {
    if (!code[k]) continue;
    if (src[k] === "}") depth++;
    else if (src[k] === "{") {
      if (depth === 0) {
        open = k;
        break;
      }
      depth--;
    }
  }
  if (open < 0) return [0, src.length];
  depth = 0;
  for (let k = open; k < src.length; k++) {
    if (!code[k]) continue;
    if (src[k] === "{") depth++;
    else if (src[k] === "}" && --depth === 0) return [open, k];
  }
  return [open, src.length];
}

/** Move every `find … requires G` into `policy { read X requires G }`.
 *  Returns the new text, how many find gates moved, and the repositories
 *  whose finds carried differing gates (merged — see the header). */
export function moveFindGates(src) {
  const repos = findRepositories(src);
  let out = src;
  let changed = 0;
  const conflicts = [];
  // Right-to-left so earlier offsets stay valid.
  for (const repo of [...repos].reverse()) {
    const code = codeMask(out);
    const finds = findsIn(out, code, repo.open, repo.close);
    const gated = finds.filter((f) => f.requiresAt !== undefined);
    if (gated.length === 0) continue;
    changed += gated.length;
    const gates = gated.map((f) => ({
      find: f.name,
      text: norm(out.slice(f.requiresAt + "requires".length, f.gateEnd)),
    }));
    const chosen = (gates.find((g) => g.find === "all") ?? gates[0]).text;
    const dropped = [...new Set(gates.map((g) => g.text))].filter((t) => t !== chosen);
    if (dropped.length > 0) conflicts.push({ repository: repo.name, aggregate: repo.aggregate });

    // Rewrite the body: each gated find loses its clause; a find left as the
    // injected `find all(): X paged` is deleted, line and all.
    let body = out.slice(repo.open + 1, repo.close);
    const base = repo.open + 1;
    for (const f of [...finds].reverse()) {
      let s = f.start - base;
      const e = f.end - base;
      let text = body.slice(s, e);
      if (f.requiresAt !== undefined) {
        const rs = f.requiresAt - f.start;
        const re = f.gateEnd - f.start;
        const before = text.slice(0, rs);
        const after = text.slice(re);
        const lineStart = before.lastIndexOf("\n") + 1;
        if (before.slice(lineStart).trim() === "" && /^[\t ]*(\n|$)/.test(after)) {
          // `requires G` is a line of its own: drop the line.
          text = before.slice(0, lineStart) + after.replace(/^[\t ]*\n?/, "");
        } else if (before.slice(lineStart).trim() === "") {
          // `requires G where F` on its own line: keep the line's indent.
          text = before + after.replace(/^[\t ]*/, "");
        } else {
          // Keep the run that separated the gate from what follows it (the
          // next find on the same line, or the repository's `}`).
          const tail = after.replace(/^[\t ]*/, "");
          text =
            before.replace(/[\t ]+$/, "") +
            (tail === "" ? after : tail.startsWith("\n") ? tail : ` ${tail}`);
        }
      }
      // The find's own declaration (up to its line end / trailing comment).
      const decl = text
        .split("\n")[0]
        .replace(/\/\/.*$/, "")
        .trim();
      const injected = new RegExp(`^find\\s+all\\s*\\(\\s*\\)\\s*:\\s*${repo.aggregate}\\s+paged$`);
      if (injected.test(decl) && !/\b(where|ignoring)\b/.test(text.replace(/\/\/.*$/gm, ""))) {
        // Delete the declaration line (keep what follows the find's line).
        const nl = text.indexOf("\n");
        const rest = nl < 0 ? "" : text.slice(nl + 1);
        let ls = body.lastIndexOf("\n", s - 1) + 1;
        if (body.slice(ls, s).trim() === "") {
          s = ls;
          // The `//` comment lines directly above describe the deleted find.
          while (ls > 0) {
            const prev = body.lastIndexOf("\n", ls - 2) + 1;
            if (
              !body
                .slice(prev, ls - 1)
                .trim()
                .startsWith("//")
            )
              break;
            ls = prev;
          }
          s = ls;
        }
        text = rest;
      }
      body = body.slice(0, s) + text + body.slice(e);
    }
    if (body.trim() === "") body = "";

    // Insert the policy line after the repository, unless its enclosing block
    // (the context) already gates this aggregate.
    const lineStart = out.lastIndexOf("\n", repo.start) + 1;
    const indent = /^[\t ]*/.exec(out.slice(lineStart))[0];
    const [scopeFrom, scopeTo] = enclosingBlock(out, repo.start);
    const already = new RegExp(`\\bread\\s+${repo.aggregate}\\s+requires\\b`).test(
      out.slice(scopeFrom, scopeTo),
    );
    const note =
      dropped.length > 0
        ? `\n${indent}// codemod-find-gate-to-policy: the finds of ${repo.aggregate} had different gates; ` +
          `kept the list read's. Dropped: ${dropped.map((d) => `\`${d}\``).join(", ")}. Review.`
        : "";
    const policy = already
      ? ""
      : `${note}\n${indent}policy { read ${repo.aggregate} requires ${chosen} }`;
    out = `${out.slice(0, repo.open + 1)}${body}${out.slice(repo.close, repo.close + 1)}${policy}${out.slice(repo.close + 1)}`;
  }
  return { text: out, changed, conflicts };
}

async function* walk(p, exts) {
  const st = await fs.stat(p);
  if (st.isFile()) {
    if (exts.some((e) => p.endsWith(e))) yield p;
    return;
  }
  for (const e of await fs.readdir(p, { withFileTypes: true })) {
    if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue;
    yield* walk(path.join(p, e.name), exts);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const list = args.includes("--list");
  const exts = args.includes("--embedded") ? [".ddd", ...EMBEDDED_EXTS] : [".ddd"];
  const roots = args.filter((a) => !a.startsWith("--"));
  const files = [];
  for (const root of roots.length ? roots : ["."])
    for await (const f of walk(root, exts)) files.push(f);
  files.sort();
  let changedFiles = 0;
  let movedGates = 0;
  for (const f of files) {
    const src = await fs.readFile(f, "utf8");
    const { text, changed, conflicts } = moveFindGates(src);
    if (!changed) continue;
    changedFiles++;
    movedGates += changed;
    for (const c of conflicts) {
      console.warn(`REVIEW ${f}: ${c.repository}'s finds had different gates (merged into one)`);
    }
    if (check || list) console.log(f);
    else {
      await fs.writeFile(f, text);
      console.log(`moved ${changed} find gate(s)  ${f}`);
    }
  }
  const verb = check || list ? "would move" : "moved";
  console.log(`${verb} ${movedGates} find gate(s) in ${changedFiles} of ${files.length} file(s)`);
  if (check && changedFiles > 0) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
