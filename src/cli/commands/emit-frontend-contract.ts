import * as fs from "node:fs";
import * as path from "node:path";
import type { Command } from "commander";
import {
  buildFrontendContract,
  renderFrontendContract,
} from "../../ir/contract/frontend-contract.js";
import { validateLoomModel } from "../../ir/validate/validate.js";
import { hostValidateOptions, parseProject } from "../project.js";
import { printAstDiagnostics, printIrDiagnostics, printSummary } from "../report.js";

/** Where `-o <dir>` writes the contract, beside the rest of the `.loom/` bundle. */
const FRONTEND_CONTRACT_PATH = ".loom/frontend-contract.json";

/**
 * `ddd emit-frontend-contract` — validate the model, then write one system's
 * Frontend Contract (`src/ir/contract/frontend-contract.ts`): the resolved UI
 * plus the exposed wire surface a frontend target emits from.  JSON goes to
 * stdout, or to `<out>/.loom/frontend-contract.json` with `-o`; diagnostics go
 * to stderr either way.  A model with errors writes nothing and exits 1.
 */
async function runEmitFrontendContract(
  file: string,
  options: { out?: string; system?: string },
): Promise<void> {
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
  if (!options.out) {
    process.stdout.write(text);
    return;
  }
  const target = path.join(options.out, FRONTEND_CONTRACT_PATH);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text, "utf8");
  console.error(`Wrote ${target}`);
}

/** Registers `ddd emit-frontend-contract` on the CLI program. */
export function registerEmitFrontendContractCommand(program: Command): void {
  program
    .command("emit-frontend-contract <file>")
    .description(
      "Write a system's Frontend Contract — the resolved UI plus the exposed wire surface a frontend target emits from — as JSON to stdout, or to <out>/.loom/frontend-contract.json.",
    )
    .option("-o, --out <dir>", "write <dir>/.loom/frontend-contract.json instead of stdout")
    .option("--system <name>", "the system to emit, when the model declares more than one")
    .action(async (file: string, options: { out?: string; system?: string }) => {
      await runEmitFrontendContract(file, options);
    });
}
