// Codemod for natural-key reads (D-REPO-KEY-LOOKUP).
//
// A single-row repository `find` whose `where` is an equality conjunction over a
// declared `unique (…)` tuple is a natural-key read: its declaration is deleted
// and each `Repo.<find>(args)` call site reads through the contract instead —
// `findBy` for an absence-returning find (`T?`, `T option`), `getBy` for a
// row-or-404 one (`T`, `T envelope`):
//
//   aggregate Product { sku: string  unique (sku) }
//   repository Products for Product {          repository Products for Product { }
//     find bySku(s: string): Product?    →
//       where this.sku == s
//   }
//   … Products.bySku(x) …                →     … Products.findBy(sku: x) …
//
// A clause-less find binds each parameter to the field it names (the field of
// the same name, or the one its `<field>Id` spelling names — the convention
// every backend applies), so it counts as that equality conjunction.  A find's
// `ignoring …` moves to each call site.
//
//   node scripts/codemod-find-to-findby.mjs [--check] [--list] [--add-unique] <path>...
//
//   <path>        a `.ddd`, `.md` or `.ts` file, or a directory (walked
//                 recursively, skipping node_modules / .git / dist / out /
//                 .loom).  Defaults to `.`.
//   --check       write nothing; exit 1 when any find would be migrated.
//   --list        write nothing; print the files that would change.
//   --add-unique  a find whose key matches no declared tuple gets one: the
//                 codemod adds `unique (<key>)` to the aggregate (which also
//                 derives the DB unique index and the 409 on a duplicate) and
//                 migrates the find.  Without it the find is reported.
//
// `.ddd` files are rewritten whole.  In `.md` files every ```ddd fence is a
// snippet, and in `.ts` files every template literal is one; a snippet that
// does not parse as a model, nor as the member list of a context, is left
// alone.  Splices are textual, so formatting and comments outside the rewritten
// find and call survive byte-for-byte.  Idempotent: a migrated source has no
// matching find left.
//
// What it does not rewrite is reported, never guessed:
//   - a `T or <Error>` find — the 2026-10-25 ruling drops it (a miss is `T?`,
//     a `getBy` miss the standard 404), so its call sites need a human;
//   - a find whose `where` is not an equality conjunction over plain fields;
//   - a find whose key is the aggregate's `id` (the by-id read: `getById` /
//     `findById`, which the read-gate surface treats specially);
//   - a find whose key matches no declared `unique (…)` tuple (unless
//     `--add-unique`);
//   - a find something other than a repository call reads — a client route
//     read (`api.<plural>.<find>(…)` in a `test e2e`), a page read
//     (`<Ctx>.<Agg>.<find>`) — since its route goes with the declaration;
//   - a find with `ignoring` called where the clause cannot follow (anywhere
//     but a `let` / `if let` source).
//
// Needs the compiled toolchain (`npm run build`) for the parser.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { AstUtils, EmptyFileSystem } from "langium";
import { createDddServices } from "../out/language/ddd-module.js";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "out", ".loom"]);

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

