// Where `generate system --sourcemap` writes the source map in a generated
// tree, relative to the output root: a debug artifact beside the build
// output, read by `ddd trace`, `ddd breakpoints`, the debug adapter, the
// language server and the playground.  Shared here so every layer names the
// same path.
export const SOURCE_MAP_PATH = "debug/sourcemap.json";
