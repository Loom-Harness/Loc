// ---------------------------------------------------------------------------
// Diagnostic code → language-reference anchor (M-T8.18).
//
// The playground's Problems rows link every `loom.*` code to the chapter
// section that documents the construct it complains about, so an error is a
// door into the reference instead of a dead end (audit H7).  A code with no
// entry renders NO link — never a 404 — and the set of such codes is pinned
// as a ratchet by `test/system/diagnostic-docs-anchors.test.ts`, which also
// checks every anchor below against the headings actually in `docs/`.
//
// Anchors are GitHub-style heading slugs (`githubHeadingSlug`) — the same
// rule `docs/build.mjs` stamps on the rendered site's headings, so one link
// works on GitHub and on the docs site.  Paths are relative to `docs/`.
//
// Pure leaf like its sibling `messages.ts` (it imports only its own family
// files, `./code-docs/<family>.ts`, keyed by the same code families as
// `./messages/<family>.ts`): consumed by the
// browser playground, so it must stay Node-free.
// ---------------------------------------------------------------------------

import { anchors as auth } from "./code-docs/auth.js";
import { anchors as backends } from "./code-docs/backends.js";
import { anchors as behavior } from "./code-docs/behavior.js";
import { anchors as core } from "./code-docs/core.js";
import { anchors as eventing } from "./code-docs/eventing.js";
import { anchors as frontends } from "./code-docs/frontends.js";
import { anchors as migration } from "./code-docs/migration.js";
import { anchors as model } from "./code-docs/model.js";
import { anchors as page } from "./code-docs/page.js";
import { anchors as persistence } from "./code-docs/persistence.js";
import { anchors as projection } from "./code-docs/projection.js";
import { anchors as system } from "./code-docs/system.js";
import { anchors as tenancy } from "./code-docs/tenancy.js";
import { anchors as testing } from "./code-docs/testing.js";
import { anchors as types } from "./code-docs/types.js";
import { anchors as ui } from "./code-docs/ui.js";
import { anchors as workflow } from "./code-docs/workflow.js";

/** GitHub's heading-anchor rule: lowercase, drop everything but letters,
 *  digits, spaces, hyphens and underscores, then turn each space into a
 *  hyphen (two spaces around an em dash become two hyphens — GitHub keeps
 *  them, so we do too). */
export function githubHeadingSlug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replace(/ /g, "-");
}

/** The docs root every entry is relative to (the published site). */
export const DOCS_SITE = "https://loom-harness.github.io/Loc/";

const CHAPTER_DIR = "language-reference";

/** Every family file, by name — read by the family-placement check in
 *  `test/system/diagnostic-catalog.test.ts`. */
export const CODE_DOCS_FAMILIES = {
  core,
  behavior,
  types,
  model,
  workflow,
  eventing,
  auth,
  tenancy,
  persistence,
  projection,
  migration,
  system,
  backends,
  frontends,
  ui,
  page,
  testing,
};

/** code → `<chapter>.md#<anchor>`, grouped by chapter.  Only codes whose
 *  construct has a documented section; extend it as the reference grows (the
 *  ratchet test then asks you to drop the code from its undocumented list).
 *
 *  An entry may also escape the chapter directory with a leading `../`, for a
 *  code whose home is a top-level reference doc rather than a language-reference
 *  chapter.  `docs/migrations.md` is the case that needs it: the chaptered
 *  reference deliberately does NOT cover migration blocks — its own README
 *  routes them to `../migrations.md` — so a `loom.migration-*` code with a real
 *  documented remedy has nowhere inside `language-reference/` to point.  The
 *  alternative was to leave such a code undocumented, which the shrink-only
 *  ratchet exists to discourage. */
export const CODE_DOCS_ANCHORS: Readonly<Record<string, string>> = {
  ...core,
  ...behavior,
  ...types,
  ...model,
  ...workflow,
  ...eventing,
  ...auth,
  ...tenancy,
  ...persistence,
  ...projection,
  ...migration,
  ...system,
  ...backends,
  ...frontends,
  ...ui,
  ...page,
  ...testing,
};

/** The docs path for a diagnostic code, relative to the docs root —
 *  `language-reference/04-type-system.md#x-id--cross-aggregate-references` —
 *  or `undefined` when the code has no documented anchor (render no link). */
export function codeDocsPath(code: string): string | undefined {
  const rel = CODE_DOCS_ANCHORS[code];
  if (rel === undefined) return undefined;
  // `../foo.md#…` is docs-root-relative (see `CODE_DOCS_ANCHORS`); everything
  // else is a chapter of the language reference.
  return rel.startsWith("../") ? rel.slice("../".length) : `${CHAPTER_DIR}/${rel}`;
}

/** Absolute URL on the published docs site (`.md` → `.html`, as
 *  `docs/build.mjs` rewrites links), or `undefined` when undocumented. */
export function codeDocsUrl(code: string, site: string = DOCS_SITE): string | undefined {
  const rel = codeDocsPath(code);
  if (rel === undefined) return undefined;
  const [file, anchor] = rel.split("#");
  return `${site}${file.replace(/\.md$/, ".html")}${anchor ? `#${anchor}` : ""}`;
}
