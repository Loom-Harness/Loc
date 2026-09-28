// Every `.ddd` the e2e legs generate from must VALIDATE — checked here, in
// seconds, rather than in a docker job twenty minutes later.
//
// The gap this closes, found the expensive way.  `clause-census.test.ts`
// already reads `test/e2e/fixtures/**` — but lexically, counting clauses.
// Nothing in `npm test` ran the VALIDATOR over them.  So when M-T5.33 widened
// `loom.money-in-text-slot` to read the resolved `memberType` (which reaches a
// `Column`'s lambda, a slot the gate's own row-scope machinery never bound),
// `vanilla-table-client-controls.ddd` started failing — a TRUE positive, its
// LiveView emitted `<%= o.total %>`, a bare `Decimal` struct interpolated into
// HEEx — and the full local suite stayed green.  The first report came from
// `elixir-vanilla-vo-e2e`, after a checkout, an npm install and a generate
// step, for a diagnostic that takes one second to produce.
//
// That is the exact shape CLAUDE.md's "never push just to see a check's
// verdict" rule exists to prevent, and the reverse index it points at
// (`docs/testing.md` → "Running any CI gate locally") could not help: there
// was no local command that reached these files at all.
//
// Scope, deliberately narrow: this asserts the fixtures still PARSE AND
// VALIDATE, not what they emit.  What each one proves is its own leg's job.
// A fixture that is *meant* to carry a diagnostic (a refusal fixture) does not
// belong under these directories — those live in the validator suites, where
// the expected code is asserted rather than merely tolerated.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validate } from "../../src/api/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Every `.ddd` under `test/e2e/fixtures/`, repo-relative and sorted. */
function e2eFixtures(): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const entry of readdirSync(path.join(repoRoot, rel))) {
      const child = path.posix.join(rel, entry);
      if (statSync(path.join(repoRoot, child)).isDirectory()) walk(child);
      else if (entry.endsWith(".ddd")) out.push(child);
    }
  };
  walk("test/e2e/fixtures");
  return out.sort((a, b) => a.localeCompare(b));
}

/** The fixtures grouped by their leg's directory — one `it` each, so a
 *  failure names the leg that would have gone red and no single case runs
 *  long enough to need an unusual timeout. */
function byLeg(): Map<string, string[]> {
  const legs = new Map<string, string[]>();
  for (const rel of e2eFixtures()) {
    const leg = path.posix.dirname(rel);
    const list = legs.get(leg);
    if (list) list.push(rel);
    else legs.set(leg, [rel]);
  }
  return legs;
}

describe("e2e fixtures validate", () => {
  const legs = byLeg();

  it("the fixture walk still finds them", () => {
    // Non-vacuity: a walk that stopped matching would make every case below
    // pass over nothing.  The tree carries 222 today; the floor is loose
    // enough not to churn and tight enough to notice a broken walk.
    const total = [...legs.values()].reduce((n, l) => n + l.length, 0);
    expect(total, "the e2e fixture walk matched (almost) nothing").toBeGreaterThan(150);
  });

  for (const [leg, files] of byLeg()) {
    it(`${leg} — zero error diagnostics`, async () => {
      const failures: string[] = [];
      for (const rel of files) {
        // Multi-file fixtures import their siblings by relative path, which an
        // in-memory `EmptyFileSystem` parse cannot resolve — those legs prove
        // themselves by generating.
        const text = readFileSync(path.join(repoRoot, rel), "utf8");
        if (/^\s*import\s+"/m.test(text)) continue;
        // The corpus-style platform placeholder, resolved the way every
        // harness that reads these resolves it.
        const report = await validate(text.replaceAll("__PLATFORM__", "node"), { path: rel });
        for (const e of report.diagnostics.filter((d) => d.severity === "error")) {
          failures.push(`${rel}: ${e.code ?? "(uncoded)"} — ${e.message}`);
        }
      }
      expect(failures, failures.join("\n")).toEqual([]);
    }, 120_000);
  }
});
