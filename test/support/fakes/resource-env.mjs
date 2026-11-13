// The resource env-var names, read from the ONE place that derives them —
// `src/util/resource-env.ts`, the seam the emitted resource clients and the
// compose writer share.  The kit never spells an env name of its own.
//
// Loaded from the TypeScript source where the runtime strips types (vitest,
// Node ≥ 22.18) and from the compiled `out/` tree otherwise; both are the same
// module.

let mod;
try {
  mod = await import("../../../src/util/resource-env.ts");
} catch {
  mod = await import("../../../out/util/resource-env.js");
}

export const { resourceEnvBase, resourceEnvUrlVar } = mod;
