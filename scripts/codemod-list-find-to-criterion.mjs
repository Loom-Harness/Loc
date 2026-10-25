// Codemod for the removal of list `find … where` (D-LIST-FIND-REMOVED).
//
// A repository `find` returning a list (`T[]` or `T paged`) is an error
// (`loom.list-find-removed`).  This script rewrites each one to a `criterion`
// beside its repository, and each `Repo.<find>(args)` call site to
// `Repo.run(<Criterion>(args))`:
//
//   repository Orders for Order {                repository Orders for Order { }
//     find open(r: string): Order[]        →     criterion OrdersOpen(r: string) of Order =
//       where this.region == r                     this.region == r
//   }
//   … Orders.open(x) …                     →     … Orders.run(OrdersOpen(x)) …
//
// A find carries no `sort:`, so the target is always a criterion (a
// `retrieval` is a criterion plus a sort).  A find written without `where`
// used the parameter-name convention — each parameter equal to the aggregate
// field of the same name (or of its name minus an `Id` suffix) — and the
// criterion spells that conjunction out.
//
//   node scripts/codemod-list-find-to-criterion.mjs [--check] [--list] <path>...
//
//   <path>   a `.ddd`, `.md` or `.ts` file, or a directory (walked recursively,
//            skipping node_modules / .git / dist / out / .loom / test/fixtures
//            byte-snapshot trees).  Defaults to `.`.
//   --check  write nothing; exit 1 when any list find is left to migrate.
//   --list   write nothing; print the files that would change.
//
// `.ddd` files are rewritten whole.  In `.md` files every ```ddd fence is a
// snippet, and in `.ts` files every template literal is one; a snippet that
// does not parse as a model, nor as the member list of a context, is left
// alone.  Splices are textual, so formatting and comments outside the rewritten
// find and call survive byte-for-byte.  Idempotent: a migrated source has no
// list find left.
//
// A find carrying no `where` and no parameters read every row: it becomes the
// repository's `find all` (still legal), and its reads follow the rename.
//
// A `test e2e` that reads a find's route (`api.<plural>.<find>(…)`) keeps it:
// the codemod adds a routed `queryHandler List<Criterion>` over `Repo.run`,
// bound by a `route GET` on the same path in the api serving the context (each
// parameter a `{token}` — a GET carries no body), with the find's `requires`
// gate as the handler's first statement, and repoints the read to
// `api.<context>.list<Criterion>(…)`.
//
// What it cannot do is reported, not guessed:
//   - a page reading a find's route (`<Ctx>.<Agg>.<find>` in `QueryView of:`),
//     or a route read with no api in the same source;
//   - a find with a `requires` gate and no route read: the gate guarded a
//     route that is gone — gate an exposure with `scaffoldPaged(of: …,
//     requires: <Policy>)` if a client needs it;
//   - a filterless find whose parameters match no field, or a second
//     every-row find on a repository that already has a `find all`.
//
// Needs the compiled toolchain (`npm run build`) for the parser.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { AstUtils, EmptyFileSystem } from "langium";
import { createDddServices } from "../out/language/ddd-module.js";
import { upperFirst as pascal, plural } from "../out/util/naming.js";

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

/** Parse `src` as a model; failing that, as the members of a context.  Returns
 *  the AST and the offset of `src` inside the parsed text, or undefined. */
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

function isListFind(fd) {
  if (fd.name === "all") return false;
  const rt = fd.returnType;
  return !!rt && (rt.array === true || (rt.ctors ?? []).includes("paged"));
}

/** Field names of an aggregate (properties, derived, containments) by name. */
function aggregateFields(ctx, aggName) {
  const agg = ctx.members.find((m) => m.$type === "Aggregate" && m.name === aggName);
  const out = new Set();
  for (const m of agg?.members ?? []) if (typeof m.name === "string") out.add(m.name);
  return out;
}

/** The criterion body a filterless find meant: the parameter-name convention
 *  every backend applies (a parameter equal to the same-named field, or to the
 *  field named by stripping an `Id` suffix). */
