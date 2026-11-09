import * as fs from "node:fs";
import * as path from "node:path";
import type { Command } from "commander";
import { applyPatches, type ModelPatch } from "../../language/model-patch.js";
import { withJsonStdout } from "../project.js";

/**
 * `ddd patch <file> --patches <json>` — apply node-addressed model patches
 * (https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/ai-authoring-loop.md §4).  Default output is the patched
 * source on stdout (so it composes: `ddd patch m.ddd --patches p.json > m2.ddd`);
 * `--json` emits the structured PatchResult.  Exits 1 if any patch fails.
 */
async function runPatch(file: string, patchesFile: string, options: { json?: boolean }) {
  const absolute = path.resolve(file);
  if (!fs.existsSync(absolute)) {
    throw new Error(`File not found: ${absolute}`);
  }
  const source = fs.readFileSync(absolute, "utf8");
  const raw =
    patchesFile === "-"
      ? fs.readFileSync(0, "utf8")
      : fs.readFileSync(path.resolve(patchesFile), "utf8");
  const parsed = JSON.parse(raw) as ModelPatch[] | { patches: ModelPatch[] };
  const patches = Array.isArray(parsed) ? parsed : parsed.patches;

  // Both output modes own stdout byte-for-byte — the JSON PatchResult, and
  // the patched source `ddd patch … > m2.ddd` redirects — so the parse runs
  // under the stray-stdout guard either way (see `withJsonStdout`).
  const result = await withJsonStdout(() => applyPatches(source, patches));
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.ok) {
    process.stdout.write(result.text);
  } else {
    for (const e of result.errors) {
      console.error(`patch error [${e.patch.op} ${e.patch.target}]: ${e.message}`);
    }
  }
  if (!result.ok) process.exit(1);
}

/** Registers `ddd patch` on the CLI program. */
export function registerPatchCommand(program: Command): void {
  program
    .command("patch <file>")
    .description(
      "Apply node-addressed model patches (JSON) to a .ddd file; prints the patched source, or --json for the structured PatchResult. See docs/api-toolkit.md.",
    )
    .requiredOption(
      "--patches <file>",
      "JSON file (or '-' for stdin): a ModelPatch[] or { patches: [...] }",
    )
    .option("--json", "emit the structured PatchResult instead of the patched source")
    .action(async (file: string, options: { patches: string; json?: boolean }) => {
      await runPatch(file, options.patches, options);
    });
}
