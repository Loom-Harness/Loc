// Every surface that reports phase-⑦ diagnostics must agree on what an
// ADVISORY diagnostic (`src/diagnostics/advisory.ts`) is: advice under a
// `Suggestions (N):` heading, never part of the warning count.  The human
// `parse` printer did this; `parse --json` counted the advisory under
// `summary.warnings` with no marker, and `verify` / `snapshot` printed it as a
// counted `warning` without its file:line locator.  This spawns the real CLI on
// one model carrying exactly one advisory (`loom.index-suggestion`) and no
// warnings, and asserts every surface reports the same split: 0 warnings,
// 1 suggestion.  Wiring nothing boots — the CLI's own reporting is the
// behaviour under test.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cli = path.join(repoRoot, "bin", "cli.js");

function run(args: string[]): { stdout: string; stderr: string; status: number } {
  const r = spawnSync("node", [cli, ...args], { encoding: "utf8" });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? 1 };
}

/** One query-filtered column (`status`, via the `Held` criterion) with no
 *  covering index — exactly one `loom.index-suggestion`, nothing else. */
const ONE_ADVISORY = `system S {
  context C {
    enum St { Held, Released }
    aggregate Dep with crudish { amount: int
      status: St }
    repository Deps for Dep { }
    criterion Held of Dep = status == St.Held
    retrieval HeldDeps of Dep { where: Held }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node, contexts: [C], dataSources: [st], port: 3000 }
}
`;

/** The `(warnings, suggestions)` a human stderr stream reports. */
function humanCounts(stderr: string): { warnings: number; suggestions: number } {
  const footer = /^(\d+) error\(s\), (\d+) warning\(s\)\.$/m.exec(stderr);
  const sugg = /^Suggestions \((\d+)\):$/m.exec(stderr);
  return { warnings: footer ? Number(footer[2]) : -1, suggestions: sugg ? Number(sugg[1]) : 0 };
}

describe("advisory diagnostics report identically on every surface", () => {
  let dir: string;
  let model: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-advisory-"));
    model = path.join(dir, "main.ddd");
    fs.writeFileSync(model, ONE_ADVISORY);
    fs.writeFileSync(path.join(dir, "results.json"), '{"version":1,"results":[]}\n');
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("parse, parse --json, generate --json, verify and snapshot all say 0 warnings + 1 suggestion", () => {
    const expected = { warnings: 0, suggestions: 1 };

    const parse = run(["parse", model]);
    expect(parse.status).toBe(0);
    expect(humanCounts(parse.stderr)).toEqual(expected);

    for (const args of [
      ["parse", model, "--json"],
      ["generate", "system", model, "--json"],
    ]) {
      const r = run(args);
      expect(r.status).toBe(0);
      const report = JSON.parse(r.stdout) as {
        summary: { warnings: number; suggestions: number };
        diagnostics: { code: string; advisory?: boolean }[];
      };
      expect({
        warnings: report.summary.warnings,
        suggestions: report.summary.suggestions,
      }).toEqual(expected);
      const hint = report.diagnostics.find((d) => d.code === "loom.index-suggestion");
      expect(hint?.advisory).toBe(true);
    }

    // `verify` exits 2 here (the model declares no requirements), but only
    // after reporting diagnostics; `snapshot` captures nothing and exits 0.
    const verify = run(["verify", model, "--results", path.join(dir, "results.json")]);
    const snapshot = run(["snapshot", model, "-o", path.join(dir, "snap"), "--dry-run"]);
    for (const r of [verify, snapshot]) {
      expect(humanCounts(r.stderr)).toEqual(expected);
      // Same printer as `parse` — the advisory line keeps its file:line locator.
      expect(r.stderr).toContain(`${model}:4:5 C/Dep:`);
      expect(r.stderr).not.toMatch(/\bwarning: /);
    }
  });
});
