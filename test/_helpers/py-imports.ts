import { resolveMarkers } from "../../src/generator/_imports/symbol.js";

/** The imports a rendered python fragment DERIVES (M-T9.84): each `ref()`
 *  marker it carries, as `module.name` (or the bare module for a
 *  whole-module import), sorted. */
export function pyDerivedImports(text: string): string[] {
  return resolveMarkers(text)
    .used.map((s) => (s.name === undefined ? s.module : `${s.module}.${s.name}`))
    .sort();
}
