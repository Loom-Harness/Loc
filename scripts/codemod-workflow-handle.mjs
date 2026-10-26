// Codemod for the hard cutover that removed the workflow `handle` member
// (D-HANDLE-REMOVAL).  A named command entry is a context-level
// `commandHandler`; the codemod lifts each `handle` out of its workflow and
// writes it right after the workflow as a `commandHandler` with the same
// name, parameters and body:
//
//   before                                       after
//   workflow Settle {                            workflow Settle {
//     create(id: Order id) { … }                   create(id: Order id) { … }
//     handle settle(id: Order id) {              }
//       let o = Orders.byId(id)                  commandHandler settle(id: Order id) {
//       o.settle()                                 let o = Orders.byId(id)
//     }                                            o.settle()
//   }                                            }
//
// The workflow itself stays (it may carry `create` / `on` members, and its
// instance-read surface is unchanged); one left with no members is still a
// valid, empty workflow.
//
//   node scripts/codemod-workflow-handle.mjs [--check] [--list] <path>...
//
//   <path>   a `.ddd` file or a directory (walked recursively, skipping
//            node_modules / .git / dist / out / .loom).  Defaults to `.`.
//   --check  write nothing; exit 1 when any file still has a workflow `handle`.
//   --list   write nothing; print the files that would change.
//
// Text-level and deliberately conservative: it never re-parses or reprints a
// file, so formatting and comments survive outside the members it moves.  It
// is comment- and string-aware and idempotent (a file with no workflow
// `handle` is left byte-identical).
//
// A `handle` is NOT lifted — it stays where it is, with a
// `// codemod-workflow-handle: not lifted — <reason>` line above it, and the
// file is reported — when no faithful `commandHandler` exists for it:
//   - its parameters, gates or body read the workflow's OWN state or helpers
//     (a state field, a workflow `function`, `this`): a `commandHandler` has
//     no workflow instance, so the rewrite would change what the name means;
//   - the workflow is `eventSourced`: its events fold into the workflow's
//     state through `apply`, which a context-level handler does not reach;
//   - it carries a `requires` gate (or a `private` / `audited` / `extern` /
//     `when` modifier): a `commandHandler` takes none of them — the gate
//     belongs on the aggregate operation the handler calls;
//   - the context already declares a `commandHandler` / `queryHandler` of the
//     same name (or an earlier lifted `handle` took it): the route target
//     `Ctx.<name>` would become ambiguous;
//   - a parameter is named `id` (reserved in a handler), or the body reaches
//     more than one aggregate through its repositories / `X.create(…)` (a
//     commandHandler orchestrates one aggregate; a multi-aggregate saga step
//     stays a workflow).
// The compiler still validates the lifted handler: anything this text-level
// pass cannot see is reported there, against the `commandHandler`.
// Rewrite those by hand — usually as an aggregate `operation` that owns the
// state transition, or a second workflow started by an event.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "out", ".loom"]);
const MARKER = "// codemod-workflow-handle: not lifted";

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

/** The offset of the bracket matching the opener at `open` (`{`/`(`), or -1. */
function matching(src, code, open) {
  const o = src[open];
  const c = o === "{" ? "}" : ")";
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

/** A word at `at` that is code and stands alone (no identifier char on
 *  either side). */
function wordAt(src, code, at, word) {
  return (
    code[at] === 1 &&
    src.startsWith(word, at) &&
    !isIdent(src[at - 1]) &&
    !isIdent(src[at + word.length])
  );
}

/** Every `<kw> <Name> … { … }` block of `src` for one keyword: the keyword
 *  offset, its name, the head text between the name and the body `{`, and
 *  the body's brace offsets. */
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
    out.push({ at, name: m[1], head: src.slice(at + kw.length + m[0].length, j), open: j, close });
    i = close + 1;
  }
  return out;
}

/** The members of a workflow body that a `handle` could read: its state
 *  fields (`name: T` at member depth) and its `function` helpers. */
function workflowScopedNames(src, code, open, close) {
  const names = new Set();
  let depth = 0;
  for (let k = open + 1; k < close; k++) {
    if (!code[k]) continue;
    const ch = src[k];
    if (ch === "{" || ch === "(") depth++;
    else if (ch === "}" || ch === ")") depth--;
    else if (depth === 0 && /[A-Za-z_]/.test(ch) && !isIdent(src[k - 1])) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*(:(?![:=]))?/.exec(src.slice(k));
      if (!m) continue;
      if (m[2]) names.add(m[1]);
      else if (m[1] === "function") {
        const f = /^function\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(src.slice(k));
        if (f) names.add(f[1]);
      }
      k += m[1].length - 1;
    }
  }
  return names;
}

