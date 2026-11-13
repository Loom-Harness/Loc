// ---------------------------------------------------------------------------
// src/dap-server/main.ts — the stdio entrypoint for the Loom DAP server.
//
// Compiled to `out/dap-server/main.js` and invoked by the `packages/ddd-dap/
// bin.js` shim (`npx ddd-dap`). Mirrors `src/mcp/main.ts`'s role for the MCP
// server / `src/cli/main.ts`'s role for the CLI bin: resolves the map path
// (`args.ts` — `--map <path>` / `--map=<path>`, else `LOOM_DAP_MAP`, else
// `./.loom/sourcemap.json`), loads the fs-backed `.loom/sourcemap.json` (via
// `load-map.ts`), constructs the fs-free `LoomDebugSession` over it, and wires
// it to the stdio DAP transport via the SDK's `ProtocolServer.start(inStream,
// outStream)`.
// ---------------------------------------------------------------------------

import { DapArgsError, resolveMapPathFromArgs } from "./args.js";
import { loadSourceMap, makeFsReadSource } from "./load-map.js";
import { LoomDebugSession } from "./session.js";

function main(): void {
  const mapPath = resolveMapPathFromArgs(process.argv.slice(2), process.env.LOOM_DAP_MAP);
  const map = loadSourceMap(mapPath);
  const session = new LoomDebugSession(map, makeFsReadSource());
  session.start(process.stdin, process.stdout);
  // The process stays alive on the stdio transport until the host closes it
  // (or the session `shutdown()`s itself) — same lifecycle note as
  // `src/mcp/main.ts`.
}

try {
  main();
} catch (err) {
  // Diagnostics go to stderr — stdout is the DAP transport channel and must
  // carry only protocol frames.
  console.error(err instanceof DapArgsError ? `ddd-dap: ${err.message}` : err);
  process.exit(1);
}
