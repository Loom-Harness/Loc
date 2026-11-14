#!/usr/bin/env node
// Render docs/*.md → docs/_site/*.html using a template that matches
// the landing page styling. Recurses into the RENDERED_SUBDIRS and
// emits an index.html for each so the README's directory links
// resolve (GitHub Pages does not auto-index).  Copies docs/index.html
// with .md→.html link rewrites, and copies the shared stylesheet.

import { readFile, writeFile, readdir, mkdir, copyFile, rm, stat } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename, relative, resolve, posix } from 'node:path';
import { marked } from 'marked';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(HERE);
// `LOOM_DOCS_OUT` redirects the build (the link-check test builds into a
// scratch directory).
const OUT  = process.env.LOOM_DOCS_OUT ? resolve(process.env.LOOM_DOCS_OUT) : join(HERE, '_site');

// Where a link to a repository file the site does not publish goes instead.
const SOURCE_BASE = 'https://github.com/Loom-Harness/Loc';

// Subdirs whose .md content is also rendered.  Nested paths are
// supported (depth derived from the path).
export const RENDERED_SUBDIRS = ['language-reference', 'architecture', 'decisions'];

// Nav surfaces the top-level reading order — keep in sync with
// docs/README.md's "Start here" table and docs/index.html's footer.
const NAV = [
  { label: 'All docs',     href: 'README.html' },
  { label: 'Reference',    href: 'language-reference/README.html' },
  { label: 'Language',     href: 'language.html' },
  { label: 'Pages',        href: 'page-metamodel.html' },
  { label: 'System',       href: 'architecture.html' },
  { label: 'Generators',   href: 'generators.html' },
  { label: 'Tools',        href: 'tools.html' },
  { label: 'Internals',    href: 'technical.html' },
];

// Every relative link is resolved against the page being rendered.  A link to
// a page the site publishes (a top-level `docs/*.md`, or one inside a
// RENDERED_SUBDIRS directory) becomes its `.html`; a link to any other file or
// directory in the repository (src/, test/, examples/, ../LICENSE, …) becomes
// its GitHub URL, because the site does not serve it.  `renderingSrc` is the
// source path of the page being rendered — marked's walkTokens has no other
// way to know it.
let renderingSrc = join(HERE, 'README.md');

const isPublishedPage = (abs) => {
  const rel = relative(HERE, abs).split('\\').join('/');
  if (rel.startsWith('..') || !rel.endsWith('.md')) return false;
  const dir = posix.dirname(rel);
  return dir === '.' || RENDERED_SUBDIRS.includes(dir);
};
const isPublishedDir = (abs) => {
  const rel = relative(HERE, abs).split('\\').join('/');
  return rel === '' || RENDERED_SUBDIRS.includes(rel.replace(/\/$/, ''));
};

export function rewriteHref(href, fromSrc) {
  if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(href)) return href;
  const hashAt = href.indexOf('#');
  const path = hashAt < 0 ? href : href.slice(0, hashAt);
  const hash = hashAt < 0 ? '' : href.slice(hashAt);
  if (path === '') return href;
  const abs = resolve(dirname(fromSrc), decodeURIComponent(path));
  if (isPublishedPage(abs)) return `${path.replace(/\.md$/, '.html')}${hash}`;
  if (isPublishedDir(abs)) return href;
  const repoRel = relative(REPO, abs).split('\\').join('/');
  if (repoRel.startsWith('..') || !existsSync(abs)) return href; // left for the link check to report
  const kind = statSync(abs).isDirectory() ? 'tree' : 'blob';
  return `${SOURCE_BASE}/${kind}/main/${repoRel}${hash}`;
}

marked.use({
  gfm: true,
  walkTokens(token) {
    if (token.type === 'link' && typeof token.href === 'string') {
      token.href = rewriteHref(token.href, renderingSrc);
    }
  },
});

// Heading anchors.  GitHub's slug rule (lowercase; keep letters, digits,
// spaces, hyphens, underscores; each space → hyphen) so one `#anchor` works on
// GitHub and on the rendered site.  The playground's Problems rows link into
// `language-reference/<chapter>.html#<slug>` (src/diagnostics/code-docs.ts,
// which carries the same rule — keep the two in step; the docs-anchors test
// checks the entries there against the markdown headings).
const headingSlug = (text) =>
  text.trim().toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/ /g, '-');

