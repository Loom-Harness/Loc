import { finalizeJavaUnit } from "../_imports/java.js";
import { assertNoMarkers } from "../_imports/symbol.js";

/**
 * The Java backend's output map: every `.java` compilation unit is finalized
 * as it is written — its `ref()` markers spelled and its import block derived
 * from the types it references, in canonical order (M-T9.86,
 * `src/generator/_imports/java.ts`).  Readers that need the final text (the
 * source-map recorder) read it back with `get`.
 */
export class JavaOutputMap extends Map<string, string> {
  override set(path: string, content: string): this {
    return super.set(path, path.endsWith(".java") ? finalizeJavaUnit(content, { path }) : content);
  }

  /** Fail closed: no emitted file may carry an unresolved import marker. */
  assertFinal(): this {
    for (const [path, content] of this) assertNoMarkers(path, content);
    return this;
  }
}
