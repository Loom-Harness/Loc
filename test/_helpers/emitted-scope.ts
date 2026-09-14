// "Does the emitted code reference a name it never brought into scope?"
//
// This is the single most common way the generated-frontend build gates go
// red.  Of the 16 `main`-red events tracked on #2469, THIRTEEN were one
// instance of it: a paged `Table`'s pager chrome emitted `t("chrome.prev", …)`
// into a page that never imported `t`, so every generated project with a paged
// list and i18n on shipped a TS2304 (#2507).
//
// The reason it survived ten consecutive red sweeps is the shape worth
// remembering: it is a STATIC defect that only a COMPILER was looking for.
// `generated-react-build` compiles a 2-cell slice at PR time
// (`examples/showcase.ddd` × 2 packs) and the full 160-cell matrix only on
// `push: main`, so the introducing PR was green and the sweep was red
// afterwards — the workflow's own header calls this out ("Misses per-example
// drift").  No amount of merging `main` into the branch would have caught it:
// the failing cell is simply not in the PR gate's input set.
//
// But finding an unbound identifier never needed a type-checker.  Generating
// all 160 cells takes ~47s in-process (~294ms each); COMPILING them takes
// 60-90s per cell.  So the detection moves off the compiler and into the fast
// suite, where it runs per-PR over the whole matrix instead of post-merge over
// a slice.
//
// WHAT THIS DOES NOT DO.  It is a scope check, not a type check.  A prop-type
// mismatch, a DTO shape divergence, an arity error — none of those are visible
// here, and the `push: main` compile sweep remains the net for them.  This
// converts the most frequent failure mode into a per-PR check; it does not
// make the sweep redundant.

/** How each frontend names its page files, and the forms in which a page may
 *  legitimately bind the translate function.
 *
 *  The binding list is the load-bearing part: a check that only looked for
 *  `import { t }` would report every Angular page as broken, since Angular
 *  pages expose it as a class member instead. */
export interface FrontendScopeSpec {
  readonly framework: string;
  /** Files to inspect — the pages that render walker output. */
  readonly pages: RegExp;
}

export const FRONTEND_SCOPES: readonly FrontendScopeSpec[] = [
  { framework: "react", pages: /\/src\/pages\/.*\.tsx$/ },
  { framework: "vue", pages: /\/src\/pages\/.*\.vue$/ },
  { framework: "svelte", pages: /\+page\.svelte$/ },
  { framework: "angular", pages: /\/src\/app\/pages\/.*\.component\.ts$/ },
];

/** True when `content` brings `t` into scope by any of the legitimate routes.
 *
 *  - a named import — `import { t } from "…"` (react/vue/svelte)
 *  - an Angular class member — `protected readonly t = t`
 *  - a local alias — `const t = …`
 *
 *  Deliberately permissive: a FALSE PASS here costs one missed defect, while a
 *  false FAIL would fire on every page of a frontend whose binding form we did
 *  not anticipate and would get the whole gate disabled. */
export function bindsTranslate(content: string): boolean {
  return (
    /\bimport\s*\{[^}]*\bt\b[^}]*\}/.test(content) ||
    /\breadonly t = t\b/.test(content) ||
    /\b(?:const|let|var)\s+t\s*=/.test(content)
  );
}

/** Every page file that CALLS `t(` without binding it.  Returns the offending
 *  paths so a failure names them rather than just counting. */