/** Parse `src` as a model; failing that, as the members of a context. */
function parseSnippet(src) {
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

/** `findBy` / `getBy` / `list` / `union` / `undefined` for a find's return. */
function findShape(fd) {
  const rt = fd.returnType;
  if (!rt || fd.name === "all") return undefined;
  if (rt.array || (rt.ctors ?? []).includes("paged")) return "list";
  if ((rt.alternatives ?? []).length > 0) return "union";
  if (rt.optional || (rt.ctors ?? []).includes("option")) return "findBy";
  return "getBy";
}

/** The aggregate node a repository targets, in this snippet. */
function aggregateOf(ast, name) {
  for (const n of AstUtils.streamAst(ast)) if (n.$type === "Aggregate" && n.name === name) return n;
  return undefined;
}

/** The aggregate's `extends` chain, root-most first, resolved by name (the
 *  snippet is parsed without a document, so references do not link). */
function aggregateChain(ast, agg) {
  const chain = [];
  const seen = new Set();
  for (let a = agg; a && !seen.has(a); a = aggregateOf(ast, a.superType?.$refText ?? "")) {
    seen.add(a);
    chain.unshift(a);
  }
  return chain;
}

function aggregateFieldNames(ast, agg) {
  const out = new Set();
  for (const a of aggregateChain(ast, agg)) {
    for (const m of a.members ?? []) if (typeof m.name === "string") out.add(m.name);
  }
  return out;
}

/** Declared `unique (…)` tuples, inherited ones included. */
function declaredTuples(ast, agg) {
  const out = [];
  for (const a of aggregateChain(ast, agg))
    for (const m of a.members ?? []) if (m.$type === "Unique") out.push([...m.columns]);
  return out;
}

function unparen(e) {
  while (e?.$type === "ParenExpr") e = e.expr ?? e.inner ?? e.value;
  return e;
}

/** The field an operand reads: `this.<f>` or a bare `<f>` that is not a
 *  parameter. */
function fieldOperand(e, params) {
  e = unparen(e);
  if (e?.$type === "NameRef" && !params.has(e.name)) return e.name;
  if (
    e?.$type === "PostfixChain" &&
    e.head?.$type === "ThisRef" &&
    e.suffixes.length === 1 &&
    e.suffixes[0].$type === "MemberSuffix" &&
    !e.suffixes[0].call
  )
    return e.suffixes[0].member;
  return undefined;
}

function paramOperand(e, params) {
  e = unparen(e);
  return e?.$type === "NameRef" && params.has(e.name) ? e.name : undefined;
}

/** The (param → field) pairs a `where` spells as `f == p && …`, or undefined
 *  when it has any other shape. */
function equalityPairs(filter, params) {
  const out = [];
  const visit = (e) => {
    e = unparen(e);
    if (e?.$type !== "BinaryChain") return false;
    if (e.ops.every((o) => o === "&&")) return [e.head, ...e.rest].every(visit);
    if (e.ops.length !== 1 || e.ops[0] !== "==") return false;
    const [l, r] = [e.head, e.rest[0]];
    const lf = fieldOperand(l, params);
    const rp = paramOperand(r, params);
    if (lf && rp) {
      out.push([rp, lf]);
      return true;
    }
    const rf = fieldOperand(r, params);
    const lp = paramOperand(l, params);
    if (rf && lp) {
      out.push([lp, rf]);
      return true;
    }
    return false;
  };
  return visit(filter) ? out : undefined;
}

/** The (param → field) pairs a clause-less find binds by name. */
function conventionPairs(fd, fields) {
  const out = [];
  for (const p of fd.params) {
    if (p.name === "id" || fields.has(p.name)) out.push([p.name, p.name]);
    else if (p.name.endsWith("Id") && fields.has(p.name.slice(0, -2)))
      out.push([p.name, p.name.slice(0, -2)]);
    else return undefined;
  }
  return out;
}

function lineStart(text, offset) {
  return text.lastIndexOf("\n", offset - 1) + 1;
}

function indentAt(text, offset) {
  return /^[\t ]*/.exec(text.slice(lineStart(text, offset)))[0];
}

/** The removal range of a find: its own lines plus the contiguous `//`
 *  comment lines directly above it (they describe the find). */
function findRemovalRange(text, start, end) {
  const ls = lineStart(text, start);
  const onlyWsBefore = text.slice(ls, start).trim() === "";
  let le = text.indexOf("\n", end);
  if (le < 0) le = text.length;
  const tail = text.slice(end, le).trim();
  const onlyWsAfter = tail === "" || tail.startsWith("//");
  if (!onlyWsBefore || !onlyWsAfter) return [start, end];
  let cs = ls;
  for (;;) {
    if (cs === 0) break;
    const prevStart = lineStart(text, cs - 1);
    const line = text.slice(prevStart, cs - 1);
    if (!line.trim().startsWith("//")) break;
    cs = prevStart;
  }
  return [cs, Math.min(le + 1, text.length)];
}

function ignoringText(fd) {
  const t = fd.$cstNode.text;
  const at = t.search(/\bignoring\b/);
  return at < 0 ? "" : t.slice(at).trim();
}

/** Every find name something other than a `Repo.<find>(…)` call reads in this
 *  snippet: `api.<plural>.<find>(…)`, `<Ctx>.<Agg>.<find>`. */
function nonCallReads(ast) {
  const out = new Map();
  for (const n of AstUtils.streamAst(ast)) {
    if (n.$type !== "PostfixChain" || n.head?.$type !== "NameRef") continue;
    for (let i = 1; i < n.suffixes.length; i++) {
      const s = n.suffixes[i];
      if (s.$type === "MemberSuffix" && !out.has(s.member))
        out.set(s.member, n.$cstNode.text.split("\n")[0]);
    }
  }
  return out;
}

/** Plan the finds of one snippet: which migrate (with their call-site
 *  rewrite) and which are reported. */
function planFinds(ast, text, shift, known, report, where, addUnique) {
  const edits = [];
  const routeReads = nonCallReads(ast);
  const uniquesToAdd = new Map();
  for (const repo of AstUtils.streamAst(ast)) {
    if (repo.$type !== "Repository") continue;
    const aggName = repo.aggregate?.$refText ?? "";
    const agg = aggregateOf(ast, aggName);
    for (const fd of repo.finds) {
      const shape = findShape(fd);
      if (!shape || shape === "list") continue;
      const label = `${where}: ${repo.name}.${fd.name}`;
      if (shape === "union") {
        report.push(
          `${label} — '${fd.returnType.$cstNode.text}' returns a declared error: dropped (2026-10-25 ruling — a miss is T?, a getBy miss the standard 404); migrate its call sites by hand to findBy / getBy`,
        );
        continue;
      }
      if (!agg) {
        report.push(`${label} — its aggregate '${aggName}' is not in this source; migrate by hand`);
        continue;
      }
      const fields = aggregateFieldNames(ast, agg);
      const params = new Set(fd.params.map((p) => p.name));
      const pairs = fd.filter ? equalityPairs(fd.filter, params) : conventionPairs(fd, fields);
      if (!pairs || pairs.length === 0) {
        report.push(
          `${label} — its ${fd.filter ? "'where' is not an equality conjunction over fields" : "parameters bind no key"}; it is a query, not a key lookup (a criterion + Repo.find(C) / run)`,
        );
        continue;
      }
      const boundParams = new Set(pairs.map(([p]) => p));
      const keyCols = [...new Set(pairs.map(([, f]) => f))];
      if (
        boundParams.size !== fd.params.length ||
        keyCols.length !== pairs.length ||
        keyCols.some((c) => !fields.has(c) && c !== "id")
      ) {
        report.push(`${label} — its parameters and key fields are not one-to-one; migrate by hand`);
        continue;
      }
      if (keyCols.includes("id")) {
        report.push(
          `${label} — a by-id find: read it with ${shape === "findBy" ? "findById" : "getById"}(id); migrate by hand`,
        );
        continue;
      }
      const tuples = declaredTuples(ast, agg);
      const keySet = new Set(keyCols);
      let tuple = tuples.find((t) => t.length === keySet.size && t.every((c) => keySet.has(c)));
      if (!tuple) {
        if (!addUnique) {
          report.push(
            `${label} — its key (${keyCols.join(", ")}) is not a declared unique key of '${aggName}'; declare 'unique (${keyCols.join(", ")})' (or rerun with --add-unique)`,
          );
          continue;
        }
        tuple = keyCols;
        const pending = uniquesToAdd.get(agg) ?? [];
        if (!pending.some((t) => t.join(",") === tuple.join(","))) pending.push(tuple);
        uniquesToAdd.set(agg, pending);
      }
      const routeRead = routeReads.get(fd.name);
      if (routeRead) {
        report.push(
          `${label} — '${routeRead}' reads its route, which goes with the declaration; expose a routed queryHandler over ${repo.name}.${shape}(…) and repoint that read by hand`,
        );
        continue;
      }
      known.set(`${repo.name}.${fd.name}`, {
        verb: shape,
        // Column per call-site argument position.
        cols: fd.params.map((p) => pairs.find(([pp]) => pp === p.name)[1]),
        ignoring: ignoringText(fd),
        label,
      });
      const [rs, re] = findRemovalRange(text, fd.$cstNode.offset - shift, fd.$cstNode.end - shift);
      edits.push({ start: rs, end: re, text: "" });
    }
  }
  for (const [agg, tuples] of uniquesToAdd) {
    const end = agg.$cstNode.end - shift;
    const close = end - 1;
    const ind = `${indentAt(text, agg.$cstNode.offset - shift)}  `;
    const decls = tuples.map((t) => `unique (${t.join(", ")})`);
    const ls = lineStart(text, close);
    if (text.slice(ls, close).trim() === "") {
      edits.push({ start: ls, end: ls, text: decls.map((d) => `${ind}${d}\n`).join("") });
    } else {
      let open = close;
      while (open > 0 && text[open - 1] === " ") open--;
      edits.push({ start: open, end: open, text: decls.map((d) => `  ${d}`).join("") });
    }
  }
  return edits;
}

/** Call sites `Repo.<find>(args)` → `Repo.findBy(<col>: arg, …)`. */
function planCalls(ast, shift, scope, report, where) {
  const edits = [];
  for (const n of AstUtils.streamAst(ast)) {
    if (n.$type !== "PostfixChain" || n.head?.$type !== "NameRef") continue;
    const s0 = n.suffixes[0];
    if (s0?.$type !== "MemberSuffix" || !s0.call) continue;
    const hit = scope.get(`${n.head.name}.${s0.member}`);
    if (!hit) continue;
    const args = s0.args ?? [];
    if (args.length !== hit.cols.length || args.some((a) => a.name)) {
      report.push(
        `${where}: '${n.$cstNode.text}' does not pass ${hit.label}'s parameters positionally; migrate by hand`,
      );
      continue;
    }
    const named = args.map((a, i) => `${hit.cols[i]}: ${a.value.$cstNode.text}`).join(", ");
    const start = s0.$cstNode.offset - shift;
    const end = s0.$cstNode.end - shift;
    edits.push({ start, end, text: `.${hit.verb}(${named})` });
    if (hit.ignoring && !/\bignoring\b/.test(n.$cstNode.text)) {
      const parent = n.$container;
      const bound =
        n.suffixes.length === 1 &&
        ((parent?.$type === "LetStmt" && n.$containerProperty === "expr") ||
          (parent?.$type === "IfLetStmt" && n.$containerProperty === "source"));
      if (!bound) {
        report.push(
          `${where}: '${n.$cstNode.text}' reads ${hit.label} (${hit.ignoring}) where 'ignoring' cannot follow; bind it with let / if let by hand`,
        );
        edits.pop();
        continue;
      }
      const chainEnd = n.$cstNode.end - shift;
      edits.push({ start: chainEnd, end: chainEnd, text: ` ${hit.ignoring}` });
    }
  }
  return edits;
}

function applyEdits(text, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  for (const e of sorted) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/** A repository body the codemod emptied (it spans lines) collapses to
 *  `{ }`; a body written empty is left as written. */
function tidyEmptyRepos(text) {
  return text.replace(/(\brepository\s+\w+\s+for\s+\w+\s*)\{[ \t]*\n\s*\}/g, "$1{ }");
}

/** The snippets of one file: [start, end) ranges of migratable source. */
function snippetsOf(file, src) {
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
function maskHoles(snippet) {
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

/** Migrate a set of sources together (call sites may sit in another `.ddd`
 *  file of one system).  Returns `{ results: [{ file, text, changed }],
 *  report: string[] }`. */
export function migrateSources(sources, opts = {}) {
  const addUnique = opts.addUnique === true;
  const known = new Map();
  const report = [];
  const parsed = [];
  for (const { file, text } of sources) {
    const snippets = [];
    for (const [s, e] of snippetsOf(file, text)) {
      const raw = text.slice(s, e);
      if (!/\bfind\b/.test(raw) && !/\.\w+\(/.test(raw)) continue;
      const { masked, holes } = file.endsWith(".ts") ? maskHoles(raw) : { masked: raw, holes: [] };
      const p = parseSnippet(masked);
      if (!p) continue;
      snippets.push({ start: s, raw, masked, holes, ...p });
    }
    parsed.push({ file, text, snippets });
  }
  const perSnippet = new Map();
  for (const { file, snippets } of parsed) {
    for (const sn of snippets) {
      const local = new Map();
      const edits = planFinds(sn.ast, sn.masked, sn.shift, local, report, file, addUnique);
      if (file.endsWith(".ddd"))
        for (const [k, v] of local) known.set(k, { ...v, dir: path.dirname(file) });
      perSnippet.set(sn, { edits, local });
    }
  }
  const results = [];
  for (const { file, text, snippets } of parsed) {
    let out = text;
    let changed = 0;
    for (const sn of [...snippets].sort((a, b) => b.start - a.start)) {
      const { edits: findEdits, local } = perSnippet.get(sn);
      // A call into another file's find is taken only when this model declares
      // no repository of that name and the two files sit in one directory tree
      // (a multi-file system), never across unrelated systems.
      const ownRepos = new Set(
        [...AstUtils.streamAst(sn.ast)].filter((n) => n.$type === "Repository").map((n) => n.name),
      );
      const dir = path.dirname(file);
      const related = (d) => d === dir || d.startsWith(`${dir}/`) || dir.startsWith(`${d}/`);
      const foreign = file.endsWith(".ddd")
        ? [...known].filter(([k, v]) => !ownRepos.has(k.split(".")[0]) && related(v.dir))
        : [];
      const scope = new Map([...foreign, ...local]);
      const edits = [...findEdits, ...planCalls(sn.ast, sn.shift, scope, report, file)];
      if (edits.length === 0) continue;
      const touchesHole = edits.some((e) =>
        sn.holes.some(([hs, he]) => e.start < he && e.end > hs),
      );
      if (touchesHole) {
        report.push(
          `${file}: a template literal's rewrite touches a \${…} hole — migrate it by hand`,
        );
        continue;
      }
      const next = tidyEmptyRepos(applyEdits(sn.raw, edits));
      out = out.slice(0, sn.start) + next + out.slice(sn.start + sn.raw.length);
      changed += edits.length;
    }
    results.push({ file, text: out, changed });
  }
  return { results, report };
}

/** Single-source convenience over {@link migrateSources}. */
export function migrateSource(text, file = "input.ddd", opts = {}) {
  const { results, report } = migrateSources([{ file, text }], opts);
  return { text: results[0].text, changed: results[0].changed, report };
}

async function* walk(p) {
  const st = await fs.stat(p);
  if (st.isFile()) {
    if (/\.(ddd|md|ts)$/.test(p)) yield p;
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
  const addUnique = args.includes("--add-unique");
  const roots = args.filter((a) => !a.startsWith("--"));
  const files = [];
  for (const root of roots.length ? roots : ["."]) for await (const f of walk(root)) files.push(f);
  files.sort();
  const sources = [];
  for (const file of files) sources.push({ file, text: await fs.readFile(file, "utf8") });
  const { results, report } = migrateSources(sources, { addUnique });
  let changedFiles = 0;
  for (const r of results) {
    if (!r.changed) continue;
    changedFiles++;
    if (check || list) console.log(r.file);
    else {
      await fs.writeFile(r.file, r.text);
      console.log(`migrated  ${r.file}`);
    }
  }
  for (const line of new Set(report)) console.log(`note  ${line}`);
  const verb = check || list ? "would migrate" : "migrated";
  console.log(`${verb} ${changedFiles} of ${files.length} file(s)`);
  if (check && changedFiles > 0) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
