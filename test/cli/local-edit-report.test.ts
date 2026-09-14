// Finding F-031 — `ddd generate system` must NAME the hand-edited files it
// overwrites, instead of reporting only a count.
//
// The complaint, verbatim from the field test: `Wrote 5 file(s) in out-edit,
// unchanged: 215`.  Six generated files had been edited by hand; five were
// silently clobbered (a domain class, a route file, `docker-compose.yml`, a
// React page, `package.json`) and the summary named none of them.  The count
// could not distinguish them from five files the MODEL had legitimately
// changed, so there was no signal to act on at all — the loss was discovered
// later, by `git diff`, on a tree that might not have been committed.
//
// `.loomignore` and `--dry-run` already prevent the loss and are deliberately
// untouched here: both require knowing in advance that a file is at risk.
// What was missing is the report on the DEFAULT path, afterwards.
//
// The load-bearing distinction — and the reason a content hash is recorded in
// `.loom/manifest.json` rather than just diffing disk against the pending write
// — is "you edited this" vs "the model changed this".  Both make the on-disk
// bytes differ from what the run is about to write.  Only the hash of what the
// LAST run wrote separates them, and the two control cases below (`§ model
// change` and `§ quiet`) are what stop this gate from degenerating into "warn
// on every regen", which would be as useless as the count.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { MANIFEST_REL_PATH, parseManifest } from "../../src/system/manifest.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cli = path.join(repoRoot, "bin", "cli.js");

/** A deliberately small single-backend system: this suite is about the CLI's
 *  write phase, which is backend-agnostic, so a wide fixture would buy nothing
 *  and cost a minute per run. */
function source(extraField: string): string {
  return `
system S {
  subdomain M {
    context Tracking {
      aggregate Issue {
        title: string
        ${extraField}
      }
      repository Issues for Issue { }
    }
  }

  api TrackingApi from M

  storage primary { type: postgres }
  resource appState { for: Tracking, kind: state, use: primary }

  deployable api {
    platform: node
    contexts: [Tracking]
    dataSources: [appState]
    serves: TrackingApi
    port: 8080
  }
}
`;
}

const tmpRoots: string[] = [];
function mkTmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true });
});

function generate(src: string, out: string, extra: string[] = []): string {
  return execFileSync("node", [cli, "generate", "system", src, "-o", out, ...extra], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** The paths the run named as locally modified, from the report block. */
function reportedPaths(stdout: string): string[] {
  const lines = stdout.split("\n");
  const start = lines.findIndex((l) => /locally modified file\(s\)/.test(l));
  if (start === -1) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("  ")) break;
    const p = line.trim();
    // The trailing advice line is prose, not a path.
    if (p.startsWith("Recover the edits") || p.startsWith("Add a path")) break;
    out.push(p);
  }
  return out.sort();
}

describe("generate system names the hand edits it overwrites (F-031)", () => {
  const tmp = mkTmp("loom-local-edit-");
  const ddd = path.join(tmp, "main.ddd");
  const out = path.join(tmp, "out");

  // Two files from different emitters, so the report is not an artefact of one
  // builder: a domain class and the compose file at the tree root.
  const EDITED = ["api/domain/issue.ts", "docker-compose.yml"];

  it("§ first run — establishes the tree and records a hash per emitted path", () => {
    fs.writeFileSync(ddd, source("note: string"));
    const first = generate(ddd, out);
    expect(first).toMatch(/Wrote \d+ file\(s\)/);
    // Nothing was overwritten on a fresh dir, so nothing may be reported: a
    // report on the first run would be pure noise.
    expect(first).not.toMatch(/locally modified/);

    const manifest = parseManifest(fs.readFileSync(path.join(out, MANIFEST_REL_PATH), "utf8"));
    expect(manifest).not.toBeNull();
    for (const rel of EDITED) {
      const entry = manifest!.entries.find((e) => e.path === rel);
      expect(entry, `${rel} must be in the manifest`).toBeDefined();
      // Without a recorded hash the next run cannot tell an edit from a model
      // change, and the whole report degrades to silence.
      expect(entry!.hash, `${rel} must carry a content hash`).toMatch(/^[0-9a-f]{32}$/);
    }
  }, 180_000);

  it("§ quiet — an identical regen says nothing extra", () => {
    const second = generate(ddd, out);
    expect(second).toMatch(/Wrote 0 file\(s\)/);
    expect(second).not.toMatch(/locally modified/);
  }, 180_000);

  it("names exactly the hand-edited files, and only those", () => {
    for (const rel of EDITED) {
      const full = path.join(out, rel);
      fs.writeFileSync(full, `${fs.readFileSync(full, "utf8")}\n// hand edit\n`, "utf8");
    }
    const third = generate(ddd, out);

    // The finding in one assertion: the paths are named.
    expect(reportedPaths(third)).toEqual([...EDITED].sort());
    expect(third).toMatch(/Overwrote 2 locally modified file\(s\)/);
    // …and the user is told what to do about it, which `Wrote 5 file(s)` never
    // was.  `.loomignore` is the documented way to keep a hand edit.
    expect(third).toMatch(/\.loomignore/);
  }, 180_000);

  it("§ model change — a file the MODEL changed is NOT reported as a hand edit", () => {
    // The control that keeps the gate honest.  After the run above, disk and
    // manifest agree again.  Changing the model rewrites many files — every one
    // of them differs from what is on disk, exactly as a hand edit does — and
    // not one of them may be named.
    fs.writeFileSync(ddd, source("note: string\n        priority: string?"));
    const fourth = generate(ddd, out);
    expect(fourth).toMatch(/Wrote [1-9]\d* file\(s\)/); // the model change did land
    expect(fourth, fourth).not.toMatch(/locally modified/);
  }, 180_000);

  it("reports a hand-written file the generator newly claims", () => {
    // A path with no manifest entry at all, holding content the generator did
    // not write.  Regenerating replaces it, which is the same loss by a
    // different route, so it is reported by the same line.
    const rel = "api/domain/issue.ts";
    fs.rmSync(path.join(out, MANIFEST_REL_PATH));
    fs.writeFileSync(path.join(out, rel), "// entirely mine\n", "utf8");
    const fifth = generate(ddd, out);
    expect(reportedPaths(fifth)).toContain(rel);
  }, 180_000);

  it("--dry-run previews the same list without touching the file", () => {
    const rel = "docker-compose.yml";
    const full = path.join(out, rel);
    const mine = `${fs.readFileSync(full, "utf8")}\n# mine\n`;
    fs.writeFileSync(full, mine, "utf8");
    const preview = generate(ddd, out, ["--dry-run"]);
    expect(reportedPaths(preview)).toContain(rel);
    expect(preview).toMatch(/Would overwrite/);
    // A preview that writes is not a preview.
    expect(fs.readFileSync(full, "utf8")).toBe(mine);
  }, 180_000);
});