marked.use({
  renderer: {
    heading({ tokens, depth }) {
      const inner = this.parser.parseInline(tokens);
      const plain = tokens.map((t) => t.text ?? t.raw ?? '').join('');
      return `<h${depth} id="${escapeAttr(headingSlug(plain))}">${inner}</h${depth}>\n`;
    },
  },
});

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
}[c]));
const escapeAttr = (s) => escapeHtml(String(s));

// Platform-tabs block extension.  Authoring syntax (also degrades
// readably on GitHub, which just shows the markers as text but still
// renders the inner code fences):
//
//   ::: tabs backend
//   == node
//   ```ts
//   ...generated output...
//   ```
//   == dotnet
//   ```csharp
//   ...
//   ```
//   ::: end
//
// The optional word after `tabs` is the *group*: every tab group on a
// page sharing a group name switches together (pick "node" once, every
// backend group follows), persisted in localStorage.  Inner content of
// each `== <name>` segment is full markdown (so a tab can hold prose +
// multiple code blocks), rendered with highlight.js client-side.
const platformTabs = {
  name: 'platformTabs',
  level: 'block',
  start(src) {
    const i = src.indexOf('::: tabs');
    return i < 0 ? undefined : i;
  },
  tokenizer(src) {
    const m = /^::: tabs[ \t]*([^\n]*)\n([\s\S]*?)\n::: end[ \t]*(?:\n|$)/.exec(src);
    if (!m) return undefined;
    const group = (m[1] || 'platform').trim() || 'platform';
    const segments = m[2].split(/^==[ \t]+/m).filter((s) => s.trim().length);
    const tabs = segments.map((seg) => {
      const nl = seg.indexOf('\n');
      const name = (nl < 0 ? seg : seg.slice(0, nl)).trim();
      const inner = nl < 0 ? '' : seg.slice(nl + 1);
      return { name, tokens: this.lexer.blockTokens(inner.trim()) };
    });
    return { type: 'platformTabs', raw: m[0], group, tabs };
  },
  renderer(token) {
    const btns = token.tabs.map((t, i) =>
      `<button class="lt-tab${i === 0 ? ' active' : ''}" type="button" role="tab" data-tab="${escapeAttr(t.name)}">${escapeHtml(t.name)}</button>`,
    ).join('');
    const panels = token.tabs.map((t, i) =>
      `<div class="lt-panel${i === 0 ? ' active' : ''}" role="tabpanel" data-tab="${escapeAttr(t.name)}">${this.parser.parse(t.tokens)}</div>`,
    ).join('');
    return `<div class="lt-tabs" data-group="${escapeAttr(token.group)}"><div class="lt-tablist" role="tablist">${btns}</div>${panels}</div>`;
  },
};

marked.use({ extensions: [platformTabs] });

const extractTitle = (md, fallback) => {
  const m = md.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1].replace(/^Loom\s+[—–-]\s+/, '') : fallback;
};

// Per-page nav: a doc rendered into a subdir needs `../` on every link.
const navLinks = (currentHref, depth) => {
  const prefix = depth > 0 ? '../'.repeat(depth) : '';
  return NAV.map(({ label, href }) =>
    `<a href="${prefix}${href}"${href === currentHref ? ' class="current"' : ''}>${label}</a>`
  ).join('\n        ');
};

const header = (currentHref, depth) => {
  const prefix = depth > 0 ? '../'.repeat(depth) : '';
  return `<header class="site">
  <div class="container nav">
    <a class="brand" href="${prefix}index.html">
      <svg class="logo" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <defs><linearGradient id="lg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#b58cff"/><stop offset="1" stop-color="#6fd1ff"/></linearGradient></defs>
        <rect x="2" y="2" width="28" height="28" rx="7" stroke="url(#lg)" stroke-width="2"/>
        <path d="M7 10 L25 22 M7 16 L25 16 M7 22 L25 10" stroke="url(#lg)" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <span class="brand-name">Loom</span>
    </a>
    <nav class="nav-links" aria-label="Primary">
        ${navLinks(currentHref, depth)}
        <a class="btn" href="https://github.com/Loom-Harness/loc" target="_blank" rel="noopener">GitHub</a>
    </nav>
  </div>
</header>`;
};

const footer = (depth) => {
  const prefix = depth > 0 ? '../'.repeat(depth) : '';
  return `<footer class="site">
  <div class="container row">
    <div>© Loom contributors · FSL-1.1-Apache-2.0</div>
    <div class="links">
      ${NAV.map(({ label, href }) => `<a href="${prefix}${href}">${label}</a>`).join('\n      ')}
      <a href="https://github.com/Loom-Harness/loc" target="_blank" rel="noopener">GitHub</a>
    </div>
  </div>
</footer>`;
};

