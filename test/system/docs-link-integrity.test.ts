import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const docsDir = path.join(repoRoot, "docs");

// ---------------------------------------------------------------------------
// Link integrity across the live docs.
//
// A relative link rots silently when its target is renamed or deleted, and a
// dead link is how a reader ends up guessing at what a doc used to say.
// ---------------------------------------------------------------------------

/** The docs a reader follows links in. */
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
        if (recurse && e.name !== "_site") walk(full, recurse);
      } else if (e.name.endsWith(".md")) out.push(full);
    }
  };
  walk(docsDir, false);
  walk(path.join(docsDir, "language-reference"), true);
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

/** Files that may still name a dead host because the mention IS the history
 *  (the move itself). */
const DEAD_HOST_EXEMPT = [/^docs\/ci-gating\.md$/];

describe("live docs never link to a missing doc", () => {
  it("every relative .md link in a live doc resolves", () => {
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
      "too few relative .md links found; the matcher stopped reaching them",
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
    // No live surface names a dead host, so the corpus alone cannot prove the
    // patterns are not trivially unmatchable.
    expect(DEAD_HOSTS.every((d) => !d.pattern.test("https://loom-harness.github.io/Loc/"))).toBe(
      true,
    );
    expect(DEAD_HOSTS[0]?.pattern.test("https://lemmit.github.io/Loc/")).toBe(true);
    expect(DEAD_HOSTS[1]?.pattern.test("https://github.com/lemmit/Loc")).toBe(true);
  });
});