function conventionBody(fd, fields) {
  const terms = [];
  for (const p of fd.params) {
    const name = p.name;
    if (fields.has(name)) terms.push(`this.${name} == ${name}`);
    else if (name.endsWith("Id") && fields.has(name.slice(0, -2)))
      terms.push(`this.${name.slice(0, -2)} == ${name}`);
  }
  return terms.join(" && ");
}

function lineStart(text, offset) {
  return text.lastIndexOf("\n", offset - 1) + 1;
}

function indentAt(text, offset) {
  return /^[\t ]*/.exec(text.slice(lineStart(text, offset)))[0];
}

/** The removal range of a find: its own lines, plus the contiguous `//`
 *  comment lines directly above it (they describe the find, so they move with
 *  it).  Returns [start, end, leadingComment]. */
function findRemovalRange(text, node) {
  const start = node.$cstNode.offset;
  const end = node.$cstNode.end;
  const ls = lineStart(text, start);
  const onlyWsBefore = text.slice(ls, start).trim() === "";
  let le = text.indexOf("\n", end);
  if (le < 0) le = text.length;
  const tail = text.slice(end, le).trim();
  // A trailing `// …` comment describes the find, so it goes with it.
  const onlyWsAfter = tail === "" || tail.startsWith("//");
  if (!onlyWsBefore || !onlyWsAfter) return [start, end, []];
  // Pull in the comment block above.
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

/** Collect the migration plan for one parsed snippet.  `known` maps
 *  `<Repo>.<find>` to the criterion name across every snippet of the run (a
 *  multi-file system calls a find from another file). */
function planFinds(ast, text, shift, known, report, where, routeReads) {
  const edits = [];
  // Routes to add, per api node: the api that serves a context is the one
  // whose `from` names the context's subdomain.
  const apis = [...AstUtils.streamAst(ast)].filter((n) => n.$type === "Api");
  const routesByApi = new Map();
  for (const ctx of AstUtils.streamAst(ast)) {
    if (ctx.$type !== "BoundedContext") continue;
    const taken = new Set(ctx.members.map((m) => m.name).filter(Boolean));
    for (const repo of ctx.members) {
      if (repo.$type !== "Repository") continue;
      const listFinds = repo.finds.filter(isListFind);
      if (listFinds.length === 0) continue;
      const aggName = repo.aggregate?.$refText ?? "";
      const fields = aggregateFields(ctx, aggName);
      const criteria = [];
      let hasAll = repo.finds.some((f) => f.name === "all");
      for (const fd of listFinds) {
        const filter = fd.filter ? fd.filter.$cstNode.text : conventionBody(fd, fields);
        const label = `${where}: ${repo.name}.${fd.name}`;
        if (!filter) {
          // A parameterless, filterless list find read every row: it IS the
          // repository's `find all`, which stays legal — rename it in place
          // when the repository declares no `all` of its own.
          if (fd.params.length === 0 && !hasAll) {
            hasAll = true;
            const cst = shifted(fd.$cstNode, shift);
            const m = /^find\s+/.exec(cst.text);
            const at = cst.offset + (m ? m[0].length : 0);
            edits.push({ start: at, end: at + fd.name.length, text: "all" });
            known.set(`${repo.name}.${fd.name}`, { rename: "all" });
            continue;
          }
          report.push(
            `${label} — no 'where' and no parameter names a field (it read every row), and the repository already has a 'find all'; migrate it by hand`,
          );
          continue;
        }
        // A `where` that is exactly a criterion applied to the find's own
        // parameters, in order, needs no new criterion: run that one.
        const reused = reusedCriterion(fd, ctx);
        let name = reused;
        if (!name) {
          name = `${pascal(plural(aggName))}${pascal(fd.name)}`;
          for (let i = 2; taken.has(name); i++)
            name = `${pascal(plural(aggName))}${pascal(fd.name)}${i}`;
          taken.add(name);
        }
        const entry = { name, ignoring: ignoringText(fd) };
        known.set(`${repo.name}.${fd.name}`, entry);
        const [rs, re, comment] = findRemovalRange(text, { $cstNode: shifted(fd.$cstNode, shift) });
        edits.push({ start: rs, end: re, text: "" });
        const params = fd.params.map((p) => p.$cstNode.text).join(", ");
        const decls = reused
          ? []
          : [`criterion ${name}${params ? `(${params})` : ""} of ${aggName} = ${filter}`];
        // A client reads the find's route: keep it on the wire as a routed
        // queryHandler over the criterion, on the same path with each
        // parameter as a `{token}` (a GET carries no body), and the find's
        // `requires` gate as the handler's first statement.
        const routeKey = `${slugKey(plural(aggName))}.${fd.name}`;
        const api = routeReads.has(routeKey)
          ? apis.find((a) => a.source?.$refText && a.source.$refText === ctx.$container?.name)
          : undefined;
        if (api) {
          let handler = `List${name}`;
          for (let i = 2; taken.has(handler); i++) handler = `List${name}${i}`;
          taken.add(handler);
          const paged = (fd.returnType.ctors ?? []).includes("paged");
          const argNames = fd.params.map((p) => p.name);
          const body = [
            ...(fd.gate ? [`  requires ${fd.gate.$cstNode.text}`] : []),
            `  let r = ${repo.name}.run(${name}(${argNames.join(", ")}))${entry.ignoring ? ` ${entry.ignoring}` : ""}`,
            "  return r",
          ];
          decls.push(
            [
              `queryHandler ${handler}${params ? `(${params})` : "()"}: ${aggName}${paged ? " paged" : "[]"} {`,
              ...body,
              "}",
            ].join("\n"),
          );
          const routePath = `/${snakeCase(plural(aggName))}/${snakeCase(fd.name)}${argNames.map((a) => `/{${a}}`).join("")}`;
          const lines = routesByApi.get(api) ?? [];
          lines.push(`route GET "${routePath}" -> ${ctx.name}.${handler}`);
          routesByApi.set(api, lines);
          entry.expose = { ctxName: ctx.name, handler, params: argNames };
          known.set(`route:${routeKey}`, entry);
        } else if (fd.gate) {
          report.push(
            `${label} — its 'requires ${fd.gate.$cstNode.text}' gate guarded the find's route, which is gone; gate the exposure with scaffoldPaged(of: ${name}, requires: <Policy>) if a client needs it`,
          );
        } else if (routeReads.has(routeKey)) {
          report.push(
            `${label} — a client reads its route, but no api in this source serves its context; expose ${name} by hand`,
          );
        }
        criteria.push({ comment, decls });
      }
      if (criteria.length === 0) continue;
      const repoEnd = repo.$cstNode.end - shift;
      const ind = indentAt(text, repo.$cstNode.offset - shift);
      const block = criteria
        .filter((c) => c.decls.length > 0)
        .map((c) =>
          [
            ...c.comment.map((l) => `${ind}${l}`),
            ...c.decls.map((d) => d.replace(/^/gm, ind)),
          ].join("\n"),
        )
        .join("\n");
      if (block) edits.push({ start: repoEnd, end: repoEnd, text: `\n${block}` });
    }
  }
  for (const [api, lines] of routesByApi) {
    const ind = indentAt(text, api.$cstNode.offset - shift);
    const apiText = api.$cstNode.text;
    const end = api.$cstNode.end - shift;
    const body = lines.map((l) => `${ind}  ${l}`).join("\n");
    if (apiText.endsWith("}")) {
      const close = end - 1;
      const ls = lineStart(text, close);
      if (text.slice(ls, close).trim() === "") {
        // `}` on its own line: the routes go on the lines above it.
        edits.push({ start: ls, end: ls, text: `${body}\n` });
      } else {
        // `{ }` / `{ … }` on one line: break the body open.
        let open = close;
        while (open > 0 && text[open - 1] === " ") open--;
        edits.push({ start: open, end: close, text: `\n${body}\n${ind}` });
      }
    } else {
      edits.push({
        start: end,
        end,
        text: ` {\n${lines.map((l) => `${ind}  ${l}`).join("\n")}\n${ind}}`,
      });
    }
  }
  return edits;
}

function snakeCase(s) {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

/** The aggregate slug of an `api.<slug>.<find>` read, case- and
 *  underscore-insensitive (`workOrders`, `work_orders`, `WorkOrders`). */
function slugKey(s) {
  return s.replace(/_/g, "").toLowerCase();
}

function lowerFirst(s) {
  return s.length ? s[0].toLowerCase() + s.slice(1) : s;
}

/** The criterion a find's `where` names outright — `where C` with no params,
 *  or `where C(p1, …, pn)` over exactly the find's params in order — else
 *  undefined. */
function reusedCriterion(fd, ctx) {
  const f = fd.filter;
  if (!f) return undefined;
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

function ignoringText(fd) {
  const t = fd.$cstNode.text;
  const at = t.search(/\bignoring\b/);
  return at < 0 ? "" : t.slice(at).trim();
}

function shifted(cst, shift) {
  return { offset: cst.offset - shift, end: cst.end - shift, text: cst.text };
}

/** Call sites `Repo.<find>(args)` → `Repo.run(<Criterion>(args))`, plus the
 *  route reads the codemod cannot migrate. */
function planCalls(ast, shift, known, findNames, report, where, local) {
  const edits = [];
  for (const n of AstUtils.streamAst(ast)) {
    if (n.$type !== "PostfixChain" || n.head?.$type !== "NameRef") continue;
    const s0 = n.suffixes[0];
    const hit =
      s0?.$type === "MemberSuffix" && s0.call
        ? known.get(`${n.head.name}.${s0.member}`)
        : undefined;
    if (hit?.rename) {
      const start = s0.$cstNode.offset - shift;
      edits.push({ start: start + 1, end: start + 1 + s0.member.length, text: hit.rename });
      continue;
    }
    if (hit) {
      const args = (s0.args ?? []).map((a) => a.$cstNode.text).join(", ");
      const start = s0.$cstNode.offset - shift;
      const end = s0.$cstNode.end - shift;
      edits.push({ start, end, text: `.run(${hit.name}(${args}))` });
      if (hit.ignoring && !/\bignoring\b/.test(n.$cstNode.text)) {
        const chainEnd = n.$cstNode.end - shift;
        edits.push({ start: chainEnd, end: chainEnd, text: ` ${hit.ignoring}` });
      }
      continue;
    }
    // A client read of a find's route: `api.<plural>.<find>(…)` in a `test
    // e2e`, `<Ctx>.<Agg>.<find>` in a page.  A find renamed to `all` keeps a
    // route (the derived list route), so the read follows the rename.
    const routeAt = n.suffixes.findIndex(
      (x, i) => i > 0 && x.$type === "MemberSuffix" && findNames.has(x.member),
    );
    if (routeAt < 0) continue;
    const routeHit =
      (routeAt === 1 &&
        local.get(`route:${slugKey(n.suffixes[0].member)}.${n.suffixes[1].member}`)) ||
      findNames.get(n.suffixes[routeAt].member);
    if (routeHit?.rename) {
      const at = n.suffixes[routeAt].$cstNode.offset - shift + 1;
      edits.push({ start: at, end: at + n.suffixes[routeAt].member.length, text: routeHit.rename });
      continue;
    }
    if (routeHit?.expose && n.head.name === "api" && routeAt === 1 && n.suffixes[1].call) {
      // `api.<plural>.<find>({ p: v })` → `api.<ctx>.<handler>(v)`: a routed
      // handler is addressed by context + handler, its params positional.
      const sfx = n.suffixes[1];
      const args = sfx.args ?? [];
      const obj =
        args.length === 1 && args[0].value?.$type === "ObjectLit" ? args[0].value : undefined;
      const values = obj
        ? routeHit.expose.params.map(
            (p) => obj.fields.find((f) => f.name === p)?.value.$cstNode.text ?? "undefined",
          )
        : args.map((a) => a.value.$cstNode.text);
      const start = n.$cstNode.offset - shift;
      const end = sfx.$cstNode.end - shift;
      edits.push({
        start,
        end,
        text: `api.${lowerFirst(routeHit.expose.ctxName)}.${lowerFirst(routeHit.expose.handler)}(${values.join(", ")})`,
      });
      continue;
    }
    report.push(
      `${where}: '${n.$cstNode.text.split("\n")[0]}' reads a list find's route — a criterion has none; expose it with scaffoldPaged(of: …) + scaffoldPagedApi(of: …) and repoint this read`,
    );
  }
  return edits;
}

/** Names of the list finds a `test e2e` reads over the wire in this model:
 *  `api.<plural>.<find>(…)`. */
function routeReadsOf(ast) {
  const names = new Set();
  for (const n of AstUtils.streamAst(ast)) {
    if (n.$type === "Repository") for (const fd of n.finds) if (isListFind(fd)) names.add(fd.name);
  }
  const out = new Set();
  for (const n of AstUtils.streamAst(ast)) {
    if (n.$type !== "PostfixChain" || n.head?.$type !== "NameRef" || n.head.name !== "api")
      continue;
    const s1 = n.suffixes[1];
    if (s1?.$type === "MemberSuffix" && names.has(s1.member))
      out.add(`${slugKey(n.suffixes[0].member)}.${s1.member}`);
  }
  return out;
}

function applyEdits(text, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  for (const e of sorted) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/** Empty repository bodies left behind collapse to `{ }`. */
function tidyEmptyRepos(text) {
  return text.replace(/(\brepository\s+\w+\s+for\s+\w+\s*)\{\s*\}/g, "$1{ }");
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

/** Template-literal bodies in a TS source whose `${…}` holes are masked.  A
 *  literal with a hole is still a snippet (holes are replaced by same-length
 *  blanks); edits that touch a hole are dropped by the caller. */
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

/** Migrate a set of sources together (call sites may sit in another file).
 *  `sources` is `[{ file, text }]`; returns `{ results: [{ file, text,
 *  changed }], report: string[] }`. */
export function migrateSources(sources) {
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
  // A `.ddd` file is one document of a (possibly multi-file) system, so its
  // finds are visible to every other `.ddd` file of the run.  A `.md` fence or
  // a `.ts` template literal is a model of its own: its call sites resolve
  // against its own finds only.
  const perSnippet = new Map();
  for (const { file, snippets } of parsed) {
    for (const sn of snippets) {
      const local = new Map();
      const edits = planFinds(
        sn.ast,
        sn.masked,
        sn.shift,
        local,
        report,
        file,
        routeReadsOf(sn.ast),
      );
      if (file.endsWith(".ddd"))
        for (const [k, v] of local)
          if (!k.startsWith("route:")) known.set(k, { ...v, dir: path.dirname(file) });
      perSnippet.set(sn, { edits, local });
    }
  }
  const results = [];
  for (const { file, text, snippets } of parsed) {
    let out = text;
    let changed = 0;
    for (const sn of [...snippets].sort((a, b) => b.start - a.start)) {
      const { edits: findEdits, local } = perSnippet.get(sn);
      // A call into another file's find is only taken when this model declares
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
      // Route reads name the find without its repository, so they are matched
      // against this snippet's own finds only — a same-named single-row find
      // elsewhere in the run is not a hit.
      const findNames = new Map([...local].map(([k, v]) => [k.split(".")[1], v]));
      const edits = [
        ...findEdits,
        ...planCalls(sn.ast, sn.shift, scope, findNames, report, file, local),
      ];
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
export function migrateSource(text, file = "input.ddd") {
  const { results, report } = migrateSources([{ file, text }]);
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
  const roots = args.filter((a) => !a.startsWith("--"));
  const files = [];
  for (const root of roots.length ? roots : ["."]) for await (const f of walk(root)) files.push(f);
  files.sort();
  const sources = [];
  for (const file of files) sources.push({ file, text: await fs.readFile(file, "utf8") });
  const { results, report } = migrateSources(sources);
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
