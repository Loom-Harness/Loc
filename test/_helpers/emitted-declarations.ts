// Generated-name extraction for the name-uniqueness census
// (test/system/generated-name-uniqueness.test.ts).
//
// Two naming rules minting ONE symbol is a recurring silent defect here:
// #2983 (an operation and a workflow both minting `<Wf>Request`), #3015/#3046/
// #3047 (two rules minting one OpenAPI component), #2879 (Svelte redeclaring a
// picker query in the shared script scope), #2943 (two enums sharing a member
// name). Each rule is locally correct; nothing checks that the SET of names an
// output scope receives is collision-free. These extractors read the emitted
// source back and list every name each scope declares, with the file:line that
// declared it, so a census can name BOTH producers of a collision.
//
// Each extractor is per target language and deliberately shallow (column-0 /
// scope-tracked regexes over source whose inert spans — comments, strings —
// are masked to spaces, so line numbers survive). A name the extractor misses
// costs one missed defect; a name it invents fails correct output and gets the
// gate disabled, so every rule below errs toward missing.

/** One declaration of a name in an output scope. */
export interface Decl {
  /** The scope the name must be unique in — a module, a namespace, a router. */
  readonly scope: string;
  /** The declared name, qualified by the namespace it lives in (e.g. value vs
   *  type space in TypeScript) so legitimately-merging pairs never meet. */
  readonly key: string;
  /** Where it was declared: `path:line`. */
  readonly at: string;
}

/** Replace every comment / string / template span with spaces, keeping
 *  newlines, so column-0 rules and line numbers both still work. `quotes` are
 *  the string delimiters; `line` / `block` the comment openers. */
export function maskInert(
  src: string,
  opts: { line: string[]; block?: [string, string]; quotes: string[]; tripleQuotes?: boolean },
): string {
  const out: string[] = [];
  let i = 0;
  const blank = (s: string): string => s.replace(/[^\n]/g, " ");
  while (i < src.length) {
    const rest = src.startsWith.bind(src);
    const lineOpen = opts.line.find((l) => rest(l, i));
    if (lineOpen) {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? src.length : end;
      out.push(blank(src.slice(i, stop)));
      i = stop;
      continue;
    }
    if (opts.block && rest(opts.block[0], i)) {
      const end = src.indexOf(opts.block[1], i + opts.block[0].length);
      const stop = end === -1 ? src.length : end + opts.block[1].length;
      out.push(blank(src.slice(i, stop)));
      i = stop;
      continue;
    }
    if (opts.tripleQuotes && (rest('"""', i) || rest("'''", i))) {
      const q = src.slice(i, i + 3);
      const end = src.indexOf(q, i + 3);
      const stop = end === -1 ? src.length : end + 3;
      out.push(blank(src.slice(i, stop)));
      i = stop;
      continue;
    }
    const q = opts.quotes.find((qq) => src[i] === qq);
    if (q) {
      let j = i + 1;
      while (j < src.length && src[j] !== q) {
        if (src[j] === "\\") j++;
        // A plain (non-template) string never spans a line; bail rather than
        // swallow the rest of the file on an apostrophe in prose.
        else if (src[j] === "\n" && q !== "`") break;
        j++;
      }
      const stop = Math.min(j + 1, src.length);
      out.push(blank(src.slice(i, stop)));
      i = stop;
      continue;
    }
    out.push(src[i] as string);
    i++;
  }
  return out.join("");
}

const lineAt = (src: string, index: number): number => src.slice(0, index).split("\n").length;

// ---------------------------------------------------------------------------
// TypeScript / TSX (and the <script> of a .svelte / .vue SFC)
// ---------------------------------------------------------------------------

const TS_VALUE = new Set(["const", "let", "var", "function", "class", "enum", "namespace"]);
const TS_TYPE = new Set(["class", "interface", "type", "enum"]);

/** Top-level declarations of one TS module. `class`/`enum` occupy both the
 *  value and the type space; `interface` merges with `interface` by design, and
 *  a `function` overload signature (no body) is not a declaration. */