export function unboundTranslateCalls(files: ReadonlyMap<string, string>, pages: RegExp): string[] {
  const bad: string[] = [];
  for (const [path, content] of files) {
    if (!pages.test(path)) continue;
    if (!/\bt\(/.test(content)) continue;
    if (!bindsTranslate(content)) bad.push(path);
  }
  return bad;
}

/** Page files that actually reached the translate runtime.
 *
 *  The vacuity guard.  `unboundTranslateCalls` returns `[]` both when every
 *  page is correct AND when nothing emitted a `t(` call at all — including
 *  when generation silently produced no pages.  A sweep that cannot tell those
 *  apart reports a comforting green for a broken harness, which is the exact
 *  failure mode `experience_gathered.md` §59/§63 keeps recording. */
export function translatingPages(files: ReadonlyMap<string, string>, pages: RegExp): string[] {
  return [...files]
    .filter(([path, content]) => pages.test(path) && /\bt\(/.test(content))
    .map(([path]) => path);
}

// ---------------------------------------------------------------------------
// The GENERAL case of the question this file's header asks.
//
// `unboundTranslateCalls` above answers it for exactly one name, `t`, in the
// frontend page tree.  The same defect class reaches the BACKEND tree with a
// different name every time: a value object holding an `X id` emits
// `Ids.ShipId` into a `domain/value-objects.ts` with no imports at all; a
// system whose `user { … }` block declares an `X id?` claim emits `Ids.` into
// the two auth files; a workflow whose state field is an enum emits
// `<Enum>Schema`, a symbol defined nowhere in the tree.  Each is a TS2304 /
// TS2503 in a project the toolchain reported as `0 error(s), 0 warning(s)`.
//
// Detection needs no type-checker, only scope: blank out the spans where a
// capitalised token is not an identifier (comments, all three string forms,
// regex literals), collect what the file BINDS, collect what it REFERENCES,
// and subtract.  Measured over the whole example corpus — 48 generated backend
// trees, 1241 TypeScript files — this reports **zero** names, so the signal is
// the defect rather than the heuristic.
//
// SCOPED TO THE BACKEND TREE ON PURPOSE.  The same scan over the frontend
// trees is noisy: JSX text content is not a string literal (`>Assign To
// Route<` reads as three capitalised identifiers), and SvelteKit's generated
// ambient `$types` declarations use bare single-letter generics.  Making it
// precise there needs a JSX-aware pass; until then the frontend keeps the
// narrow `t`-binding check above.
// ---------------------------------------------------------------------------

/** Blank out every span where a capitalised token is not an identifier.
 *
 *  A single pass rather than a chain of `replace`s: a `'…"…'` string ends the
 *  chain's double-quote rule in the wrong place, and `[a-zA-Z0-9]` inside a
 *  regex literal survives it as the identifier `Z0`.  Both were real false
 *  positives while this was being calibrated. */
export function stripInertTs(src: string): string {
  const out: string[] = [];
  let i = 0;
  let prevMeaningful = "";
  while (i < src.length) {
    const c = src[i] as string;
    const c2 = src[i + 1];
    if (c === "/" && c2 === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      out.push(" ");
      continue;
    }
    if (c === "/" && c2 === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      out.push(" ");
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\") i++;
        i++;
      }
      i++;
      out.push(c === "`" ? "``" : c + c);
      prevMeaningful = "s";
      continue;
    }
    // A `/` after a value is division; after an operator it opens a regex.
    if (c === "/" && !/[\w$)\]]/.test(prevMeaningful)) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < src.length) {
        const d = src[j] as string;
        if (d === "\\") {
          j += 2;
          continue;
        }
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) {
          closed = true;
          break;
        } else if (d === "\n") break;
        j++;
      }
      if (closed) {
        i = j + 1;
        while (i < src.length && /[dgimsuvy]/.test(src[i] as string)) i++;
        out.push("/__re__/");
        prevMeaningful = ")";
        continue;
      }
    }
    out.push(c);
    if (!/\s/.test(c)) prevMeaningful = c;
    i++;
  }
  return out.join("");
}

/** Names a module brings into scope: imports, and every declaration form.
 *
 *  Deliberately over-inclusive, for the same reason `bindsTranslate` is: a
 *  missed binding form fires on correct output and gets the whole gate
 *  disabled, while an extra one costs at most one missed defect. */
export function boundNames(stripped: string): Set<string> {
  const out = new Set<string>();
  const add = (n: string | undefined): void => {
    if (n) out.add(n);
  };
  for (const m of stripped.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}/g))
    for (const part of (m[1] as string).split(","))
      add(
        part
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)
          .pop()
          ?.trim(),
      );
  for (const m of stripped.matchAll(/import\s+(?:type\s+)?\*\s+as\s+(\w+)/g)) add(m[1]);
  for (const m of stripped.matchAll(/import\s+(?:type\s+)?(\w+)\s*(?:,|from)/g)) add(m[1]);
  for (const m of stripped.matchAll(
    /\b(?:const|let|var|function|class|interface|type|enum|namespace)\s+(\w+)/g,
  ))
    add(m[1]);
  for (const m of stripped.matchAll(/export\s*\{([^}]*)\}/g))
    for (const part of (m[1] as string).split(","))
      add(
        part
          .trim()
          .split(/\s+as\s+/)[0]
          ?.trim(),
      );
  for (const m of stripped.matchAll(/<\s*([A-Z]\w*)\s*(?:,|>|\s+extends)/g)) add(m[1]);
  return out;
}

