// ---------------------------------------------------------------------------
// src/dap-server/args.ts — argv parsing for the `ddd-dap` stdio entrypoint.
//
// Pure (no `process`, no `fs`) so it is unit-testable: `main.ts` passes
// `process.argv.slice(2)` and `process.env.LOOM_DAP_MAP` in.
//
// The map path is `--map <path>` or `--map=<path>` on argv, else the
// `LOOM_DAP_MAP` env var, else `.loom/sourcemap.json` relative to the
// current working directory (the same default `ddd trace` / `ddd
// breakpoints` use). Any other argument is an error: an editor launch
// config with a typo must fail loudly rather than fall back to the default
// map and die later on a missing file.
// ---------------------------------------------------------------------------

import * as path from "node:path";

/** A bad command line — `main.ts` prints its message (no stack) and exits 1. */
export class DapArgsError extends Error {
  override readonly name = "DapArgsError";
}

const DAP_USAGE = "usage: ddd-dap [--map <path/to/.loom/sourcemap.json>]";

/** Resolve the absolute sourcemap path from `argv` (process args after the
 *  script) and the `LOOM_DAP_MAP` env value. Throws `DapArgsError` on an
 *  unknown argument, a repeated `--map`, or a `--map` with no value. */
export function resolveMapPathFromArgs(
  argv: readonly string[],
  envMap: string | undefined,
): string {
  let argMap: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    let value: string | undefined;
    if (arg === "--map") {
      value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new DapArgsError(`--map needs a path.\n${DAP_USAGE}`);
      }
      i++;
    } else if (arg.startsWith("--map=")) {
      value = arg.slice("--map=".length);
      if (value === "") throw new DapArgsError(`--map needs a path.\n${DAP_USAGE}`);
    } else {
      throw new DapArgsError(`unknown argument '${arg}'.\n${DAP_USAGE}`);
    }
    if (argMap !== undefined) throw new DapArgsError(`--map given more than once.\n${DAP_USAGE}`);
    argMap = value;
  }
  if (argMap !== undefined) return path.resolve(argMap);
  if (envMap) return path.resolve(envMap);
  return path.resolve(".loom", "sourcemap.json");
}