// Self-contained styling + behaviour for the platform-tabs widget,
// injected once per page so the reference's lowering examples render as
// a tabbed picker (node/dotnet/java/python/elixir, react/vue/svelte/…).
const TAB_STYLE = `<style>
.lt-tabs{margin:1.25rem 0;border:1px solid rgba(255,255,255,.10);border-radius:10px;overflow:hidden;background:rgba(255,255,255,.02)}
.lt-tablist{display:flex;flex-wrap:wrap;gap:2px;padding:6px 6px 0;border-bottom:1px solid rgba(255,255,255,.08)}
.lt-tab{appearance:none;background:transparent;border:0;color:#9aa4b2;font:600 .82rem/1.4 'Inter',system-ui,sans-serif;padding:.45rem .8rem;border-radius:7px 7px 0 0;cursor:pointer}
.lt-tab:hover{color:#cdd6e3;background:rgba(255,255,255,.04)}
.lt-tab.active{color:#0d1117;background:linear-gradient(135deg,#b58cff,#6fd1ff)}
.lt-panel{display:none;padding:.25rem 1rem 1rem}
.lt-panel.active{display:block}
.lt-panel pre{margin:.75rem 0}
</style>`;

const TAB_SCRIPT = `<script>
(function(){
  function apply(group,name){
    document.querySelectorAll('.lt-tabs[data-group="'+group+'"]').forEach(function(box){
      var hit=box.querySelector('.lt-tab[data-tab="'+name+'"]');
      if(!hit)return;
      box.querySelectorAll('.lt-tab').forEach(function(b){b.classList.toggle('active',b.dataset.tab===name)});
      box.querySelectorAll('.lt-panel').forEach(function(p){p.classList.toggle('active',p.dataset.tab===name)});
    });
  }
  document.addEventListener('DOMContentLoaded',function(){
    document.querySelectorAll('.lt-tabs').forEach(function(box){
      var group=box.dataset.group||'platform';
      try{var saved=localStorage.getItem('lt-'+group);if(saved)apply(group,saved);}catch(e){}
      box.querySelectorAll('.lt-tab').forEach(function(btn){
        btn.addEventListener('click',function(){
          apply(group,btn.dataset.tab);
          try{localStorage.setItem('lt-'+group,btn.dataset.tab);}catch(e){}
        });
      });
    });
  });
})();
</script>`;