/** The first workflow-scoped name `[from, to)` reads as a bare identifier (not
 *  after a `.`, so `o.status` is a field of `o`, not the state field
 *  `status`), or `this`. */
function firstScopedRead(src, code, from, to, scoped) {
  const re = /[A-Za-z_][A-Za-z0-9_]*/g;
  re.lastIndex = from;
  for (let m = re.exec(src); m && m.index < to; m = re.exec(src)) {
    if (!code[m.index]) continue;
    let p = m.index - 1;
    while (p >= from && /\s/.test(src[p])) p--;
    if (src[p] === ".") continue;
    if (m[0] === "this" || scoped.has(m[0])) return m[0];
  }
  return undefined;
}

/** Start of the line holding `offset`, and that line's indentation. */
function lineOf(src, offset) {
  const start = src.lastIndexOf("\n", offset - 1) + 1;
  return { start, indent: /^[\t ]*/.exec(src.slice(start))[0] };
}

/** Lift every workflow `handle` in `src` into a context-level
 *  `commandHandler`.  Returns the new text, the number of handles lifted, and
 *  the ones refused (with the reason) — refused handles stay in place, marked.
 *  `changed === 0 && refused.length === 0` ⇒ `text === src`. */
export function liftWorkflowHandles(src) {
  const code = codeMask(src);
  /** @type {{ at: number, end: number, insert?: { at: number, text: string }, marker?: string }[]} */
  const edits = [];
  const refused = [];
  let changed = 0;
  // Workflows are scanned per context, so a name clash is judged against the
  // context the lifted handler lands in.
  const contexts = blocksOf(src, code, "context");
  const scopes = contexts.length > 0 ? contexts : [{ open: -1, close: src.length, name: "" }];
  for (const ctx of scopes) {
    const ctxText = src.slice(ctx.open + 1, ctx.close);
    const taken = new Set(
      [...ctxText.matchAll(/\b(?:commandHandler|queryHandler)\s+([A-Za-z_][A-Za-z0-9_]*)/g)].map(
        (m) => m[1],
      ),
    );
    // Repository → aggregate, and the aggregate names, for the one-aggregate
    // rule a commandHandler carries.
    const repoFor = new Map(
      [
        ...ctxText.matchAll(
          /\brepository\s+([A-Za-z_][A-Za-z0-9_]*)\s+for\s+([A-Za-z_][A-Za-z0-9_]*)/g,
        ),
      ].map((m) => [m[1], m[2]]),
    );
    const aggs = new Set(
      [...ctxText.matchAll(/\baggregate\s+([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]),
    );
    for (const wf of blocksOf(src, code, "workflow", ctx.open + 1, ctx.close)) {
      const eventSourced = /\beventSourced\b/.test(wf.head);
      const scoped = workflowScopedNames(src, code, wf.open, wf.close);
      const wfIndent = lineOf(src, wf.at).indent;
      const lifted = [];
      let depth = 0;
      for (let k = wf.open + 1; k < wf.close; k++) {
        if (!code[k]) continue;
        const ch = src[k];
        if (ch === "{" || ch === "(") depth++;
        else if (ch === "}" || ch === ")") depth--;
        if (depth !== 0 || !wordAt(src, code, k, "handle")) continue;
        const sig = /^handle\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(src.slice(k));
        if (!sig) continue;
        const name = sig[1];
        const paren = k + sig[0].length - 1;
        const parenClose = matching(src, code, paren);
        if (parenClose < 0) break;
        // The header tail (modifiers, `requires`/`when` gates) runs to the
        // body `{`.
        let open = parenClose + 1;
        while (open < wf.close && !(code[open] && src[open] === "{")) open++;
        const close = open < wf.close ? matching(src, code, open) : -1;
        if (close < 0) break;
        // A leading `private` modifier belongs to the member (and is refused:
        // a commandHandler takes none).
        const handleAt = k;
        const lead = /(?:^|[^A-Za-z0-9_])(private\s+)$/.exec(src.slice(wf.open + 1, k));
        const start = lead ? k - lead[1].length : k;
        const line = lineOf(src, start);
        const header = src.slice(parenClose + 1, open);
        const modifier = lead ? "private" : /\b(audited|extern|when)\b/.exec(header)?.[1];
        const why = eventSourced
          ? `workflow '${wf.name}' is eventSourced — its events fold into the workflow's own state`
          : /\brequires\b/.test(header)
            ? "it carries a `requires` gate, and a commandHandler takes none — gate the aggregate operation it calls"
            : modifier
              ? `'${modifier}' is not allowed on a commandHandler`
              : (() => {
                  // A parameter or local of the handle shadows a state field of
                  // the same name (params bind on top of the workflow's `this`).
                  const own = src.slice(paren, close);
                  const locals = new Set(
                    [
                      ...src.slice(paren + 1, parenClose).matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g),
                      ...own.matchAll(/\b(?:let|for)\s+([A-Za-z_][A-Za-z0-9_]*)/g),
                    ].map((m) => m[1]),
                  );
                  const visible = new Set([...scoped].filter((n) => !locals.has(n)));
                  const read = firstScopedRead(src, code, paren, close, visible);
                  if (read)
                    return `it reads the workflow's own ${read === "this" ? "`this`" : `'${read}'`}`;
                  if (taken.has(name))
                    return `context '${ctx.name}' already has a handler named '${name}'`;
                  if (/(?:^|[(,])\s*id\s*:/.test(src.slice(paren, parenClose))) {
                    return "a parameter is named 'id', which a commandHandler reserves — rename it first";
                  }
                  const touched = new Set();
                  for (const m of own.matchAll(
                    /\b([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_]\w*)/g,
                  )) {
                    const agg =
                      repoFor.get(m[1]) ?? (m[2] === "create" && aggs.has(m[1]) ? m[1] : undefined);
                    if (agg) touched.add(agg);
                  }
                  if (touched.size > 1) {
                    return `it touches ${touched.size} aggregates (${[...touched].join(", ")}), and a commandHandler orchestrates one`;
                  }
                  return undefined;
                })();
        k = close;
        if (why) {
          refused.push({ workflow: wf.name, handle: name, reason: why });
          const markerLine = src.slice(lineOf(src, line.start - 1).start, line.start);
          if (!markerLine.includes(MARKER)) {
            edits.push({
              at: line.start,
              end: line.start,
              marker: `${line.indent}${MARKER} — ${why}\n`,
            });
          }
          continue;
        }
        taken.add(name);
        changed++;
        // Remove the whole member line(s) when it stands alone on them.
        const blankBefore = src.slice(line.start, start).trim() === "";
        const after = src.slice(
          close + 1,
          src.indexOf("\n", close) < 0 ? src.length : src.indexOf("\n", close),
        );
        const removeFrom = blankBefore ? line.start : start;
        const removeTo =
          after.trim() === "" && blankBefore ? close + 1 + after.length + 1 : close + 1;
        edits.push({ at: removeFrom, end: Math.min(removeTo, wf.close) });
        // `handle` → `commandHandler`, re-indented to the workflow's own level.
        const member = `commandHandler${src.slice(handleAt + "handle".length, close + 1)}`;
        const shift = line.indent.length - wfIndent.length;
        const body = member
          .split("\n")
          .map((l, i) =>
            i === 0 ? l : l.startsWith(line.indent) && shift > 0 ? l.slice(shift) : l,
          )
          .join("\n");
        lifted.push(`${wfIndent}${body}`);
      }
      if (lifted.length > 0) {
        edits.push({ at: wf.close + 1, end: wf.close + 1, insert: `\n${lifted.join("\n")}` });
      }
    }
  }
  if (edits.length === 0) return { text: src, changed, refused };
  let out = src;
  for (const e of [...edits].sort((a, b) => b.at - a.at || b.end - a.end)) {
    const piece = e.insert ?? e.marker ?? "";
    out = out.slice(0, e.at) + piece + out.slice(e.end);
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
  let lifted = 0;
  let refusedCount = 0;
  for (const f of files) {
    const src = await fs.readFile(f, "utf8");
    const { text, changed, refused } = liftWorkflowHandles(src);
    for (const r of refused) {
      console.log(`not lifted  ${f}: workflow ${r.workflow} handle ${r.handle} — ${r.reason}`);
    }
    refusedCount += refused.length;
    if (!changed && refused.length === 0) continue;
    changedFiles++;
    lifted += changed;
    if (check || list) console.log(f);
    else if (text !== src) {
      await fs.writeFile(f, text);
      console.log(`lifted ${changed} handle(s)  ${f}`);
    }
  }
  const verb = check || list ? "would lift" : "lifted";
  console.log(
    `${verb} ${lifted} workflow handle(s) in ${changedFiles} of ${files.length} file(s); ${refusedCount} need a hand rewrite`,
  );
  if ((check && changedFiles > 0) || refusedCount > 0) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
