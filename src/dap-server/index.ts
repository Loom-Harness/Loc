// Public surface of the Loom DAP server core — re-exported by the publish
// wrapper `packages/ddd-dap/`. Transport wiring (stdio) lives in `main.ts`
// and map-path resolution in `args.ts`; this barrel is the embeddable surface (mirrors
// `src/mcp/index.ts`).
export { loadSourceMap, makeFsReadSource } from "./load-map.js";
export type { ReadSource } from "./session.js";
export { LoomDebugSession } from "./session.js";
