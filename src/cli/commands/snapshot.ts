import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Command } from "commander";
import { validateLoomModel } from "../../ir/validate/validate.js";
import { captureSnapshots } from "../../system/loomsnap.js";
import { hostValidateOptions, parseProject } from "../project.js";
import { printAstDiagnostics, printIrDiagnostics, printSummary } from "../report.js";
import type { RunResult } from "./generate.js";

/** Resolve the current git commit (short) for the snapshot envelope, or
 *  undefined when not in a repo / git unavailable. */
function gitCommitHash(): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

/**
 * `ddd snapshot` — the explicit provenance-capture prebuild step.  Lowers
 * the model and writes one immutable, timestamped + GUID-named snapshot
 * file per system under `<out>/.loom/snapshots/`.  Analogous to
 * `dotnet ef migrations add`: run it deliberately when rules change so the
 * deployed runtime's trace records can be explained against a captured
 * version of the code.
 *
 * Multi-file aware — `parseProject`, the same import-graph walk `generate
 * system` and `parse` do.  A single-document parse would report a model split
 * across `import "./shared.ddd"` as broken (a page body naming a component
 * declared in the sibling file resolves to nothing), so a project that
 * GENERATES could not be snapshotted.
 */
async function runSnapshot(
  file: string,
  outDir: string,
  options: { dryRun?: boolean } = {},
): Promise<RunResult> {
  const result = await parseProject(file);
  const ast = printAstDiagnostics(result);
  if (result.errorCount > 0) {
    printSummary(ast);
    process.exit(1);
  }
  const loom = result.loom;
  // The same phase-⑦ printer and single footer `parse` uses, printed on the
  // clean path too: a provenance capture is exactly where a "validation
  // accepts this but it is a no-op" warning matters — the snapshot is what a
  // runtime trace is later explained against.  Only errors exit non-zero.
  const loomDiags = validateLoomModel(loom, hostValidateOptions(file));
  const { errors: loomErrors, warnings: loomWarnings } = printIrDiagnostics(
    loomDiags,
    result.sourceTexts,
  );
  printSummary(ast, { errors: loomErrors.length, warnings: loomWarnings.length });
  if (loomErrors.length > 0) process.exit(1);

  // The capture envelope's commit label: the checkout's HEAD, else an explicit
  // `LOOM_COMMIT_HASH` (a CI that builds from an export with no `.git`).
  const commitHash = gitCommitHash() ?? process.env.LOOM_COMMIT_HASH;
  const files = captureSnapshots(loom, { commitHash });
  if (files.size === 0) {
    console.log(`No written \`provenanced\` field found in ${file}; nothing to capture.`);
    return { hadError: false, written: 0 };
  }

  let written = 0;
  for (const [relPath, content] of files) {
    if (options.dryRun) {
      console.log(
        `  write  ${relPath}  (${(Buffer.byteLength(content, "utf8") / 1024).toFixed(1)} KB)`,
      );
      written++;
      continue;
    }
    const full = path.join(outDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
    written++;
  }
  console.log(
    `${options.dryRun ? "Would capture" : "Captured"} ${written} snapshot file(s) in ${path.join(outDir, ".loom/snapshots")}`,
  );
  return { hadError: false, written };
}

/** Registers `ddd snapshot` on the CLI program. */
export function registerSnapshotCommand(program: Command): void {
  program
    .command("snapshot <file>")
    .description(
      "Capture provenance rule snapshots for every written `provenanced` field — one immutable timestamped+GUID file per system under <out>/.loom/snapshots/. Run as an explicit prebuild step when rules change.",
    )
    .requiredOption("-o, --out <dir>", "output directory")
    .option("--dry-run", "list snapshot files that would be captured, write nothing")
    .action(async (file: string, options: { out: string; dryRun?: boolean }) => {
      await runSnapshot(file, options.out, { dryRun: options.dryRun });
    });
}
