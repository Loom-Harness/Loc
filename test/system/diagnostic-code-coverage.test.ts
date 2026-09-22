// The codeless-diagnostic ratchet.
//
// `diagnostic-catalog.test.ts` invariant 1 reads: a diagnostic site that
// ATTACHES a `loom.*` code must render its text from `src/diagnostics/
// messages.ts`.  A site that attaches NO code satisfies that vacuously — and so
// does `diagnostic-docs-anchors.test.ts` (keyed by code) and
// `diagnostic-firing-census.test.ts` (a firing fixture per code).  Three gates
// for diagnostic quality, and a site can sit outside all three by omitting one
// property.
//
// That is not hypothetical: 122 of the 320 `accept("<severity>", …)` sites in
// the files those gates scan attach no code, ALL of them in the AST layer
// (`src/language/validators/`).  The IR layer (`src/ir/validate/checks/`) is
// 100% coded, so this is one layer that was never migrated, not a decision that
// some diagnostics are codeless.  The Feliz `design:` message — which for a
// while suggested a spelling that did not parse — was one of the 122, which is
// why no gate said so.
//
// Migrating all 122 is a mission.  This file is the ratchet that stops the
// number growing in the meantime: it can only fall.  When you add a code to a
// site, lower the baseline in the same PR — a stale baseline fails here, the
// same convention the repo's other waiver lists use.
import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");

/** The same surface `diagnostic-catalog.test.ts` scans, for the same reason —
 *  if the two disagree about what is in scope, this ratchet guards the wrong
 *  population. */
const SCANNED_DIRS = [
  path.join("src", "language", "validators"),
  path.join("src", "ir", "validate", "checks"),
];

const SEVERITIES = new Set(["error", "warning", "info", "hint"]);

/** Today's count, per layer.  These are BASELINES, not targets: a PR that adds
 *  a code lowers the number it touches; a PR that adds a codeless diagnostic
 *  fails here and should add the code instead. */
const BASELINE = {
  "src/language/validators": 122,
  "src/ir/validate/checks": 0,
} as const;

interface Site {
  file: string;
  line: number;
  coded: boolean;
}

function sites(): Site[] {
  const out: Site[] = [];
  for (const dir of SCANNED_DIRS) {
    for (const name of fs.readdirSync(path.join(repoRoot, dir)).sort()) {
      if (!name.endsWith(".ts")) continue;
      const rel = path.join(dir, name);
      const text = fs.readFileSync(path.join(repoRoot, rel), "utf8");
      const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.ESNext, true);
      const visit = (n: ts.Node): void => {
        if (
          ts.isCallExpression(n) &&
          ts.isIdentifier(n.expression) &&
          n.expression.text === "accept"
        ) {
          const first = n.arguments[0];
          if (first && ts.isStringLiteral(first) && SEVERITIES.has(first.text)) {
            const coded = n.arguments.some(
              (a) =>
                ts.isObjectLiteralExpression(a) &&
                a.properties.some(
                  (p) => p.name && ts.isIdentifier(p.name) && p.name.text === "code",
                ),
            );
            out.push({
              file: rel,
              line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
              coded,
            });
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
  }
  return out;
}

describe("codeless diagnostics — ratchet", () => {
  const all = sites();

  it("finds the whole population (guards the scanner)", () => {
    // Without this, a broken scan would make every assertion below pass
    // vacuously — the recurring failure shape this repo logs as §59/§63.
    expect(all.length).toBeGreaterThan(250);
    expect(all.some((s) => s.coded)).toBe(true);
    expect(all.some((s) => !s.coded)).toBe(true);
  });

  it.each(Object.entries(BASELINE))("%s never grows more codeless", (dir, baseline) => {
    const codeless = all.filter((s) => s.file.startsWith(dir) && !s.coded);
    expect(
      codeless.length,
      codeless.length > baseline
        ? `NEW codeless diagnostic(s) in ${dir}. A site with no \`code:\` is invisible to ` +
            `diagnostic-catalog, diagnostic-docs-anchors AND diagnostic-firing-census — ` +
            `attach a loom.* code and a catalog entry instead.\n` +
            codeless.map((s) => `  ${s.file}:${s.line}`).join("\n")
        : `${dir} now has ${codeless.length} codeless site(s), below the pinned ` +
            `baseline of ${baseline}. Lower BASELINE to ${codeless.length} in this PR — ` +
            `a stale baseline is how a ratchet stops ratcheting.`,
    ).toBe(baseline);
  });

  it("the IR check layer stays fully coded", () => {
    // The phase-⑦ leaves are at zero and must stay there: they are the proof
    // that "coded" is achievable, and the target the AST layer migrates toward.
    const codeless = all.filter((s) => s.file.startsWith("src/ir/validate/checks") && !s.coded);
    expect(codeless.map((s) => `${s.file}:${s.line}`)).toEqual([]);
  });
});
