// The resource-verb registry is pure data shared by the language layer's
// typing pass and the IR lowerers, so it lives in `src/util/` (a layer both
// may import). This re-export keeps the IR-side import paths stable.
export * from "../util/resource-verbs.js";
