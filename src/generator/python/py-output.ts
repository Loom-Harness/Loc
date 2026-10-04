import { finalizePyModule } from "../_imports/python.js";
import { assertNoMarkers } from "../_imports/symbol.js";

/**
 * The python backend's output map: every `.py` module is finalized as it is
 * written — its `ref()` markers spelled and its import block derived from the
 * symbols it references, in canonical order (M-T9.84,
 * `src/generator/_imports/python.ts`).  Readers that need the final text of a
 * module (the source-map recorder) read it back with `get`.
 */
export class PyOutputMap extends Map<string, string> {
  override set(path: string, content: string): this {
    return super.set(path, path.endsWith(".py") ? finalizePyModule(content, { path }) : content);
  }

  /** Fail closed: no emitted file may carry an unresolved import marker. */
  assertFinal(): this {
    for (const [path, content] of this) assertNoMarkers(path, content);
    return this;
  }
}
