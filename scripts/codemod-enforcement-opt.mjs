// Codemod for the M-T3.1 language-default flip: `auth { enforcement: }`
// defaults to `denyByDefault` (it was `opt`).  A project that relied on the
// old default keeps its behaviour by writing `enforcement: opt` explicitly —
// this script does that for every `auth { … }` block that writes no
// `enforcement:` of its own.  See docs/migrations.md § "The `enforcement:`
// default flip (M-T3.1)".
//
//   node scripts/codemod-enforcement-opt.mjs [--check] [--list] <path>...
//
//   <path>   a `.ddd` file or a directory (walked recursively for `*.ddd`,
//            skipping node_modules / .git / dist / out).  Defaults to `.`.
//   --check  write nothing; exit 1 when any file still relies on the default
//            (the CI shape: "nothing left to migrate").
//   --list   write nothing; print the files that would change.
//
// Text-level and deliberately conservative.  It never re-parses or reprints
// the file, so formatting and comments survive byte-for-byte outside the one
// inserted clause.  It is comment- and string-aware (a commented-out `auth {`
// is not a block), idempotent (a block that already names `enforcement:` —
// either value — is left alone), and it touches ONLY the system-level
// `auth { … }` block: the deployable's `auth: required` has a colon, not a
// brace, and is the other grammar rule that uses the keyword.
//
// A system with NO `auth { … }` block is not rewritten: it has no enforcement
// posture at all, before or after the flip, so there is nothing to preserve.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "out", ".loom"]);

/** Offsets of every source character that is NOT inside a comment or a
 *  string literal, as a predicate.  `.ddd` has `//` line comments, `/* … *\/`
 *  block comments and double-quoted strings with backslash escapes. */
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

/** Every system-level `auth { … }` block in `src`: the offset of its `{` and
 *  of its matching `}`, plus whether it already names `enforcement` at its
 *  own depth. */
export function findAuthBlocks(src) {
  const code = codeMask(src);
  const blocks = [];
  let from = 0;
  for (;;) {
    const at = src.indexOf("auth", from);
    if (at < 0) break;
    from = at + 4;
    if (!code[at] || isIdent(src[at - 1]) || isIdent(src[at + 4])) continue;
    let j = at + 4;
    while (j < src.length && (/\s/.test(src[j]) || !code[j])) j++;
    if (src[j] !== "{" || !code[j]) continue;
    const open = j;
    let depth = 0;
    let close = -1;
    let hasEnforcement = false;
    for (let k = open; k < src.length; k++) {
      if (!code[k]) continue;
      const ch = src[k];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          close = k;
          break;
        }
      } else if (
        depth === 1 &&
        ch === "e" &&
        src.startsWith("enforcement", k) &&
        !isIdent(src[k - 1]) &&
        !isIdent(src[k + 11])
      ) {
        hasEnforcement = true;
      }
    }
    if (close < 0) break; // unbalanced — leave the file alone
    blocks.push({ open, close, hasEnforcement });
    from = close + 1;
  }
  return blocks;
}

/** Insert `enforcement: opt` into every `auth { … }` block of `src` that does
 *  not already name an `enforcement:`.  Returns the new text and the number
 *  of blocks it changed (0 ⇒ the text is returned unchanged). */
export function pinEnforcementOpt(src) {
  const blocks = findAuthBlocks(src).filter((b) => !b.hasEnforcement);
  let out = src;
  // Right-to-left so earlier offsets stay valid.
  for (const b of [...blocks].reverse()) {
    const lineEnd = out.indexOf("\n", b.open);
    const multiLine = lineEnd >= 0 && lineEnd < b.close;
    if (multiLine && out.slice(b.open + 1, lineEnd).trim() === "") {
      // `auth {⏎ …` — a clause line of its own, indented like the block's
      // first non-blank line (or the head's indent + two spaces).
      const headStart = out.lastIndexOf("\n", b.open) + 1;
      const headIndent = /^[\t ]*/.exec(out.slice(headStart))[0];
      const body = out.slice(lineEnd + 1, b.close);
      const firstLine = body.split("\n").find((l) => l.trim() !== "");
      const indent =
        firstLine !== undefined && !firstLine.trimStart().startsWith("}")
          ? /^[\t ]*/.exec(firstLine)[0]
          : `${headIndent}  `;
      out = `${out.slice(0, lineEnd + 1)}${indent}enforcement: opt\n${out.slice(lineEnd + 1)}`;
    } else {
      // `auth { … }` on one line (or content on the `{` line) — inline.
      const rest = out.slice(b.open + 1);
      const trimmed = rest.replace(/^[\t ]*/, "");
      const sep = trimmed.startsWith("}") ? " " : ", ";
      out = `${out.slice(0, b.open + 1)} enforcement: opt${sep}${trimmed}`;
    }
  }
  return { text: out, changed: blocks.length };
}

async function* walk(p) {
  const st = await fs.stat(p);
  if (st.isFile()) {
    if (p.endsWith(".ddd")) yield p;
    return;
  }
  for (const e of await fs.readdir(p, { withFileTypes: true })) {
    if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue;
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
  let changedBlocks = 0;
  for (const f of files) {
    const src = await fs.readFile(f, "utf8");
    const { text, changed } = pinEnforcementOpt(src);
    if (!changed) continue;
    changedFiles++;
    changedBlocks += changed;
    if (check || list) console.log(f);
    else {
      await fs.writeFile(f, text);
      console.log(`pinned enforcement: opt  ${f}`);
    }
  }
  const verb = check || list ? "would pin" : "pinned";
  console.log(
    `${verb} ${changedBlocks} auth block(s) in ${changedFiles} of ${files.length} file(s)`,
  );
  if (check && changedFiles > 0) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
