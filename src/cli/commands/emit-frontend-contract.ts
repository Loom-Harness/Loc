import type { Command } from "commander";
import {
  buildFrontendContract,
  renderFrontendContract,
} from "../../ir/contract/frontend-contract.js";
import { validateLoomModel } from "../../ir/validate/validate.js";
import { hostValidateOptions, parseProject } from "../project.js";
import { printAstDiagnostics, printIrDiagnostics, printSummary } from "../report.js";

/**
 * `ddd emit-frontend-contract` — validate the model, then write one system's
 * Frontend Contract (`src/ir/contract/frontend-contract.ts`): the resolved UI
 * plus the exposed wire surface a frontend target emits from.  JSON goes to
 * stdout (the contract is an internal boundary, not a file in the generated
 * tree); diagnostics go to stderr.  A model with errors writes nothing and exits 1.
 */
async function runEmitFrontendContract(file: string, options: { system?: string }): Promise<void> {
  const result = await parseProject(file);
  const ast = printAstDiagnostics(result);
  if (result.errorCount > 0) {
    printSummary(ast);
    process.exit(1);
  }
  const loom = result.loom;
  const { errors } = printIrDiagnostics(
    validateLoomModel(loom, hostValidateOptions(file)),
    result.sourceTexts,
  );
  if (errors.length > 0) {
    printSummary(ast, { errors: errors.length, warnings: 0 });
    process.exit(1);
  }

  const systems = options.system
    ? loom.systems.filter((s) => s.name === options.system)
    : loom.systems;
  if (systems.length !== 1) {
    const names = loom.systems.map((s) => s.name).join(", ") || "none";
    console.error(
      options.system
        ? `No system named '${options.system}' (systems: ${names}).`
        : `Expected one system, found ${loom.systems.length} (${names}); pick one with --system.`,
    );
    process.exit(1);
  }
  const text = renderFrontendContract(buildFrontendContract(loom, systems[0]!));
  process.stdout.write(text);
}

/** Registers `ddd emit-frontend-contract` on the CLI program. */
export function registerEmitFrontendContractCommand(program: Command): void {
  program
    .command("emit-frontend-contract <file>")
    .description(
      "Write a system's Frontend Contract — the resolved UI plus the exposed wire surface a frontend target emits from — as JSON to stdout.",
    )
    .option("--system <name>", "the system to emit, when the model declares more than one")
    .action(async (file: string, options: { system?: string }) => {
      await runEmitFrontendContract(file, options);
    });
}