const page = ({ title, body, currentHref, depth, styleHref }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · Loom</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github-dark.min.css">
<link rel="stylesheet" href="${styleHref}">
${TAB_STYLE}
</head>
<body>
${header(currentHref, depth)}
<main class="container prose">
  <a class="back" href="${depth > 0 ? '../'.repeat(depth) : ''}index.html">← Back to home</a>
  ${body}
</main>
${footer(depth)}
<script src="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/highlight.min.js"></script>
<script>document.addEventListener('DOMContentLoaded', () => window.hljs && window.hljs.highlightAll());</script>
${TAB_SCRIPT}
</body>
</html>
`;


async function renderMdFile(srcPath, depth) {
  const src = await readFile(srcPath, 'utf8');
  const rel = relative(HERE, srcPath);
  const title = extractTitle(src, basename(srcPath, '.md'));
  renderingSrc = srcPath;
  const body = marked.parse(src);
  const outRel = rel.replace(/\.md$/, '.html');
  const outPath = join(OUT, outRel);
  await mkdir(dirname(outPath), { recursive: true });
  const styleHref = depth > 0 ? `${'../'.repeat(depth)}style.css` : 'style.css';
  await writeFile(outPath, page({ title, body, currentHref: outRel, depth, styleHref }));
  console.log(`rendered  ${rel} → ${outRel}`);
  return { title, outRel };
}

// Build an index.html for a rendered subdir.  GitHub Pages serves
// `dir/` as `dir/index.html`, so generating these makes README's
// `[language-reference/](language-reference/)` resolve to a real
// listing instead of a 404.
// Entries are alphabetised by title; one bullet per file, linking to
// the rendered .html with the page's `# H1` as link text.
function buildIndexBody(subdir, entries) {
  const sorted = [...entries].sort((a, b) => a.title.localeCompare(b.title));
  const items = sorted.map(
    ({ title, outRel }) =>
      `  <li><a href="${basename(outRel)}">${escapeHtml(title)}</a></li>`,
  );
  return `<h1>${escapeHtml(subdir)}/</h1>
<p>${escapeHtml(`${entries.length} document${entries.length === 1 ? '' : 's'}`)} in <code>docs/${subdir}/</code>.</p>
<ul>
${items.join('\n')}
</ul>`;
}

async function writeSubdirIndex(subdir, entries) {
  if (entries.length === 0) return;
  const depth = subdir.split('/').length;
  const body = buildIndexBody(subdir, entries);
  const outPath = join(OUT, subdir, 'index.html');
  const styleHref = `${'../'.repeat(depth)}style.css`;
  await writeFile(
    outPath,
    page({
      title: `${subdir}/`,
      body,
      currentHref: `${subdir}/index.html`,
      depth,
      styleHref,
    }),
  );
  console.log(`emitted   ${subdir}/index.html (${entries.length} entries)`);
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  // Top-level .md files.
  const topEntries = await readdir(HERE);
  for (const f of topEntries) {
    if (!f.endsWith('.md')) continue;
    await renderMdFile(join(HERE, f), 0);
  }

  // Rendered subdirs (nested paths supported; depth = path segments).
  for (const sub of RENDERED_SUBDIRS) {
    const subDir = join(HERE, sub);
    const depth = sub.split('/').length;
    let subEntries;
    try {
      subEntries = await readdir(subDir);
    } catch {
      continue;
    }
    const rendered = [];
    for (const f of subEntries) {
      if (!f.endsWith('.md')) continue;
      const full = join(subDir, f);
      const s = await stat(full);
      if (!s.isFile()) continue;
      rendered.push(await renderMdFile(full, depth));
    }
    await writeSubdirIndex(sub, rendered);
  }

  // Copy the landing page, rewriting .md links → .html links (incl. subdirs).
  const indexSrc = await readFile(join(HERE, 'index.html'), 'utf8');
  const indexOut = indexSrc.replace(
    /href="((?:\.\.?\/)*(?:[a-zA-Z0-9_\-]+\/)?[a-zA-Z0-9_\-]+)\.md(#[^"]*)?"/g,
    'href="$1.html$2"',
  );
  await writeFile(join(OUT, 'index.html'), indexOut);
  console.log('copied    index.html (links rewritten)');

  await copyFile(join(HERE, '_template/style.css'), join(OUT, 'style.css'));
  console.log('copied    style.css');

  const broken = await checkSiteLinks(OUT);
  if (broken.length > 0) {
    console.error(`\n${broken.length} broken link(s) on the built site:`);
    for (const b of broken) console.error(`  ${b}`);
    process.exitCode = 1;
  } else {
    console.log('checked   every relative link and anchor resolves');
  }
}

// Every relative href in the built site must land on a file the site serves
// (or a directory with an index.html), and every `#anchor` on an element id in
// the target page.  `playground/` is published by pages.yml from its own build.
const SERVED_ELSEWHERE = ['playground/'];

async function htmlFiles(dir, acc = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await htmlFiles(p, acc);
    else if (e.name.endsWith('.html')) acc.push(p);
  }
  return acc;
}

export async function checkSiteLinks(site = OUT) {
  const files = await htmlFiles(site);
  const ids = new Map();
  const idsOf = async (file) => {
    if (!ids.has(file)) {
      const html = await readFile(file, 'utf8');
      ids.set(file, new Set([...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1])));
    }
    return ids.get(file);
  };
  const broken = [];
  for (const file of files) {
    const html = await readFile(file, 'utf8');
    const from = relative(site, file);
    for (const m of html.matchAll(/\shref="([^"]*)"/g)) {
      const href = m[1].replace(/&amp;/g, '&');
      if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) continue;
      const hashAt = href.indexOf('#');
      const path = hashAt < 0 ? href : href.slice(0, hashAt);
      const anchor = hashAt < 0 ? '' : decodeURIComponent(href.slice(hashAt + 1));
      const targetRel = relative(site, resolve(dirname(file), decodeURIComponent(path)));
      if (SERVED_ELSEWHERE.some((p) => `${targetRel}/`.startsWith(p))) continue;
      let target = path === '' ? file : resolve(dirname(file), decodeURIComponent(path));
      if (existsSync(target) && statSync(target).isDirectory()) target = join(target, 'index.html');
      if (!existsSync(target)) {
        broken.push(`${from}: ${href} — no such page`);
        continue;
      }
      if (anchor && target.endsWith('.html') && !(await idsOf(target)).has(anchor)) {
        broken.push(`${from}: ${href} — no #${anchor} there`);
      }
    }
  }
  return broken;
}

// Run only when invoked directly (`node docs/build.mjs`), so the module
// stays importable without side effects.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
