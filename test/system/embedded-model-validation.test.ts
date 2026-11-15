// Every `.ddd` model a workflow or script embeds as a shell heredoc
// (`cat > x.ddd <<'DDD' … DDD`) validates with zero errors.
//
// A CI job that generates from an embedded model fails at `ddd generate` the
// moment a new error diagnostic refuses that model, and only in the merge
// queue: the tracked-`.ddd` sweeps and the corpus never see it.  This test
// runs the same validation (parse, AST checks, IR checks) over every embedded
// model in the fast suite instead.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { expectReach } from "../_helpers/census-reach.js";
import { parseString } from "../_helpers/parse.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** A heredoc that writes a `.ddd` file: `cat > <path>.ddd <<'TAG'` … `TAG`. */
const HEREDOC = /cat > (\S+\.ddd) <<'?(\w+)'?\n([\s\S]*?)\n[ \t]*\2\n/g;

/** Strip the common leading indentation a YAML `run: |` block adds. */
function dedent(text: string): string {
  const lines = text.split("\n");
  const indents = lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(cut)).join("\n");
}

interface EmbeddedModel {
  where: string;
  source: string;
}

function embeddedModels(): EmbeddedModel[] {
  const hosts = execFileSync("git", ["ls-files", "-z", ".github/workflows", "scripts"], {
    cwd: repoRoot,
  })
    .toString()
    .split("\0")
    .filter((f) => /\.(?:ya?ml|sh|m?js|mts)$/.test(f));
  const out: EmbeddedModel[] = [];
  for (const f of hosts) {
    const text = fs.readFileSync(path.join(repoRoot, f), "utf8");
    for (const m of text.matchAll(HEREDOC)) {
      out.push({ where: `${f} → ${m[1]}`, source: dedent(m[3]!) });
    }
  }
  return out;
}

/** Parse + AST-validate + IR-validate; every error, from any phase. */
async function errorsOf(src: string): Promise<string[]> {
  const { model, errors } = await parseString(src);
  if (errors.length > 0) return errors;
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.severity === "error")
    .map((d) => `${d.code}: ${d.message}`);
}

describe("models embedded in workflows and scripts", () => {
  const models = embeddedModels();

  it("finds the embedded models (vacuity guard)", () => {
    expectReach("embedded .ddd heredocs", models.length, 7);
  });

  it("each one validates with zero errors", async () => {
    const failing: string[] = [];
    for (const { where, source } of models) {
      const errors = await errorsOf(source);
      if (errors.length > 0) failing.push(`${where}:\n  ${errors.join("\n  ")}`);
    }
    expect(failing).toEqual([]);
  }, 120_000);
});