export function tsTopLevelDecls(path: string, src: string, scope = path): Decl[] {
  const masked = maskInert(src, { line: ["//"], block: ["/*", "*/"], quotes: ['"', "'", "`"] });
  const out: Decl[] = [];
  const re =
    /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(const|let|var|function\*?|class|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/gm;
  for (const m of masked.matchAll(re)) {
    const kind = (m[1] as string).replace("*", "");
    const name = m[2] as string;
    if (kind === "function") {
      // Overload signature: `function f(...): T;` — ends before any `{`.
      const tail = masked.slice((m.index ?? 0) + m[0].length);
      const semi = tail.search(/;\s*$/m);
      const brace = tail.indexOf("{");
      if (semi !== -1 && (brace === -1 || semi < brace)) continue;
    }
    const at = `${path}:${lineAt(masked, m.index ?? 0)}`;
    if (TS_VALUE.has(kind)) out.push({ scope, key: `value ${name}`, at });
    if (TS_TYPE.has(kind) && kind !== "interface") out.push({ scope, key: `type ${name}`, at });
  }
  // `import { X }` binds X in the value space of the module too.
  for (const m of masked.matchAll(/^import\s+(?!type\b)([^;]*?)\s+from\s/gm)) {
    const clause = m[1] as string;
    const at = `${path}:${lineAt(masked, m.index ?? 0)}`;
    const named = /\{([^}]*)\}/.exec(clause);
    if (named)
      for (const part of (named[1] as string).split(",")) {
        const p = part.trim();
        if (!p || p.startsWith("type ")) continue;
        const local = p
          .split(/\s+as\s+/)
          .pop()
          ?.trim();
        if (local) out.push({ scope, key: `value ${local}`, at });
      }
    const def = /^([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(clause.trim());
    if (def) out.push({ scope, key: `value ${def[1]}`, at });
    const star = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause);
    if (star) out.push({ scope, key: `value ${star[1]}`, at });
  }
  return out;
}

/** The instance `<script>` of a Svelte / Vue SFC, dedented, with its starting
 *  line so declarations report the SFC's own line numbers. `context="module"`
 *  scripts are a different scope and are skipped. */
export function sfcScript(src: string): { body: string; firstLine: number } | undefined {
  const m = /<script(?![^>]*context="module")(?![^>]*\bmodule\b)[^>]*>([\s\S]*?)<\/script>/.exec(
    src,
  );
  if (!m) return undefined;
  const raw = m[1] as string;
  const lines = raw.split("\n");
  const indents = lines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)?.[0].length ?? 0);
  const min = indents.length ? Math.min(...indents) : 0;
  return {
    body: lines.map((l) => l.slice(min)).join("\n"),
    firstLine: lineAt(src, (m.index ?? 0) + m[0].indexOf(">") + 1),
  };
}

export function sfcTopLevelDecls(path: string, src: string): Decl[] {
  const script = sfcScript(src);
  if (!script) return [];
  return tsTopLevelDecls(path, script.body).map((d) => {
    const line = Number(d.at.slice(d.at.lastIndexOf(":") + 1));
    return { ...d, at: `${path}:${line + script.firstLine - 1}` };
  });
}

// ---------------------------------------------------------------------------
// Python — a column-0 rebinding silently shadows the first definition.
// ---------------------------------------------------------------------------

export function pyTopLevelDecls(path: string, src: string): Decl[] {
  const masked = maskInert(src, { line: ["#"], quotes: ['"', "'"], tripleQuotes: true });
  const lines = masked.split("\n");
  const out: Decl[] = [];
  // `@overload` stubs and `if TYPE_CHECKING:`/`try:` alternates rebind on
  // purpose; skip a def right after an overload decorator, and only read
  // column 0 (alternate branches are indented).
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] as string;
    let m = /^(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/.exec(l);
    if (m) {
      let k = i - 1;
      let overload = false;
      while (k >= 0 && /^@/.test(lines[k] as string)) {
        if (/^@(?:typing\.)?overload\b/.test(lines[k] as string)) overload = true;
        k--;
      }
      if (!overload) out.push({ scope: path, key: m[1] as string, at: `${path}:${i + 1}` });
      continue;
    }
    m = /^([A-Za-z_]\w*)\s*(?::[^=]*)?=(?!=)/.exec(l);
    if (m && m[1] !== "__all__")
      out.push({ scope: path, key: m[1] as string, at: `${path}:${i + 1}` });
  }
  return out;
}

