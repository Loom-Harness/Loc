import { EmissionSink } from "../../util/emission-sink.js";
import { mapStubContent } from "../../util/hatch.js";
import { finalizePyModule } from "../_imports/python.js";
import { assertNoMarkers, resolveMarkers } from "../_imports/symbol.js";

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
  /** Every python module some emitted module's markers referenced — the
   *  recorded use a helper module (`app/domain/numeric.py`) is emitted on. */
  private readonly referenced = new Set<string>();

  constructor(label = "generator/python/index") {
    super(label);
  }

  override set(path: string, content: string): this {
    return super.set(path, this.finalize(path, content));
  }

  override replace(path: string, content: string): this {
    return super.replace(path, this.finalize(path, content));
  }

  /** True when a module written so far referenced `module` through a marker. */
  references(module: string): boolean {
    return this.referenced.has(module);
  }

  private finalize(path: string, content: string): string {
    if (!path.endsWith(".py")) return content;
    return mapStubContent(content, (text) => {
      for (const sym of resolveMarkers(text).used) this.referenced.add(sym.module);
      return finalizePyModule(text, { path });
    });
  }

  /** Fail closed: no emitted file may carry an unresolved import marker. */
  assertFinal(): this {
    for (const [path, content] of this) assertNoMarkers(path, content);
    return this;
  }
}
