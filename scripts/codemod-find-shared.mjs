// Shared plumbing for the repository-`find` codemods: snippet discovery and
// parsing (`.ddd` files, ```ddd fences in `.md`, template literals in `.ts`),
// textual splicing, and the find → criterion helpers.  Pure functions over
// source text and the parsed AST; no file system access except `walkFiles`.
//
// `codemod-find-to-findby.mjs` reads these; `codemod-list-find-to-criterion.mjs`
// carries its own copies of the same functions.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { AstUtils, EmptyFileSystem } from "langium";
import { createDddServices } from "../out/language/ddd-module.js";

export const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "out", ".loom"]);

let parserSingleton;
function parser() {
  parserSingleton ??= createDddServices(EmptyFileSystem).Ddd.parser.LangiumParser;
  return parserSingleton;
}

/** `__PLATFORM__` corpus placeholders, replaced by a same-length keyword so
 *  every offset in the parsed text is an offset in the original. */
function maskPlaceholders(src) {
  return src.replace(/__PLATFORM__/g, "node        ");
}

/** Parse `src` as a model; failing that, as the members of a context.
 *  Returns the AST and the offset of `src` inside the parsed text. */
export function parseSnippet(src) {
  const masked = maskPlaceholders(src);
  const whole = parser().parse(masked);
  if (whole.parserErrors.length === 0 && whole.lexerErrors.length === 0) {
    return { ast: whole.value, shift: 0 };
  }
  const head = "context __Codemod {\n";
  const wrapped = parser().parse(`${head}${masked}\n}`);
  if (wrapped.parserErrors.length === 0 && wrapped.lexerErrors.length === 0) {
    return { ast: wrapped.value, shift: head.length };
  }
  return undefined;
}

export function lineStart(text, offset) {
  return text.lastIndexOf("\n", offset - 1) + 1;
}

export function indentAt(text, offset) {
  return /^[\t ]*/.exec(text.slice(lineStart(text, offset)))[0];
}

/** The removal range of a declaration spanning [start, end): its own lines,
 *  plus the contiguous `//` comment lines directly above it (they describe it,
 *  so they go — or move — with it).  Returns [start, end, comment lines]. */
export function removalRange(text, start, end) {
  const ls = lineStart(text, start);
  const onlyWsBefore = text.slice(ls, start).trim() === "";
  let le = text.indexOf("\n", end);
  if (le < 0) le = text.length;
  const tail = text.slice(end, le).trim();
  const onlyWsAfter = tail === "" || tail.startsWith("//");
  if (!onlyWsBefore || !onlyWsAfter) return [start, end, []];
  let cs = ls;
  for (;;) {
    if (cs === 0) break;
    const prevStart = lineStart(text, cs - 1);
    const line = text.slice(prevStart, cs - 1);
    if (!line.trim().startsWith("//")) break;
    cs = prevStart;
  }
  const comment = text
    .slice(cs, ls)
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => l.trim());
  if (tail) comment.push(tail);
  return [cs, Math.min(le + 1, text.length), comment];
}

export function applyEdits(text, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  for (const e of sorted) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/** A repository body the codemod emptied (it spans lines, or kept both
 *  spaces around a one-line find) collapses to `{ }`; a body written `{}` is
 *  left as written. */
export function tidyEmptyRepos(text) {
  return text.replace(/(\brepository\s+\w+\s+for\s+\w+\s*)\{(?:[ \t]*\n\s*|[ \t]{2,})\}/g, "$1{ }");
}

/** The snippets of one file: [start, end) ranges of migratable source. */
export function snippetsOf(file, src) {
  if (file.endsWith(".ddd")) return [[0, src.length]];
  if (file.endsWith(".md")) {
    const out = [];
    const re = /```ddd[^\n]*\n([\s\S]*?)```/g;
    for (let m = re.exec(src); m; m = re.exec(src)) {
      const start = m.index + m[0].indexOf("\n") + 1;
      out.push([start, start + m[1].length]);
    }
    return out;
  }
  if (file.endsWith(".ts")) return templateLiterals(src);
  return [];
}

/** Template-literal bodies of a TS source. */
function templateLiterals(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      i = e < 0 ? src.length : e + 2;
    } else if (c === '"' || c === "'") {
      i++;
      while (i < src.length && src[i] !== c && src[i] !== "\n") i += src[i] === "\\" ? 2 : 1;
      i++;
    } else if (c === "`") {
      const start = i + 1;
      let j = start;
      let depth = 0;
      while (j < src.length) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (depth === 0 && src[j] === "`") break;
        if (src[j] === "$" && src[j + 1] === "{") {
          depth++;
          j += 2;
          continue;
        }
        if (depth > 0 && src[j] === "}") depth--;
        j++;
      }
      out.push([start, j]);
      i = j + 1;
    } else i++;
  }
  return out;
}

