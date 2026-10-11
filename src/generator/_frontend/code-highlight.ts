// `src/lib/highlight.ts` — the emitted syntax-highlighting runtime behind the
// `CodeBlock { … }` page primitive.  Framework-neutral DOM code, shared by all
// four static-bundle frontends (react/vue/svelte/angular).
//
// VENDORED, not CDN-loaded.  The shells used to inject
// `<script src="https://cdn.jsdelivr.net/gh/highlightjs/…">` into `index.html`,
// which made every generated app depend on a third-party CDN at RUNTIME: it
// does not work air-gapped, and it needs a `script-src`/`style-src` CSP
// allowance the generated app cannot grant on the operator's behalf.  A real
// `highlight.js` dependency (gated on `usesCodeBlock`, exactly as `decimal.js`
// is gated on `usesMoney`) builds into the bundle instead.
//
// SIZE.  The import is `highlight.js/lib/common` — the 36-language common
// bundle, NOT the ~190-language full build — and it is a DYNAMIC import, made
// the first time an unhighlighted `pre code` appears.  A static one folded the
// highlighter into the app's entry chunk, so every visitor paid for it before
// first paint whether or not they ever reached a code block.  Covered: xml/html, bash, c, cpp,
// csharp, css, markdown, diff, ruby, go, graphql, ini/toml, java, javascript,
// json, kotlin, less, lua, makefile, perl, objectivec, php, php-template,
// plaintext, python, python-repl, r, rust, scss, shell, sql, swift, yaml,
// typescript, vbnet, wasm.
//
// DEGRADATION.  A `language:` outside that set is NOT an error: `getLanguage`
// is consulted BEFORE `highlight`, so an unknown language leaves the block as
// plain text rather than throwing (`hljs.highlight` throws `Unknown language`)
// or blanking it.
//
// CSS.  Vite frontends import the theme straight from the module below.
// Angular cannot — its compiler rejects a side-effect CSS import from
// TypeScript (`TS2882: Cannot find module or type declarations for side-effect
// import`), so the Angular project lists the same stylesheet in `angular.json`'s
// `styles` array instead and emits the module WITHOUT the import.

/** The theme stylesheet, as `angular.json`'s `styles` array spells it. */
export const HIGHLIGHT_THEME_ANGULAR_STYLE = "node_modules/highlight.js/styles/github-dark.css";

const BODY = `type Hljs = (typeof import("highlight.js/lib/common"))["default"];

const MARKER = "data-hljs";
const PREFIX = "language-";

// LOADED ON FIRST USE, not at module evaluation.  A static import would fold
// the highlighter into the app's entry chunk, so every visitor would download
// and parse it before first paint whether or not they ever reach a page with a
// code block.  The dynamic import lets the bundler split it into its own chunk
// — same origin, so the app stays self-contained — fetched only once a block
// actually appears.  Memoised: one fetch, however many blocks arrive.  A failed
// load is not retried (that would refetch on every DOM mutation); the blocks
// simply stay plain text.
let loading: Promise<Hljs> | undefined;
function loadHljs(): Promise<Hljs> {
  if (!loading) loading = import("highlight.js/lib/common").then((m) => m.default);
  return loading;
}

function highlightOne(hljs: Hljs, el: Element): void {
  const cls = Array.from(el.classList).find((c) => c.startsWith(PREFIX));
  const language = cls ? cls.slice(PREFIX.length) : "";
  // Unknown / absent language -> plain text, never a throw.
  if (!language || !hljs.getLanguage(language)) return;
  el.classList.add("hljs");
  el.innerHTML = hljs.highlight(el.textContent ?? "", { language, ignoreIllegals: true }).value;
}

function highlightAll(): void {
  const pending = Array.from(document.querySelectorAll(\`pre code:not([\${MARKER}])\`));
  // Nothing to do -> nothing fetched.  This is what keeps a page with no code
  // block from paying for the highlighter at all.
  if (pending.length === 0) return;
  // Marked FIRST and synchronously.  The load is async, and the observer fires
  // on every DOM change in between; without the mark each of those would
  // collect the same blocks again.  It also means a block deliberately left as
  // plain text (unknown language) is never re-examined.
  for (const el of pending) el.setAttribute(MARKER, "1");
  loadHljs().then(
    (hljs) => {
      for (const el of pending) highlightOne(hljs, el);
    },
    () => {
      // The chunk failed to load: leave the blocks readable as plain text.
    },
  );
}

// The app mounts AFTER DOMContentLoaded, so one pass would miss the whole app
// subtree.  A MutationObserver highlights each \`pre code\` once it appears
// (idempotent via the marker attribute).
if (typeof document !== "undefined") {
  const arm = (): void => {
    highlightAll();
    new MutationObserver(highlightAll).observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) arm();
  else document.addEventListener("DOMContentLoaded", arm);
}
`;

const HEADER = `// Auto-generated.  Do not edit by hand.
//
// Syntax highlighting for the \`CodeBlock { … }\` page primitive.  Emitted only
// when some page or component on this deployable renders one — an app without
// \`CodeBlock\` carries neither this module nor the \`highlight.js\` dependency.
//
// \`highlight.js/lib/common\` is the 36-language common bundle, not the
// ~190-language full build.  A \`language:\` outside that set degrades to plain
// text.
`;

/** The Vite flavour (react / vue / svelte): the theme stylesheet is imported
 *  by the module itself, so the bundler emits it alongside the entry chunk. */
export const HIGHLIGHT_MODULE_VITE_TS = `${HEADER}import "highlight.js/styles/github-dark.css";

${BODY}`;

/** The Angular flavour: identical logic, no CSS import — the Angular compiler
 *  rejects a side-effect CSS import from TypeScript (TS2882), so the theme is
 *  listed in \`angular.json\`'s \`styles\` array instead. */
export const HIGHLIGHT_MODULE_ANGULAR_TS = `${HEADER}//
// The theme stylesheet is NOT imported here: Angular's compiler rejects a
// side-effect CSS import from TypeScript.  \`angular.json\` lists
// \`${HIGHLIGHT_THEME_ANGULAR_STYLE}\` in its \`styles\`
// array instead.

${BODY}`;
