import * as path from "node:path";
import type { Command } from "commander";
import { validate } from "../../api/index.js";
import { diagMessage } from "../../diagnostics/messages.js";
import { validateLoomModel } from "../../ir/validate/validate.js";
import { hostValidateOptions, parseProject, readSource, withJsonStdout } from "../project.js";
import {
  ALL_WARNINGS_FLAG,
  ALL_WARNINGS_HELP,
  printAstDiagnostics,
  printIrDiagnostics,
  printSummary,
} from "../report.js";

/**
 * `ddd parse <file>` — "parse + validate, exit non-zero on errors".
 *
 * It runs exactly what `generate system` runs, minus the emission — because a
 * pre-flight command that checks LESS than the command it pre-flights is worse
 * than no check: it asserts a file is fine that `generate system` then rejects.
 * Two ways to get that wrong, both avoided here:
 *
 *  - reporting only the AST validator (phase ④), or filtering
 *    `validateLoomModel`'s output down to `loom.index-suggestion`, discards the
 *    phase-⑦ errors it just computed and prints `OK`;
 *  - a SINGLE-document parse makes a multi-file entry report unresolved
 *    cross-file references that `parseProject` — which walks the import graph,
 *    as `generate system` does — resolves fine.
 *
 * A `.ddd` fragment meant to be imported by an entry file still fails here, on
 * its AST errors.
 */
async function runParse(file: string, opts: { allWarnings?: boolean } = {}) {
  // The project loader, matching `generate system` — a multi-file entry
  // resolves its import graph instead of reporting its siblings' declarations
  // as unresolved.
  const result = await parseProject(file);
  const ast = printAstDiagnostics(result);
  // An AST error aborts before lowering, so phase ⑦ never runs — the summary
  // covers the one phase that did, and is still the only summary printed.
  if (result.errorCount > 0) {
    printSummary(ast);
    process.exit(1);
  }

  // Phases ⑤–⑦ — lowering, enrichment and the cross-aggregate IR checks.
  // Lowering can throw on a shape the AST validator does not gate; that throw
  // is reported as an error diagnostic, because `generate system` runs the
  // same phases and would crash on the same model — a pre-flight that prints
  // `OK` there is asserting the opposite of what will happen.
  let irDiagnostics: ReturnType<typeof validateLoomModel>;
  try {
    irDiagnostics = validateLoomModel(result.loom, hostValidateOptions(file));
  } catch (err) {
    irDiagnostics = [
      {
        severity: "error",
        message: diagMessage("loom.ir-internal#generation", {
          err: err instanceof Error ? err.message : String(err),
        }),
        source: path.resolve(file),
        code: "loom.ir-internal",
      },
    ];
  }

  // `--json` used to report `warnings: 2` while the human command printed
  // `0 error(s), 0 warning(s).  OK:` for the same file, because this half was
  // filtered down to the single allow-listed `loom.index-suggestion`.  The
  // shared printer is now the only thing that decides what a phase-⑦
  // diagnostic looks like on either command's stderr.
  const { errors: irErrors, warnings: irWarnings } = printIrDiagnostics(
    irDiagnostics,
    result.sourceTexts,
    opts,
  );
  // Both phases have run — ONE footer, counting both.  It has to come after
  // the IR phase, or it is a verdict on half the file (M-T9.60).
  printSummary(ast, { errors: irErrors.length, warnings: irWarnings.length });
  if (irErrors.length > 0) process.exit(1);

  console.log(`OK: ${file}`);
}

/**
 * `ddd parse --json` — the structured-diagnostics contract
 * (https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/ai-diagnostics-contract.md).  Thin wrapper over the toolkit
 * `validate()`: prints the `ValidateReport` to stdout, exits 1 when not `ok`.
 */
async function runParseJson(file: string): Promise<void> {
  const { absolute, source } = readSource(file);
  const report = await withJsonStdout(() =>
    validate(source, { path: absolute, ...hostValidateOptions(absolute) }),
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exit(1);
}

/** Registers `ddd parse` on the CLI program. */
export function registerParseCommand(program: Command): void {
  program
    .command("parse <file>")
    .description("Parse and validate a .ddd file")
    .option(
      "--json",
      "emit structured diagnostics + outline as JSON (also runs IR validation); see docs/api-toolkit.md",
    )
    .option(ALL_WARNINGS_FLAG, ALL_WARNINGS_HELP)
    .action(async (file: string, options: { json?: boolean; allWarnings?: boolean }) => {
      if (options.json) await runParseJson(file);
      else await runParse(file, { allWarnings: options.allWarnings });
    });
}
