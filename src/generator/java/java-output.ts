import { EmissionSink } from "../../util/emission-sink.js";
import { finalizeJavaUnit, indexJavaProject } from "../_imports/java.js";
import { assertNoMarkers } from "../_imports/symbol.js";

/**
 * The Java backend's output map: the write-once `EmissionSink` (a second
 * write of different content to one path fails generation).  Every `.java`
 * compilation unit is finalized once the whole project is written — its
 * `ref()` markers spelled and its import block derived from the types it
 * references, in canonical order (`src/generator/_imports/java.ts`).  The
 * finalizer needs the project's type index (which package declares each
 * domain type), so it runs over the finished tree, not per write; readers that
 * need the final text (the source-map recorder) read it after `finalizeUnits`.
 */
export class JavaOutputMap extends EmissionSink {
  private finalized = false;

  constructor(label = "generator/java/index") {
    super(label);
  }

  override set(path: string, content: string): this {
    this.assertOpen(path);
    return super.set(path, content);
  }

  override replace(path: string, content: string): this {
    this.assertOpen(path);
    return super.replace(path, content);
  }

  /** Finalize every `.java` unit against the project's type index.  Runs
   *  once; the map takes no further writes. */
  finalizeUnits(): this {
    if (this.finalized) return this;
    const index = indexJavaProject(this);
    for (const [path, content] of this) {
      if (!path.endsWith(".java")) continue;
      Map.prototype.set.call(this, path, finalizeJavaUnit(content, { path, index }));
    }
    this.finalized = true;
    return this;
  }

  /** Finalize, then fail closed: no emitted file may carry an unresolved
   *  import marker. */
  assertFinal(): this {
    this.finalizeUnits();
    for (const [path, content] of this) assertNoMarkers(path, content);
    return this;
  }

  private assertOpen(path: string): void {
    if (this.finalized && path.endsWith(".java")) {
      throw new Error(`${path}: written after the Java units were finalized`);
    }
  }
}
