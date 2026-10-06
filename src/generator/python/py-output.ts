import { EmissionSink } from "../../util/emission-sink.js";
import { finalizePyModule } from "../_imports/python.js";
import { assertNoMarkers } from "../_imports/symbol.js";

const finalize = (path: string, content: string): string =>
  path.endsWith(".py") ? finalizePyModule(content, { path }) : content;

/**
 * The python backend's output map: the write-once `EmissionSink` (a second
 * write of different content to one path fails generation), with every `.py`
 * module finalized as it is written — its `ref()` markers spelled and its
 * import block derived from the symbols it references, in canonical order
 * (M-T9.84, `src/generator/_imports/python.ts`).  A deliberate `replace`
 * (post-processing an emitted module) is finalized the same way.  Readers that
 * need the final text of a module (the source-map recorder) read it back with
 * `get`.
 */
export class PyOutputMap extends EmissionSink {
  constructor(label = "generator/python/index") {
    super(label);
  }

  override set(path: string, content: string): this {
    return super.set(path, finalize(path, content));
  }

  override replace(path: string, content: string): this {
    return super.replace(path, finalize(path, content));
  }

  /** Fail closed: no emitted file may carry an unresolved import marker. */
  assertFinal(): this {
    for (const [path, content] of this) assertNoMarkers(path, content);
    return this;
  }
}
