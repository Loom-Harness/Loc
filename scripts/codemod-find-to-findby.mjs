// Codemod for the removal of single-row repository finds (D-REPO-KEY-LOOKUP).
//
// Every single-row `find` (a `T?` / `T option`, `T` / `T envelope`, or
// `T or <Error>` return) is migrated to the repository contract, or reported.
// The target depends on the find's key:
//
//   1. a declared `unique (…)` tuple → `Repo.findBy(<col>: v, …)` (absence
//      returning) / `Repo.getBy(…)` (must exist);
//   2. the aggregate's `id` → the built-in `Repo.findById(v)` / `getById(v)`;
//   3. anything else — a key no `unique (…)` declares, or any queryable
//      `where` — is a specification query: a `criterion <Plural><Find>(params)
//      of <Agg> = <where>` beside the repository (an existing criterion is
//      reused when the `where` is exactly one), read with
//      `Repo.find(<Criterion>(args))` — the first match, `T?`.
//
//   repository Customers for Customer {       repository Customers for Customer { }
//     find byEmail(e: string): Customer?   →  criterion CustomersByEmail(e: string) of Customer =
//       where this.email == e                    this.email == e
//   }
//   if let c = Customers.byEmail(e) { … }  →  if let c = Customers.find(CustomersByEmail(e)) { … }
//
// A clause-less find binds each parameter to the field it names (the field of
// the same name, or the one its `<field>Id` spelling names), so it counts as
// that equality conjunction.  A `T or <Error>` find is absence-shaped: a miss
// is `T?` (2026-10-25 ruling), so it takes the `findBy` / `findById` /
// `find(C)` target.
//
// A find is migrated only when EVERY call site can take its target; otherwise
// it stays declared and the call sites that block it are reported.  Where each
// target is accepted:
//
//   - `findBy` / `getBy` / `getById` / `findById` — wherever the find was
//     called;
//   - `find(<Criterion>)` — an `if let` source, a `let` (it binds `T?`), or an
//     expression in a `domainService` operation (`Repo.find(C(x)) != null`).
//
// A must-exist (`T` / `T envelope`) find with no unique or id key has no
// mechanical target: `find(C)` answers absence, and no statement in an `else`
// branch answers a 404 today (`precondition` is a 422, `requires` a 403), so
// each of its call sites is reported.  A `T or <Error>` call site that matches
// on the error variant is reported too.
//
//   node scripts/codemod-find-to-findby.mjs [--check] [--list] [--add-unique] <path>...
//
//   <path>        a `.ddd`, `.md` or `.ts` file, or a directory (walked
//                 recursively, skipping node_modules / .git / dist / out /
//                 .loom).  Defaults to `.`.
//   --check       write nothing; exit 1 when any find would be migrated.
//   --list        write nothing; print the files that would change.
//   --add-unique  a key that no declared tuple covers gets one: the codemod adds
//                 `unique (<key>)` to the aggregate (which also derives the DB
//                 unique index and the 409 on a duplicate) and takes target 1.
//                 Never the default.
//
// `.ddd` files are rewritten whole.  In `.md` files every ```ddd fence is a
// snippet, and in `.ts` files every template literal is one; a snippet that
// does not parse as a model, nor as the member list of a context, is left
// alone.  Splices are textual, so formatting and comments outside the rewritten
// find and call survive byte-for-byte.  Idempotent.
//
// Also reported, never guessed: a find with `ignoring` whose target cannot
// carry it (`findById`, `find(C)`), a `where` that reads `currentUser` (a
// criterion takes no principal), a find with neither a `where` nor a
// parameter (it reads an arbitrary row), a find whose route a client reads
// (`api.<plural>.<find>(…)` in a `test e2e`, a page's `<Ctx>.<Agg>.<find>`),
// and a find whose aggregate is not in the same source.
//
// Needs the compiled toolchain (`npm run build`) for the parser.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { AstUtils } from "langium";
import { upperFirst as pascal, plural, snake } from "../out/util/naming.js";
import {
  aggregateChain,
  aggregateFieldNames,
  aggregateOf,
  applyEdits,
  conventionBody,
  ignoringText,
  indentAt,
  lineStart,
  parseSources,
  removalRange,
  reusedCriterion,
  tidyEmptyRepos,
  walkFiles,
} from "./codemod-find-shared.mjs";

/** `optional` (`T?`, `T option`) / `row` (`T`, `T envelope`) / `union`
 *  (`T or <Error>`) / `list` / `undefined` for a find's return. */
