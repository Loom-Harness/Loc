import { EmissionSink } from "../../util/emission-sink.js";
import { finalizeJavaUnit } from "../_imports/java.js";
import { assertNoMarkers } from "../_imports/symbol.js";

const finalize = (path: string, content: string): string =>
  path.endsWith(".java") ? finalizeJavaUnit(content, { path }) : content;

/**
 * The Java backend's output map: the write-once `EmissionSink` (a second
 * write of different content to one path fails generation), with every
 * `.java` compilation unit finalized as it is written — its `ref()` markers
 * spelled and its import block derived from the types it references, in
 * canonical order (M-T9.86, `src/generator/_imports/java.ts`).  A deliberate
 * `replace` is finalized the same way.  Readers that need the final text (the
 * source-map recorder) read it back with `get`.
 */
export class JavaOutputMap extends EmissionSink {
  constructor(label = "generator/java/index") {
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
