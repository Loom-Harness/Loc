// The published docs site has no dead links.
//
// `docs/build.mjs` renders the docs into the GitHub Pages site and, as its
// last step, resolves every relative href and `#anchor` on the built pages
// (a link to a repository file the site does not publish is rewritten to its
// GitHub URL first).  This runs that build into a scratch directory and
// requires it to report nothing — the same check pages.yml runs before it
// deploys, here in the fast tier.

import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");

describe("docs site", () => {
  it("builds with every relative link and anchor resolving", () => {
    const out = mkdtempSync(join(tmpdir(), "loom-docs-site-"));
    const r = spawnSync("node", [join(ROOT, "docs", "build.mjs")], {
      encoding: "utf8",
      env: { ...process.env, LOOM_DOCS_OUT: out },
    });
    const broken = (r.stderr ?? "").split("\n").filter((l) => l.startsWith("  "));
    expect(broken, r.stderr).toEqual([]);
    expect(r.status).toBe(0);
    // Vacuity guard: the check ran over a real site.
    expect(r.stdout).toContain("checked   every relative link and anchor resolves");
    expect(r.stdout).toMatch(/rendered {2}architecture\/request-context\.md/);
  }, 120_000);
});
