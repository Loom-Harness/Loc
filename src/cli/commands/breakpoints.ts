import * as fs from "node:fs";
import * as path from "node:path";
import type { Command } from "commander";
import { translateBreakpoint } from "../../dap/index.js";
import type { SourceMap } from "../../trace/index.js";
import { resolveMapPath } from "./trace.js";

interface BreakpointOptions {
  line?: string;
  map?: string;
  out?: string;
}

/** `ddd breakpoints` — resolve a `.ddd` source line to the generated
 *  file:line(s) it produced, via `.loom/sourcemap.json` — the reverse of
 *  `ddd trace`. Best-effort: exits 0 whenever the map loads, same as
 *  `runTrace` — a line with no mapping is a valid answer, not a failure. */
async function runBreakpoints(file: string, options: BreakpointOptions): Promise<void> {
  const absolute = path.resolve(file);
  if (!fs.existsSync(absolute)) {
    console.error(`DDD file not found: ${absolute}`);
    process.exit(1);
  }

  const line = Number(options.line);
  if (!Number.isInteger(line) || line < 1) {
    console.error("--line must be a positive integer");
    process.exit(1);
  }

  const mapPath = resolveMapPath(options);
  if (!fs.existsSync(mapPath)) {
    console.error(
      `Source map not found at ${mapPath}. Regenerate it with ` +
        "`ddd generate system <file> -o <out> --sourcemap`, or pass --map <path>.",
    );
    process.exit(1);
  }

  let map: SourceMap;
  try {
    map = JSON.parse(fs.readFileSync(mapPath, "utf8")) as SourceMap;
  } catch (err) {
    console.error(
      `Could not parse source map at ${mapPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  const readSource = (p: string): string | undefined => {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      return undefined;
    }
  };

  const targets = translateBreakpoint(map, absolute, line, readSource);
  if (targets.length === 0) {
    console.log(`No generated location maps to ${file}:${line}.`);
    return;
  }
  if (targets.length > 1) {
    console.log(`${file}:${line} maps to ${targets.length} generated location(s):`);
  }
  for (const t of targets) {
    console.log(t.column !== undefined ? `${t.file}:${t.line}:${t.column}` : `${t.file}:${t.line}`);
  }
}

/** Registers `ddd breakpoints` on the CLI program. */
export function registerBreakpointsCommand(program: Command): void {
  program
    .command("breakpoints <file>")
    .description(
      "Resolve a .ddd source line to the generated file:line(s) it produced, via " +
        ".loom/sourcemap.json — the reverse of `ddd trace`. See docs/debugging.md.",
    )
    .requiredOption("--line <n>", "1-based .ddd source line to resolve")
    .option(
      "--map <path>",
      "explicit path to sourcemap.json (default: <out>/.loom/sourcemap.json, else ./.loom/sourcemap.json)",
    )
    .option(
      "-o, --out <dir>",
      "the directory the system was generated into (used to locate the map when --map is omitted)",
    )
    .action(async (file: string, options: BreakpointOptions) => {
      await runBreakpoints(file, options);
    });
}
