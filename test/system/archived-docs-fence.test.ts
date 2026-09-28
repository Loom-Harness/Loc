import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error - docs/build.mjs is a plain ESM script outside the TS project graph.
import { ARCHIVED, archivedNotice, RENDERED_SUBDIRS } from "../../docs/build.mjs";

// ---------------------------------------------------------------------------
// The archived-corpus fence.
//
// `docs/old/**` is a FROZEN design record (grammar sketches, semantics,
// rationale — its status tables are superseded) and `docs/audits/**` are
// snapshot-in-time findings true only as of the commit each one names.
// CLAUDE.md says so, at length, for agents reading the repo.  A reader of the
// DEPLOYED site had no such fence: `docs/build.mjs` renders both corpora to
// GitHub Pages, where an archived proposal looked exactly as current as
// `docs/language.md`.
//
// `archivedNotice()` now stamps a banner on those pages.  This file is the
// gate that keeps it honest — the same move this repo already makes for the
// pipeline layering invariant (`ALLOWED = {}` in pipeline-layering.test.ts)
// and the diagnostic catalog: the rule is enforced, not merely written down.
//
// Deliberately NOT gated here: whether the PROSE around a live→archive link
// marks it as historical.  Every heuristic for that either passes on the URL
// text itself (`old/proposals/…` contains "proposal") or fires on correct
// prose, and a gate that cannot reach the thing it names is worse than none
// (experience_gathered.md §59, §63).  The checks below are all mechanical.
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const docsDir = path.join(repoRoot, "docs");

/** Path prefixes (relative to docs/) whose rendered pages are archived. */
const ARCHIVED_PREFIXES: string[] = (ARCHIVED as { prefix: string }[]).map((a) => a.prefix);

/** A rendered subdir is archived when some ARCHIVED prefix covers it. */
const isArchivedSubdir = (sub: string): boolean =>
  ARCHIVED_PREFIXES.some((p) => `${sub}/`.startsWith(p));

/** The corpora that are frozen/perishable and must never render unmarked.
 *  Hard-coded rather than derived, so DELETING an ARCHIVED entry fails here
 *  instead of silently unmarking the corpus it covered. */
const MUST_BE_MARKED = ["old/plans", "old/proposals", "audits"];