/** Capitalised tokens the module references as free identifiers — skipping
 *  member accesses (`foo.Bar`) and object-literal keys (`Bar:`). */
export function referencedNames(stripped: string): Set<string> {
  const out = new Set<string>();
  const re = /(^|[^.\w$])([A-Z][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null = re.exec(stripped);
  while (m !== null) {
    if (stripped[re.lastIndex] !== ":") out.add(m[2] as string);
    m = re.exec(stripped);
  }
  return out;
}

/** Ambient names no module has to import.  Kept to the ECMAScript + Node +
 *  TypeScript-utility surface the emitters actually reach for. */
export const AMBIENT_TS_NAMES: ReadonlySet<string> = new Set([
  "Array",
  "ArrayBuffer",
  "AsyncIterable",
  "Atomics",
  "Awaited",
  "BigInt",
  "Blob",
  "Boolean",
  "Buffer",
  "Capitalize",
  "Date",
  "Error",
  "Event",
  "EventTarget",
  "Exclude",
  "Extract",
  "File",
  "FormData",
  "Function",
  "Generator",
  "Headers",
  "Infinity",
  "InstanceType",
  "Intl",
  "Iterable",
  "Iterator",
  "JSON",
  "Map",
  "Math",
  "NaN",
  "NodeJS",
  "NonNullable",
  "Number",
  "Object",
  "Omit",
  "Parameters",
  "Partial",
  "Pick",
  "Promise",
  "Proxy",
  "ReadonlyArray",
  "ReadonlyMap",
  "ReadonlySet",
  "Readonly",
  "Record",
  "Reflect",
  "RegExp",
  "Request",
  "Required",
  "Response",
  "ReturnType",
  "Set",
  "String",
  "Symbol",
  "TextDecoder",
  "TextEncoder",
  "ThisType",
  "URL",
  "URLSearchParams",
  "Uint8Array",
  "Uppercase",
  "Lowercase",
  "WeakMap",
  "WeakSet",
]);

/** Directories the emitted tree shows to be a BACKEND project root: one that
 *  holds both a `domain/` and a `db/` directory.  Derived from the file map
 *  rather than matched by name, because a frontend project also has `lib/` and
 *  `api/` segments and a path-shaped filter picks those up (measured: it
 *  reported SvelteKit's `$types` generics and `import.meta.env` keys). */
export function backendRoots(files: ReadonlyMap<string, string>): string[] {
  const domains = new Set<string>();
  const dbs = new Set<string>();
  for (const path of files.keys()) {
    const d = /^(.*)\/domain\//.exec(path);
    if (d) domains.add(d[1] as string);
    const b = /^(.*)\/db\//.exec(path);
    if (b) dbs.add(b[1] as string);
  }
  return [...domains].filter((r) => dbs.has(r)).sort();
}

/** Emitted backend TypeScript, excluding ambient `.d.ts` declarations. */
export function isBackendTs(path: string, roots: readonly string[]): boolean {
  if (!path.endsWith(".ts") || path.endsWith(".d.ts")) return false;
  return roots.some((r) => path.startsWith(`${r}/`));
}

export interface UnboundRef {
  readonly path: string;
  readonly name: string;
}

/** Every `(file, name)` the emitted tree references without binding. */
export function unboundIdentifiers(files: ReadonlyMap<string, string>): UnboundRef[] {
  const roots = backendRoots(files);
  const bad: UnboundRef[] = [];
  for (const [path, content] of files) {
    if (!isBackendTs(path, roots)) continue;
    const stripped = stripInertTs(content);
    const bound = boundNames(stripped);
    for (const name of referencedNames(stripped)) {
      if (bound.has(name) || AMBIENT_TS_NAMES.has(name)) continue;
      bad.push({ path, name });
    }
  }
  return bad;
}

/** The vacuity guard for `unboundIdentifiers` — files the filter actually
 *  selected.  An empty offender list means "clean" only when this is non-empty. */
export function scannedBackendFiles(files: ReadonlyMap<string, string>): string[] {
  const roots = backendRoots(files);
  return [...files.keys()].filter((p) => isBackendTs(p, roots));
}