// ---------------------------------------------------------------------------
// C# — a type name is unique per NAMESPACE, across every file of a project.
// ---------------------------------------------------------------------------

export function csTypeDecls(path: string, src: string, project: string): Decl[] {
  const masked = maskInert(src, { line: ["//"], block: ["/*", "*/"], quotes: ['"'] });
  const ns = /^namespace\s+([\w.]+)\s*;/m.exec(masked)?.[1];
  if (!ns) return []; // block-scoped namespaces: out of this extractor's reach
  const out: Decl[] = [];
  const re =
    /^(?:\[[^\]]*\]\s*)*(?:(?:public|internal|sealed|static|abstract|readonly|file|unsafe|new)\s+)*(partial\s+)?(class|record(?:\s+struct|\s+class)?|interface|enum|struct|delegate\s+[\w<>?,\s[\]]+?)\s+([A-Za-z_]\w*)(\s*<[^>]*>)?/gm;
  for (const m of masked.matchAll(re)) {
    if (m[1]) continue; // partial types merge by design
    const arity = m[4] ? (m[4].match(/,/g)?.length ?? 0) + 1 : 0;
    out.push({
      scope: `${project} namespace ${ns}`,
      key: arity ? `${m[3]}\`${arity}` : (m[3] as string),
      at: `${path}:${lineAt(masked, m.index ?? 0)}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Elixir — a module name is unique per application; a second `defmodule` of
// the same name REDEFINES the first (only a warning).
// ---------------------------------------------------------------------------

export function exModuleDecls(path: string, src: string, project: string): Decl[] {
  const masked = maskInert(src, { line: ["#"], quotes: ['"'], tripleQuotes: true });
  const out: Decl[] = [];
  const stack: { name: string; depth: number }[] = [];
  let depth = 0;
  const lines = masked.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] as string;
    const mod = /^\s*defmodule\s+([A-Z][\w.]*)\s+do\b/.exec(l);
    // Track `do`/`end` nesting coarsely: block openers vs `end` lines.
    const opens = (l.match(/\bdo\s*$/g) ?? []).length + (l.match(/\bfn\b.*->\s*$/g) ?? []).length;
    if (mod) {
      const parent = stack.at(-1)?.name;
      const name = parent ? `${parent}.${mod[1]}` : (mod[1] as string);
      out.push({ scope: `${project} modules`, key: name, at: `${path}:${i + 1}` });
      stack.push({ name, depth });
    }
    depth += opens;
    if (/^\s*end\b/.test(l)) {
      depth--;
      if (stack.length && stack.at(-1)!.depth === depth) stack.pop();
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dart — top-level names are unique per library (file).
// ---------------------------------------------------------------------------

export function dartTopLevelDecls(path: string, src: string): Decl[] {
  if (/^part of\b/m.test(src)) return [];
  const masked = maskInert(src, { line: ["//"], block: ["/*", "*/"], quotes: ['"', "'"] });
  const out: Decl[] = [];
  const re =
    /^(?:abstract\s+|sealed\s+|final\s+|base\s+)*(?:class|enum|mixin|extension|typedef)\s+([A-Za-z_]\w*)|^(?:final|const|var|late\s+final)\s+(?:[\w<>?,\s]+\s+)?([A-Za-z_]\w*)\s*=|^[A-Za-z_][\w<>?,\s]*\s+([a-z_]\w*)\s*\(/gm;
  for (const m of masked.matchAll(re)) {
    const name = m[1] ?? m[2] ?? m[3];
    if (!name || name === "if" || name === "for" || name === "while" || name === "switch") continue;
    out.push({ scope: path, key: name, at: `${path}:${lineAt(masked, m.index ?? 0)}` });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dispatch over a whole generated tree.
// ---------------------------------------------------------------------------

/** The deployable root of an emitted path (`api/src/x.ts` → `api`). */
const deployableOf = (path: string): string => path.split("/")[0] as string;

/** Every scoped declaration in a generated tree, across every target language
 *  this census reads. Java is absent on purpose: one public top-level type per
 *  file, so a collision is a file-path collision and the write-once
 *  `EmissionSink` already refuses it. F# is absent because a module-level
 *  `let` legally shadows. */
export function generatedDecls(files: ReadonlyMap<string, string>): Decl[] {
  const out: Decl[] = [];
  for (const [path, src] of files) {
    if (path.startsWith(".loom/") || /\/node_modules\//.test(path)) continue;
    if (/\.(ts|tsx|mts)$/.test(path) && !path.endsWith(".d.ts"))
      out.push(...tsTopLevelDecls(path, src));
    else if (/\.(svelte|vue)$/.test(path)) out.push(...sfcTopLevelDecls(path, src));
    else if (path.endsWith(".py")) out.push(...pyTopLevelDecls(path, src));
    else if (path.endsWith(".cs")) out.push(...csTypeDecls(path, src, deployableOf(path)));
    else if (/\.exs?$/.test(path) && !/\/(test|priv|deps)\//.test(path))
      out.push(...exModuleDecls(path, src, deployableOf(path)));
    else if (path.endsWith(".dart")) out.push(...dartTopLevelDecls(path, src));
  }
  return out;
}

/** Group by scope + key; every group with two or more declarations is a
 *  collision, reported with every producer's `path:line`. */
export function collisions(decls: readonly Decl[]): { scope: string; key: string; at: string[] }[] {
  const by = new Map<string, Decl[]>();
  for (const d of decls) {
    const k = `${d.scope}\u0000${d.key}`;
    (by.get(k) ?? by.set(k, []).get(k)!).push(d);
  }
  return [...by.values()]
    .filter((ds) => ds.length > 1)
    .map((ds) => ({ scope: ds[0]!.scope, key: ds[0]!.key, at: ds.map((d) => d.at) }));
}

// ---------------------------------------------------------------------------
// Routes and operation ids — unique per deployable.
//
// Two producers registering one METHOD+path is silent on Hono, FastAPI and
// Phoenix (the first registration wins; the second endpoint is unreachable),
// and a duplicate operationId makes the published document invalid OpenAPI and
// collapses two client functions into one. Path params are normalised
// (`{id}` ≡ `:id` ≡ `{orderId}`) because a router matches on shape, not name.
// ---------------------------------------------------------------------------

export function normRoute(method: string, path: string): string {
  let p = `/${path}`.replace(/\/+/g, "/").replace(/\{[^}]*\}|:[A-Za-z_]\w*/g, "{}");
  if (p.length > 1) p = p.replace(/\/$/, "");
  return `${method.toUpperCase()} ${p}`;
}

const joinPath = (...parts: string[]): string => parts.join("/");

/** Hono: `app.route("<prefix>", <fn>(...))` mounts a route module whose
 *  `createRoute({ method, path, operationId })` blocks are relative to it. */
function honoRoutes(dep: string, files: ReadonlyMap<string, string>): Decl[] {
  const mounts = new Map<string, string[]>(); // route-module fn → prefixes
  for (const [, src] of files)
    for (const m of src.matchAll(/\.route\(\s*"([^"]*)",\s*([A-Za-z_$][\w$]*)\(/g))
      (mounts.get(m[2] as string) ?? mounts.set(m[2] as string, []).get(m[2] as string)!).push(
        m[1] as string,
      );
  const out: Decl[] = [];
  for (const [path, src] of files) {
    if (!/\.ts$/.test(path) || !src.includes("createRoute(")) continue;
    // The exported function a `createRoute` block sits in names its mount.
    const fns = [...src.matchAll(/^export (?:async )?function ([A-Za-z_$][\w$]*)\(/gm)].map(
      (m) => ({
        name: m[1] as string,
        at: m.index ?? 0,
      }),
    );
    for (const m of src.matchAll(
      /createRoute\(\{\s*method:\s*"(\w+)",\s*path:\s*"([^"]*)"([\s\S]*?)\n\s{4}\}\)/g,
    )) {
      const fn = fns.filter((f) => f.at < (m.index ?? 0)).at(-1)?.name;
      const prefixes = (fn && mounts.get(fn)) ?? [""];
      const at = `${path}:${lineAt(src, m.index ?? 0)}`;
      for (const prefix of prefixes)
        out.push({
          scope: `${dep} routes`,
          key: normRoute(m[1] as string, joinPath(prefix, m[2] as string)),
          at,
        });
      const op = /operationId:\s*"([^"]+)"/.exec(m[3] as string);
      if (op) out.push({ scope: `${dep} operationIds`, key: op[1] as string, at });
    }
  }
  return out;
}

/** FastAPI: `router = APIRouter(prefix=…)` + `@router.<verb>("…", operation_id=…)`,
 *  mounted by `app.include_router(<alias>, prefix=…)` in main. */
function fastapiRoutes(dep: string, files: ReadonlyMap<string, string>): Decl[] {
  const include = new Map<string, string>(); // module file → include prefix
  for (const [, src] of files) {
    const aliasToFile = new Map<string, string>();
    for (const m of src.matchAll(/^from ([\w.]+) import (\w+)(?: as (\w+))?/gm))
      aliasToFile.set((m[3] ?? m[2]) as string, `${(m[1] as string).replaceAll(".", "/")}.py`);
    for (const m of src.matchAll(/include_router\(\s*(\w+)(?:,\s*prefix="([^"]*)")?/g)) {
      const file = aliasToFile.get(m[1] as string);
      if (file) include.set(file, m[2] ?? "");
    }
  }
  const out: Decl[] = [];
  for (const [path, src] of files) {
    if (!path.endsWith(".py")) continue;
    const routerPrefix = new Map<string, string>();
    for (const m of src.matchAll(/^(\w+)\s*=\s*APIRouter\(([^)]*)\)/gm))
      routerPrefix.set(m[1] as string, /prefix="([^"]*)"/.exec(m[2] as string)?.[1] ?? "");
    if (routerPrefix.size === 0) continue;
    const mount = [...include].find(([f]) => path.endsWith(f))?.[1] ?? "";
    for (const m of src.matchAll(/^@(\w+)\.(get|post|put|patch|delete)\(\s*"([^"]*)"([^\n]*)/gm)) {
      if (!routerPrefix.has(m[1] as string)) continue;
      const at = `${path}:${lineAt(src, m.index ?? 0)}`;
      out.push({
        scope: `${dep} routes`,
        key: normRoute(
          m[2] as string,
          joinPath(mount, routerPrefix.get(m[1] as string)!, m[3] as string),
        ),
        at,
      });
      const op = /operation_id="([^"]+)"/.exec(m[4] as string);
      if (op) out.push({ scope: `${dep} operationIds`, key: op[1] as string, at });
    }
  }
  return out;
}

/** Phoenix: `scope "<p>"[, Mod] do … <verb> "<path>", Controller, :action … end`. */
function phoenixRoutes(dep: string, files: ReadonlyMap<string, string>): Decl[] {
  const out: Decl[] = [];
  for (const [path, src] of files) {
    if (!path.endsWith("/router.ex")) continue;
    const masked = maskInert(src, { line: ["#"], quotes: [], tripleQuotes: true });
    const lines = masked.split("\n");
    const stack: { prefix: string; isScope: boolean }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i] as string;
      const scope = /^\s*scope\s+"([^"]*)"[^\n]*\bdo\s*$/.exec(l);
      if (scope) {
        stack.push({ prefix: scope[1] as string, isScope: true });
        continue;
      }
      if (/\bdo\s*$/.test(l)) {
        stack.push({ prefix: "", isScope: false });
        continue;
      }
      if (/^\s*end\b/.test(l)) {
        stack.pop();
        continue;
      }
      const r = /^\s*(get|post|put|patch|delete)\s+"([^"]*)",\s*([\w.]+),\s*:(\w+)/.exec(l);
      if (!r) continue;
      const prefix = joinPath(...stack.map((s) => s.prefix));
      out.push({
        scope: `${dep} routes`,
        key: normRoute(r[1] as string, joinPath(prefix, r[2] as string)),
        at: `${path}:${i + 1}`,
      });
    }
  }
  return out;
}

/** ASP.NET: `[Route("<base>")]` on the controller + `[Http<Verb>("<sub>")]`
 *  on each action. */
function aspnetRoutes(dep: string, files: ReadonlyMap<string, string>): Decl[] {
  const out: Decl[] = [];
  for (const [path, src] of files) {
    if (!path.endsWith(".cs") || !src.includes("[Http")) continue;
    const lines = src.split("\n");
    let base = "";
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i] as string;
      const route = /^\s*\[Route\("([^"]*)"\)\]/.exec(l);
      if (route && /^\s*\[/.test(l) && !/^\s{4,}/.test(l)) {
        base = route[1] as string;
        continue;
      }
      const verb = /^\s*\[Http(Get|Post|Put|Patch|Delete)(?:\("([^"]*)"\))?\]/.exec(l);
      if (!verb) continue;
      const sub = verb[2] ?? "";
      const full =
        sub.startsWith("/") || sub.startsWith("~/") ? sub.replace(/^~/, "") : joinPath(base, sub);
      out.push({
        scope: `${dep} routes`,
        key: normRoute(verb[1] as string, full),
        at: `${path}:${i + 1}`,
      });
    }
  }
  return out;
}

/** Spring: `@RequestMapping("<base>")` on the class + `@<Verb>Mapping("<sub>")`. */
function springRoutes(dep: string, files: ReadonlyMap<string, string>): Decl[] {
  const out: Decl[] = [];
  for (const [path, src] of files) {
    if (!path.endsWith(".java") || !/@(Get|Post|Put|Patch|Delete)Mapping/.test(src)) continue;
    const lines = src.split("\n");
    let base = "";
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i] as string;
      const cls = /^@RequestMapping\("([^"]*)"\)/.exec(l);
      if (cls) {
        base = cls[1] as string;
        continue;
      }
      const verb =
        /^\s+@(Get|Post|Put|Patch|Delete)Mapping(?:\((?:value\s*=\s*|path\s*=\s*)?"([^"]*)"[^)]*\))?/.exec(
          l,
        );
      if (!verb) continue;
      out.push({
        scope: `${dep} routes`,
        key: normRoute(verb[1] as string, joinPath(base, verb[2] ?? "")),
        at: `${path}:${i + 1}`,
      });
    }
  }
  return out;
}

/** Every route + operation id each deployable of a generated tree registers. */
export function generatedRoutes(files: ReadonlyMap<string, string>): Decl[] {
  const byDep = new Map<string, Map<string, string>>();
  for (const [path, src] of files) {
    const dep = deployableOf(path);
    if (dep === ".loom" || !path.includes("/")) continue;
    (byDep.get(dep) ?? byDep.set(dep, new Map()).get(dep)!).set(path, src);
  }
  const out: Decl[] = [];
  for (const [dep, depFiles] of byDep) {
    out.push(
      ...honoRoutes(dep, depFiles),
      ...fastapiRoutes(dep, depFiles),
      ...phoenixRoutes(dep, depFiles),
      ...aspnetRoutes(dep, depFiles),
      ...springRoutes(dep, depFiles),
    );
  }
  return out;
}
