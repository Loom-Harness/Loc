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
// bundle, NOT the ~190-language full build.  Covered: xml/html, bash, c, cpp,
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

const BODY = `const MARKER = "data-hljs";
const PREFIX = "language-";

function highlightOne(el: Element): void {
  // Marked FIRST: a block deliberately left as plain text (unknown language)
  // must not be re-examined on every later mutation.
  el.setAttribute(MARKER, "1");
  const cls = Array.from(el.classList).find((c) => c.startsWith(PREFIX));
  const language = cls ? cls.slice(PREFIX.length) : "";
  // Unknown / absent language -> plain text, never a throw.
  if (!language || !hljs.getLanguage(language)) return;
  el.classList.add("hljs");
  el.innerHTML = hljs.highlight(el.textContent ?? "", { language, ignoreIllegals: true }).value;
}

function highlightAll(): void {
  for (const el of Array.from(document.querySelectorAll(\`pre code:not([\${MARKER}])\`))) {
    highlightOne(el);
  }
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
export const HIGHLIGHT_MODULE_VITE_TS = `${HEADER}import hljs from "highlight.js/lib/common";
import "highlight.js/styles/github-dark.css";

${BODY}`;

/** The Angular flavour: identical logic, no CSS import — the Angular compiler
 *  rejects a side-effect CSS import from TypeScript (TS2882), so the theme is
 *  listed in \`angular.json\`'s \`styles\` array instead. */
export const HIGHLIGHT_MODULE_ANGULAR_TS = `${HEADER}//
// The theme stylesheet is NOT imported here: Angular's compiler rejects a
// side-effect CSS import from TypeScript.  \`angular.json\` lists
// \`${HIGHLIGHT_THEME_ANGULAR_STYLE}\` in its \`styles\`
// array instead.
import hljs from "highlight.js/lib/common";

${BODY}`;