/** Same-length mask of `${…}` holes, so the snippet parses without them. */
export function maskHoles(snippet) {
  const holes = [];
  let out = "";
  let i = 0;
  while (i < snippet.length) {
    if (snippet[i] === "$" && snippet[i + 1] === "{") {
      let depth = 1;
      let j = i + 2;
      while (j < snippet.length && depth > 0) {
        if (snippet[j] === "{") depth++;
        else if (snippet[j] === "}") depth--;
        j++;
      }
      holes.push([i, j]);
      out += " ".repeat(j - i);
      i = j;
    } else {
      out += snippet[i];
      i++;
    }
  }
  return { masked: out, holes };
}

/** Parse every migratable snippet of `sources`.  `mayMatter(raw)` is a cheap
 *  prefilter on a snippet's text. */
export function parseSources(sources, mayMatter) {
  const parsed = [];
  for (const { file, text } of sources) {
    const snippets = [];
    for (const [s, e] of snippetsOf(file, text)) {
      const raw = text.slice(s, e);
      if (!mayMatter(raw)) continue;
      const { masked, holes } = file.endsWith(".ts") ? maskHoles(raw) : { masked: raw, holes: [] };
      const p = parseSnippet(masked);
      if (!p) continue;
      snippets.push({ file, start: s, raw, masked, holes, ...p });
    }
    parsed.push({ file, text, snippets });
  }
  return parsed;
}

/** The aggregate node named `name` in this snippet. */
export function aggregateOf(ast, name) {
  for (const n of AstUtils.streamAst(ast)) if (n.$type === "Aggregate" && n.name === name) return n;
  return undefined;
}

/** The aggregate's `extends` chain, root-most first, resolved by name (a
 *  snippet is parsed without a document, so references do not link). */
export function aggregateChain(ast, agg) {
  const chain = [];
  const seen = new Set();
  for (let a = agg; a && !seen.has(a); a = aggregateOf(ast, a.superType?.$refText ?? "")) {
    seen.add(a);
    chain.unshift(a);
  }
  return chain;
}

/** Field names of an aggregate and its bases. */
export function aggregateFieldNames(ast, agg) {
  const out = new Set();
  for (const a of aggregateChain(ast, agg))
    for (const m of a.members ?? []) if (typeof m.name === "string") out.add(m.name);
  return out;
}

/** The criterion body a filterless find meant: the parameter-name convention
 *  every backend applies (a parameter equal to the same-named field, or to the
 *  field named by stripping an `Id` suffix). */
export function conventionBody(fd, fields) {
  const terms = [];
  for (const p of fd.params) {
    const name = p.name;
    if (fields.has(name)) terms.push(`this.${name} == ${name}`);
    else if (name.endsWith("Id") && fields.has(name.slice(0, -2)))
      terms.push(`this.${name.slice(0, -2)} == ${name}`);
  }
  return terms.join(" && ");
}

/** The criterion a find's `where` names outright — `where C` with no params,
 *  or `where C(p1, …, pn)` over exactly the find's params in order — else
 *  undefined. */
export function reusedCriterion(fd, ctx) {
  const f = fd.filter;
  if (!f || !ctx) return undefined;
  const isCriterion = (n) => ctx.members.some((m) => m.$type === "Criterion" && m.name === n);
  const params = fd.params.map((p) => p.name);
  if (f.$type === "NameRef") return params.length === 0 && isCriterion(f.name) ? f.name : undefined;
  if (f.$type !== "PostfixChain" || f.head?.$type !== "NameRef" || f.suffixes.length !== 1)
    return undefined;
  const call = f.suffixes[0];
  if (call.$type !== "CallSuffix" || !isCriterion(f.head.name)) return undefined;
  const args = (call.args ?? []).map((a) =>
    a.name ? undefined : a.value?.$type === "NameRef" ? a.value.name : undefined,
  );
  if (args.length !== params.length || args.some((a, i) => a !== params[i])) return undefined;
  return f.head.name;
}

/** A find's trailing `ignoring …` clause as written, or "". */
export function ignoringText(fd) {
  const t = fd.$cstNode.text;
  const at = t.search(/\bignoring\b/);
  return at < 0 ? "" : t.slice(at).trim();
}

export async function* walkFiles(p) {
  const st = await fs.stat(p);
  if (st.isFile()) {
    if (/\.(ddd|md|ts)$/.test(p)) yield p;
    return;
  }
  for (const e of await fs.readdir(p, { withFileTypes: true })) {
    if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue;
    yield* walkFiles(path.join(p, e.name));
  }
}