function findShape(fd) {
  const rt = fd.returnType;
  if (!rt || fd.name === "all") return undefined;
  if (rt.array || (rt.ctors ?? []).includes("paged")) return "list";
  if ((rt.alternatives ?? []).length > 0) return "union";
  if (rt.optional || (rt.ctors ?? []).includes("option")) return "optional";
  return "row";
}

/** Declared `unique (…)` tuples, inherited ones included. */
function declaredTuples(ast, agg) {
  const out = [];
  for (const a of aggregateChain(ast, agg))
    for (const m of a.members ?? []) if (m.$type === "Unique") out.push([...m.columns]);
  return out;
}

function unparen(e) {
  while (e?.$type === "ParenExpr") e = e.inner;
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

/** The key a find's pairs spell, when params and fields are one-to-one. */
function keyOf(fd, pairs) {
  if (!pairs || pairs.length === 0) return undefined;
  const cols = [...new Set(pairs.map(([, f]) => f))];
  if (new Set(pairs.map(([p]) => p)).size !== fd.params.length || cols.length !== pairs.length)
    return undefined;
  return { cols, colOfParam: fd.params.map((p) => pairs.find(([pp]) => pp === p.name)[1]) };
}

function readsCurrentUser(node) {
  if (!node) return false;
  for (const n of AstUtils.streamAst(node))
    if (n.$type === "NameRef" && n.name === "currentUser") return true;
  return false;
}

/** Every find name something other than a `Repo.<find>(…)` call reads in this
 *  snippet: `api.<plural>.<find>(…)`, `<Ctx>.<Agg>.<find>`. */
function nonCallReads(ast) {
  const out = new Map();
  const repos = new Set(
    [...AstUtils.streamAst(ast)].filter((n) => n.$type === "Repository").map((n) => n.name),
  );
  for (const n of AstUtils.streamAst(ast)) {
    if (n.$type !== "PostfixChain" || n.head?.$type !== "NameRef") continue;
    // `<resource>.<operationId>(…)` reads at the first suffix; a repository
    // call there is the call the codemod rewrites, not a route read.
    for (let i = repos.has(n.head.name) ? 1 : 0; i < n.suffixes.length; i++) {
      const s = n.suffixes[i];
      if (s.$type === "MemberSuffix" && !out.has(s.member))
        out.set(s.member, n.$cstNode.text.split("\n")[0]);
    }
  }
  return out;
}

/** Plan each single-row find of one snippet: its target and its own edits
 *  (the declaration removal, a criterion, a `unique`), all tentative until the
 *  call sites are known.  Reports go to `report` straight away for a find no
 *  target fits. */
function planFinds(ast, text, shift, report, where, addUnique) {
  const plans = [];
  const routeReads = nonCallReads(ast);
  const takenByCtx = new Map();
  for (const repo of AstUtils.streamAst(ast)) {
    if (repo.$type !== "Repository") continue;
    const ctx = repo.$container?.$type === "BoundedContext" ? repo.$container : undefined;
    if (ctx && !takenByCtx.has(ctx))
      takenByCtx.set(ctx, new Set(ctx.members.map((m) => m.name).filter(Boolean)));
    const taken = ctx ? takenByCtx.get(ctx) : new Set();
    const aggName = repo.aggregate?.$refText ?? "";
    const agg = aggregateOf(ast, aggName);
    for (const fd of repo.finds) {
      const shape = findShape(fd);
      if (!shape || shape === "list") continue;
      const label = `${where}: ${repo.name}.${fd.name}`;
      if (!agg) {
        report.push(`${label} — its aggregate '${aggName}' is not in this source; migrate by hand`);
        continue;
      }
      // A client reads the route by the find's name (`api.<plural>.<find>`) or,
      // through a typed in-system api resource, by its operation id
      // (`<find><Agg>`).
      const routeRead = routeReads.get(fd.name) ?? routeReads.get(`${fd.name}${aggName}`);
      if (routeRead) {
        report.push(
          `${label} — '${routeRead}' reads its route, which goes with the declaration; expose a routed queryHandler and repoint that read by hand`,
        );
        continue;
      }
      const fields = aggregateFieldNames(ast, agg);
      const params = new Set(fd.params.map((p) => p.name));
      const key = keyOf(
        fd,
        fd.filter ? equalityPairs(fd.filter, params) : conventionPairs(fd, fields),
      );
      const ignoring = ignoringText(fd);
      const absent = shape !== "row"; // a miss is a value (`T?`, `T option`, `T or <Error>`)
      const [rs, re, comment] = removalRange(
        text,
        fd.$cstNode.offset - shift,
        fd.$cstNode.end - shift,
      );
      const plan = {
        key: `${repo.name}.${fd.name}`,
        label,
        shape,
        repo,
        edits: [{ start: rs, end: re, text: "" }],
        criterionDecl: undefined,
        unique: undefined,
      };
      // Target 2 — the aggregate's id.
      if (key && key.cols.length === 1 && key.cols[0] === "id") {
        if (ignoring) {
          report.push(
            `${label} — a by-id find with '${ignoring}': the built-in by-id read carries no 'ignoring'; migrate by hand`,
          );
          continue;
        }
        plans.push({ ...plan, target: { kind: "by-id", verb: absent ? "findById" : "getById" } });
        continue;
      }
      // Target 1 — a declared (or, opted in, an added) unique tuple.
      if (key?.cols.every((c) => fields.has(c))) {
        const keySet = new Set(key.cols);
        const declared = declaredTuples(ast, agg).find(
          (t) => t.length === keySet.size && t.every((c) => keySet.has(c)),
        );
        const tuple = declared ?? (addUnique ? key.cols : undefined);
        if (tuple) {
          plans.push({
            ...plan,
            unique: declared ? undefined : { agg, cols: tuple },
            target: {
              kind: "key",
              verb: absent ? "findBy" : "getBy",
              cols: key.colOfParam,
              ignoring,
            },
          });
          continue;
        }
      }
      // Target 3 — a criterion, read with `find(C)`.
      if (ignoring) {
        report.push(
          `${label} — '${ignoring}': Repo.find(<Criterion>) carries no 'ignoring'; declare the key unique (findBy keeps it) or migrate by hand`,
        );
        continue;
      }
      if (readsCurrentUser(fd.filter)) {
        report.push(
          `${label} — its 'where' reads currentUser, which a criterion cannot; migrate by hand`,
        );
        continue;
      }
      const reused = reusedCriterion(fd, ctx);
      const body = fd.filter ? fd.filter.$cstNode.text : conventionBody(fd, fields);
      if (!reused && !body) {
        report.push(
          `${label} — no 'where' and no parameter names a field: it reads an arbitrary row; migrate by hand`,
        );
        continue;
      }
      let name = reused;
      if (!name) {
        const base = `${pascal(plural(aggName))}${pascal(fd.name)}`;
        name = base;
        for (let i = 2; taken.has(name); i++) name = `${base}${i}`;
        taken.add(name);
      }
      const ps = fd.params.map((p) => p.$cstNode.text).join(", ");
      plans.push({
        ...plan,
        criterionDecl: reused
          ? undefined
          : { comment, text: `criterion ${name}${ps ? `(${ps})` : ""} of ${aggName} = ${body}` },
        target: { kind: "criterion", name, mustExist: !absent },
      });
    }
  }
  return plans;
}

/** Where a call `Repo.<find>(…)` sits: an `if let` source, a `let`, an
 *  expression in a domain-service operation, or elsewhere. */
function callPosition(n) {
  const parent = n.$container;
  if (parent?.$type === "IfLetStmt" && n.$containerProperty === "source") return "if-let";
  if (parent?.$type === "LetStmt" && n.$containerProperty === "expr") return "let";
  if (AstUtils.getContainerOfType(n, (x) => x.$type === "DomainServiceOperation")) return "service";
  return "other";
}

/** A `let`-bound union read whose binding a `match` narrows on. */
function matchesOnVariant(n) {
  const let_ = n.$container;
  if (let_?.$type !== "LetStmt") return false;
  const body = let_.$container;
  for (const m of AstUtils.streamAst(body)) {
    if ((m.$type === "MatchStmt" || m.$type === "MatchExpr") && m.varArms?.length) {
      const s = unparen(m.subject);
      if (s?.$type === "NameRef" && s.name === let_.name) return true;
    }
  }
  return false;
}

/** The rewrite of one call site under `plan`, or a reason it cannot take it. */
function rewriteCall(n, plan, shift) {
  const s0 = n.suffixes[0];
  const args = s0.args ?? [];
  const start = s0.$cstNode.offset - shift;
  const end = s0.$cstNode.end - shift;
  const t = plan.target;
  if (args.some((a) => a.name)) return { blocked: "passes named arguments" };
  const argText = args.map((a) => a.value.$cstNode.text);
  const pos = callPosition(n);
  if (n.suffixes.length !== 1) return { blocked: "reads past the result in one chain" };
  if (plan.shape === "union" && matchesOnVariant(n))
    return {
      blocked: "matches on the error variant; a miss is T? now — rewrite the match by hand",
    };
  // An absence-returning read (`findBy`, `findById`, `find(C)`) is a `T?`,
  // which an `if let` source, a `let` (binding `T?`) or a domain-service
  // expression can take.
  const absentVerb =
    (t.kind === "key" && t.verb === "findBy") ||
    (t.kind === "by-id" && t.verb === "findById") ||
    (t.kind === "criterion" && !t.mustExist);
  if (absentVerb && pos !== "if-let" && pos !== "let" && pos !== "service")
    return {
      blocked:
        "is a position a T? read cannot take (only an 'if let' source, a 'let' or a domain-service expression)",
    };
  if (t.kind === "key") {
    if (args.length !== t.cols.length) return { blocked: "does not pass every parameter" };
    const edits = [
      { start, end, text: `.${t.verb}(${argText.map((a, i) => `${t.cols[i]}: ${a}`).join(", ")})` },
    ];
    if (t.ignoring && !/\bignoring\b/.test(n.$cstNode.text)) {
      if (pos !== "let" && pos !== "if-let")
        return { blocked: `sits where '${t.ignoring}' cannot follow (bind it with let / if let)` };
      const chainEnd = n.$cstNode.end - shift;
      edits.push({ start: chainEnd, end: chainEnd, text: ` ${t.ignoring}` });
    }
    return { edits };
  }
  if (t.kind === "by-id") {
    return { edits: [{ start, end, text: `.${t.verb}(${argText.join(", ")})` }] };
  }
  // criterion
  if (t.mustExist)
    return {
      blocked:
        "needs the row (a must-exist find over a non-unique key): no else-branch statement answers a 404 — declare the key unique (getBy) or rewrite by hand",
    };
  return { edits: [{ start, end, text: `.find(${t.name}(${argText.join(", ")}))` }] };
}

/** Migrate a set of sources together (call sites may sit in another `.ddd`
 *  file of one system).  Returns `{ results: [{ file, text, changed }],
 *  report: string[] }`. */
export function migrateSources(sources, opts = {}) {
  const addUnique = opts.addUnique === true;
  const report = [];
  const parsed = parseSources(sources, (raw) => /\bfind\b/.test(raw) || /\.\w+\(/.test(raw));
  // Pass 1 — every find's tentative plan.
  const plansBySnippet = new Map();
  const known = new Map(); // `<Repo>.<find>` → plan, for `.ddd` cross-file calls
  for (const { file, snippets } of parsed) {
    for (const sn of snippets) {
      const plans = planFinds(sn.ast, sn.masked, sn.shift, report, file, addUnique);
      for (const p of plans) {
        p.file = file;
        p.sn = sn;
        p.dir = path.dirname(file);
        p.callEdits = [];
        p.blocked = [];
      }
      plansBySnippet.set(sn, plans);
      if (file.endsWith(".ddd")) for (const p of plans) known.set(p.key, p);
    }
  }
  // Pass 2 — every call site, against its snippet's own finds or (for a
  // `.ddd` file) a related `.ddd` file's.
  for (const { file, snippets } of parsed) {
    for (const sn of snippets) {
      const local = new Map(plansBySnippet.get(sn).map((p) => [p.key, p]));
      const ownRepos = new Set(
        [...AstUtils.streamAst(sn.ast)].filter((n) => n.$type === "Repository").map((n) => n.name),
      );
      const dir = path.dirname(file);
      const related = (d) => d === dir || d.startsWith(`${dir}/`) || dir.startsWith(`${d}/`);
      for (const n of AstUtils.streamAst(sn.ast)) {
        if (n.$type !== "PostfixChain" || n.head?.$type !== "NameRef") continue;
        const s0 = n.suffixes[0];
        if (s0?.$type !== "MemberSuffix" || !s0.call) continue;
        const k = `${n.head.name}.${s0.member}`;
        let plan = local.get(k);
        if (!plan && file.endsWith(".ddd") && !ownRepos.has(n.head.name)) {
          const foreign = known.get(k);
          if (foreign && related(foreign.dir)) plan = foreign;
        }
        if (!plan) continue;
        const r = rewriteCall(n, plan, sn.shift);
        if (r.blocked)
          plan.blocked.push(`${file}: '${n.$cstNode.text.split("\n")[0]}' ${r.blocked}`);
        else plan.callEdits.push({ sn, edits: r.edits });
      }
    }
  }
  // Pass 2b — a find named anywhere the codemod does not rewrite stays
  // declared.  In a `.ts` / `.md` file a model is often split over several
  // snippets (or asserted on by name: `toContain("byEmail")`), and in any file
  // the emitted spellings (`by_email`, `ByEmail`) may be read back; a caller
  // can also veto a find (`opts.keep`, e.g. a test asserting on a fixture's
  // find by name).
  const textOf = new Map(parsed.map((p) => [p.file, p.text]));
  for (const plans of plansBySnippet.values()) {
    for (const p of plans) {
      const name = p.key.split(".")[1];
      const vetoed = opts.keep?.(p.file, p.repo.name, name);
      if (vetoed) {
        p.blocked.push(`${p.file}: ${vetoed}`);
        continue;
      }
      if (p.file.endsWith(".ddd")) continue;
      const text = textOf.get(p.file);
      const count = (re) => (text.match(re) ?? []).length;
      const own = count(new RegExp(`\\b${name}\\b`, "g"));
      const rewritten = p.callEdits.filter((c) => c.sn.file === p.file).length;
      const variants = [snake(name), pascal(name)].filter((v) => v !== name);
      if (own > 1 + rewritten || variants.some((v) => count(new RegExp(`\\b${v}\\b`, "g")) > 0))
        p.blocked.push(
          `${p.file}: is named elsewhere in the file (another snippet or an assertion)`,
        );
    }
  }
  // Pass 3 — a find with a blocked call site stays declared.
  const editsBySnippet = new Map();
  const add = (sn, e) => {
    const list = editsBySnippet.get(sn) ?? [];
    list.push(...e);
    editsBySnippet.set(sn, list);
  };
  for (const plans of plansBySnippet.values()) {
    const accepted = [];
    for (const p of plans) {
      if (p.blocked.length > 0) {
        for (const b of p.blocked) report.push(`${p.label} — kept: its call ${b}`);
        continue;
      }
      accepted.push(p);
      add(p.sn, p.edits);
      for (const c of p.callEdits) add(c.sn, c.edits);
    }
    // Criteria go after their repository; uniques into their aggregate.
    const byRepo = new Map();
    for (const p of accepted) {
      if (!p.criterionDecl) continue;
      const list = byRepo.get(p.repo) ?? [];
      list.push(p.criterionDecl);
      byRepo.set(p.repo, list);
    }
    for (const [repo, decls] of byRepo) {
      const sn = accepted[0].sn;
      const text = sn.masked;
      const repoEnd = repo.$cstNode.end - sn.shift;
      const ind = indentAt(text, repo.$cstNode.offset - sn.shift);
      const block = decls
        .map((d) => [...d.comment.map((l) => `${ind}${l}`), `${ind}${d.text}`].join("\n"))
        .join("\n");
      add(sn, [{ start: repoEnd, end: repoEnd, text: `\n${block}` }]);
    }
    const uniques = new Map();
    for (const p of accepted) {
      if (!p.unique) continue;
      const list = uniques.get(p.unique.agg) ?? [];
      if (!list.some((t) => t.join(",") === p.unique.cols.join(","))) list.push(p.unique.cols);
      uniques.set(p.unique.agg, list);
    }
    for (const [agg, tuples] of uniques) {
      const sn = accepted[0].sn;
      const text = sn.masked;
      const close = agg.$cstNode.end - sn.shift - 1;
      const ind = `${indentAt(text, agg.$cstNode.offset - sn.shift)}  `;
      const decls = tuples.map((t) => `unique (${t.join(", ")})`);
      const ls = lineStart(text, close);
      if (text.slice(ls, close).trim() === "") {
        add(sn, [{ start: ls, end: ls, text: decls.map((d) => `${ind}${d}\n`).join("") }]);
      } else {
        let open = close;
        while (open > 0 && text[open - 1] === " ") open--;
        add(sn, [{ start: open, end: open, text: decls.map((d) => `  ${d}`).join("") }]);
      }
    }
  }
  const results = [];
  for (const { file, text, snippets } of parsed) {
    let out = text;
    let changed = 0;
    for (const sn of [...snippets].sort((a, b) => b.start - a.start)) {
      const edits = editsBySnippet.get(sn) ?? [];
      if (edits.length === 0) continue;
      if (edits.some((e) => sn.holes.some(([hs, he]) => e.start < he && e.end > hs))) {
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

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const list = args.includes("--list");
  const addUnique = args.includes("--add-unique");
  const roots = args.filter((a) => !a.startsWith("--"));
  const files = [];
  for (const root of roots.length ? roots : ["."])
    for await (const f of walkFiles(root)) files.push(f);
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