describe("archived docs carry a fence on the published site", () => {
  it("every corpus that must be marked is still covered by an ARCHIVED prefix", () => {
    const unmarked = MUST_BE_MARKED.filter((sub) => !isArchivedSubdir(sub));
    expect(unmarked, "an archived corpus lost its ARCHIVED prefix in docs/build.mjs").toEqual([]);
  });

  it("every rendered subdir under an archived corpus produces a banner", () => {
    const missing = RENDERED_SUBDIRS.filter(
      (sub: string) => isArchivedSubdir(sub) && archivedNotice(`${sub}/page.md`, 1) === "",
    );
    expect(missing, "rendered archived subdir with no banner").toEqual([]);
  });

  it("marks every rendered page of an archived corpus, and no live page", () => {
    const marked: string[] = [];
    const bare: string[] = [];
    for (const sub of RENDERED_SUBDIRS as string[]) {
      const dir = path.join(docsDir, sub);
      if (!fs.existsSync(dir)) continue;
      const depth = sub.split("/").length;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".md")) continue;
        const rel = `${sub}/${f}`;
        (archivedNotice(rel, depth) === "" ? bare : marked).push(rel);
      }
    }
    // Live corpora stay unmarked; archived ones are marked. No page is both.
    expect(marked.filter((r) => !ARCHIVED_PREFIXES.some((p) => r.startsWith(p)))).toEqual([]);
    expect(bare.filter((r) => ARCHIVED_PREFIXES.some((p) => r.startsWith(p)))).toEqual([]);
    // Sanity: the gate actually reached both sides.
    expect(marked.length).toBeGreaterThan(100);
    expect(bare.length).toBeGreaterThan(10);
  });

  it("the banner routes to the live surfaces, not deeper into the archive", () => {
    const html = archivedNotice("old/proposals/x.md", 2);
    expect(html).toContain('href="../../README.html"');
    expect(html).toContain('href="../../new-plan/README.html"');
    expect(fs.existsSync(path.join(docsDir, "README.md"))).toBe(true);
    expect(fs.existsSync(path.join(docsDir, "new-plan", "README.md"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Link integrity into the frozen corpora.
//
// Nobody edits `docs/old/**`, so the 60-odd inbound links from live docs rot
// silently when an archived file is renamed or dropped.  A dead link into the
// archive is how a reader ends up guessing at what a doc used to say.
// ---------------------------------------------------------------------------

/** Live docs that may link into the archive. */
function liveDocs(): string[] {
  // README.md is the repo's single most-read file and sat outside the only doc
  // gate there is, which is how its three advertised live-site links pointed at
  // a 404 org for as long as they did.
  const out = [path.join(repoRoot, "CLAUDE.md"), path.join(repoRoot, "README.md")];
  const walk = (dir: string, recurse: boolean) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (recurse && e.name !== "old" && e.name !== "_site") walk(full, recurse);
      } else if (e.name.endsWith(".md")) out.push(full);
    }
  };
  walk(docsDir, false);
  walk(path.join(docsDir, "language-reference"), true);
  walk(path.join(docsDir, "new-plan"), true);
  return out;
}

const MD_LINK = /\]\(([^)\s]+?\.md)(#[^)]*)?\)/g;

/** Relative `.md` links that deliberately do not resolve.  Each needs a reason;
 *  a stale entry fails the ratchet below, so a fix deletes its waiver. */
const WAIVED_LINKS = new Set<string>([
  // A placeholder in the skill-authoring guide, not a real target.
  "docs/language-reference/AUTHORING.md -> ../foo.md",
]);

/** Hosts and paths that moved and must never be advertised again.  The repo
 *  moved org (`lemmit/Loc` → `Loom-Harness/Loc`), and the github.io hostname
 *  does NOT redirect: `lemmit.github.io/Loc/` is a hard 404, so every doc, every
 *  playground string and every scaffolded project's README pointed users at a
 *  dead page.  A denylist is the only form of this check that survives the NEXT
 *  move — it names the file the day it happens. */
const DEAD_HOSTS: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  { pattern: /lemmit\.github\.io/, why: "old org's Pages host — 404s; use loom-harness.github.io" },
  { pattern: /github\.com\/lemmit\//, why: "old org — use github.com/Loom-Harness/" },
];

/** Files that may still name a dead host because they are the frozen historical
 *  record, or because the mention IS the history (the move itself). */
const DEAD_HOST_EXEMPT = [
  /^docs\/old\//,
  /^docs\/audits\//,
  /^docs\/new-plan\/archive\//,
  /^docs\/ci-gating\.md$/,
];

describe("live docs never link to a missing archived doc", () => {
  it("every live → docs/old|audits link resolves", () => {
    const dead: string[] = [];
    let seen = 0;
    for (const file of liveDocs()) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(MD_LINK)) {
        const href = m[1] as string;
        // An absolute URL is not a relative target; `path.resolve` on one yields
        // nonsense and reports it dead.  (My own check's first false positive.)
        if (/^[a-z]+:\/\//i.test(href)) continue;
        // Normalise to a docs-relative path.
        const abs = path.resolve(path.dirname(file), href);
        // EVERY relative `.md` target, not just the frozen archive.  Narrowing
        // to `old/|audits/` is why `docs/channels.md`'s dead link into
        // `new-plan/` slipped past a gate whose whole job is dead links.
        if (WAIVED_LINKS.has(`${path.relative(repoRoot, file)} -> ${href}`)) continue;
        seen++;
        if (!fs.existsSync(abs)) {
          dead.push(`${path.relative(repoRoot, file)} -> ${href}`);
        }
      }
    }
    // The gate must actually reach the links it claims to check.
    expect(
      seen,
      "no live → archive links found; the matcher stopped reaching them",
    ).toBeGreaterThan(40);
    expect(dead, `dead relative .md link:\n${dead.join("\n")}`).toEqual([]);
  });

  it("no live surface advertises a host that moved", () => {
    const offenders: string[] = [];
    // Wider than liveDocs(): the org name is baked into scaffolded projects
    // (`src/cli/new-templates.ts`) and the playground's crash-report target, so
    // a docs-only sweep would call this clean while every NEW user project
    // shipped the dead link.
    //
    // `web/e2e` is in the list because leaving it out cost a CI cycle.  The
    // first version of this sweep covered the SOURCES of the org name but not
    // the specs that PIN it, so `crash-reporting.spec.ts` and
    // `problems-and-help.spec.ts` went on asserting the dead org — a golden
    // frozen on the defect, which is how the playground leg went red on a
    // branch whose whole point was removing that host.  A gate that watches
    // only one side of an assertion is half a gate.
    const roots = ["README.md", "docs", "src", "web/src", "web/e2e", ".github"];
    const walk = (p: string): string[] => {
      const abs = path.join(repoRoot, p);
      if (!fs.existsSync(abs)) return [];
      if (!fs.statSync(abs).isDirectory()) return [p];
      return fs
        .readdirSync(abs, { withFileTypes: true })
        .filter((e) => e.name !== "node_modules" && e.name !== "_site")
        .flatMap((e) => walk(path.join(p, e.name)));
    };
    for (const rel of roots.flatMap(walk)) {
      if (!/\.(md|ts|tsx|mjs|json|html|yml|ddd)$/.test(rel)) continue;
      if (DEAD_HOST_EXEMPT.some((re) => re.test(rel))) continue;
      const text = fs.readFileSync(path.join(repoRoot, rel), "utf8");
      for (const { pattern, why } of DEAD_HOSTS) {
        if (pattern.test(text)) offenders.push(`${rel}: ${pattern.source} — ${why}`);
      }
    }
    expect(offenders, `dead host advertised:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the denylist can actually fire (non-vacuity)", () => {
    // The exempt list is the frozen record, and it DOES still carry the old
    // host — so the patterns are known-good rather than trivially unmatchable.
    const frozen = path.join(repoRoot, "docs", "new-plan", "archive", "T6-done.md");
    if (!fs.existsSync(frozen)) return;
    expect(DEAD_HOSTS.some((d) => d.pattern.test(fs.readFileSync(frozen, "utf8")))).toBe(true);
  });
});
