import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The IR vocabulary is one module per declaration area under `src/ir/types/`,
// re-exported by `loom-ir.ts`.  Tests that read the declarations as source
// read every module the barrel names, so a declaration moving between
// modules does not hide it.

const IR_TYPES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
  "ir",
  "types",
);

/** Absolute paths of the modules `loom-ir.ts` re-exports, in barrel order. */
export function irTypeModules(): string[] {
  const barrel = readFileSync(join(IR_TYPES_DIR, "loom-ir.ts"), "utf8");
  const mods = [...barrel.matchAll(/^export \* from "\.\/([\w-]+)\.js";$/gm)].map((m) =>
    join(IR_TYPES_DIR, `${m[1]}.ts`),
  );
  if (mods.length < 10) throw new Error(`loom-ir.ts re-exports only ${mods.length} modules`);
  return mods;
}

/** Every IR declaration module's text, concatenated in barrel order. */
export function irTypesSource(): string {
  return irTypeModules()
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
}
