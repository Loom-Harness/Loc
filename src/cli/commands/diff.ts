import * as path from "node:path";
import type { Command } from "commander";
import { diffModels } from "../../api/evolve.js";
import type { EnrichedLoomModel } from "../../ir/types/loom-ir.js";
import { checkoutGitBaseline, type GitBaseline } from "../diff-baseline.js";
import {
  type DiffBaseline,
  type DiffCommandReport,
  describeDiffBaseline,
  diffExitCode,
  renderDiffReport,
} from "../diff-report.js";
import { readChainFiles } from "../migrate.js";
import { loadValidProject, relPath, withJsonStdout } from "../project.js";
import { ALL_WARNINGS_FLAG, ALL_WARNINGS_HELP } from "../report.js";

interface DiffOptions {
  baseline?: string;
  git?: string;
  json?: boolean;
  allWarnings?: boolean;
}

/** `ddd diff` — classify what the model changed since its baseline as
 *  compatible / breaking-for-clients / breaking-for-data, over the toolkit's
 *  `diffModels` (the core `loom_diff` runs), so the CLI and the agent tool
 *  agree by construction.  The baseline is `--baseline <old.ddd>`, `--git
 *  <ref>` (the entry as committed there), or by default the committed
 *  `migrations/` chain — the last carries no wire contract, so it classifies
 *  only the schema side.  Returns the exit code — 0 compatible, 1 breaking, 2
 *  when nothing could be diffed — and the report when one was derived; the
 *  caller prints it under `--json`, outside the stdout diversion. */
async function runDiff(
  file: string,
  options: DiffOptions,
): Promise<{ code: 0 | 1 | 2; report?: DiffCommandReport }> {
  if (options.baseline !== undefined && options.git !== undefined) {
    console.error("ddd diff takes one baseline: --baseline <old.ddd> or --git <ref>, not both.");
    return { code: 2 };
  }
  const current = await loadValidProject(file, options.allWarnings);
  if (!current) return { code: 2 };

  let gitBaseline: GitBaseline | undefined;
  try {
    let baselineLoom: EnrichedLoomModel | null = null;
    let chainFiles: { name: string; content: string }[] | undefined;
    let baseline: DiffBaseline;
    let baselinePath: string | undefined;
    if (options.git !== undefined) {
      try {
        gitBaseline = checkoutGitBaseline(file, options.git);
      } catch (err) {
        console.error(`${file}: ${err instanceof Error ? err.message : String(err)}`);
        return { code: 2 };
      }
      baselinePath = gitBaseline.entry;
      baseline = { kind: "git", ref: options.git, path: gitBaseline.repoPath };
    } else if (options.baseline !== undefined) {
      baselinePath = options.baseline;
      baseline = { kind: "file", path: options.baseline };
    } else {
      // The schema the database is at is what the chain recorded, so with no
      // explicit baseline the chain is it.
      chainFiles = readChainFiles(file);
      if (!chainFiles) {
        console.error(
          `${file}: nothing to diff against — pass --baseline <old.ddd> or --git <ref>, ` +
            "or record the schema with `ddd migrate add` so migrations/ is the baseline.",
        );
        return { code: 2 };
      }
      baseline = { kind: "chain", dir: relPath(path.join(path.dirname(file), "migrations")) };
    }
    if (baselinePath !== undefined) {
      baselineLoom = await loadValidProject(baselinePath, options.allWarnings);
      if (!baselineLoom) {
        console.error(
          `${file}: the baseline ${describeDiffBaseline(baseline)} does not load (its diagnostics are above), so there is nothing to diff against.`,
        );
        return { code: 2 };
      }
    }

    const report: DiffCommandReport = {
      ...diffModels(current, baselineLoom, chainFiles),
      baseline,
    };
    for (const d of report.diagnostics) console.error(`${d.code} ${d.severity}: ${d.message}`);
    if (!options.json && report.ok) process.stdout.write(renderDiffReport(report));
    return { code: diffExitCode(report), report };
  } finally {
    gitBaseline?.cleanup();
  }
}

/** Registers `ddd diff` on the CLI program. */
export function registerDiffCommand(program: Command): void {
  program
    .command("diff <file>")
    .description(
      "Classify what the model changed since a baseline as compatible / breaking-for-clients (wire contract) / breaking-for-data (the destructive migration gate). Exits 0 compatible, 1 breaking, 2 when it cannot diff. See docs/tools.md.",
    )
    .option("--baseline <old.ddd>", "diff against this previous model")
    .option(
      "--git <ref>",
      "diff against the entry .ddd (and the .ddd files it imports) as committed at <ref>",
    )
    .option("--json", "print the report as JSON")
    .option(ALL_WARNINGS_FLAG, ALL_WARNINGS_HELP)
    .action(async (file: string, options: DiffOptions) => {
      if (!options.json) process.exit((await runDiff(file, options)).code);
      const { code, report } = await withJsonStdout(() => runDiff(file, options));
      if (report) console.log(JSON.stringify(report, null, 2));
      process.exit(code);
    });
}
