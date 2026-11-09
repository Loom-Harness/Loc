import { EmissionSink } from "../../util/emission-sink.js";
import { assertNoMarkers } from "../_imports/symbol.js";
import { assertNoSlots, finalizeTsModule } from "../_imports/ts.js";

const finalize = (path: string, content: string): string =>
  /\.tsx?$/.test(path) ? finalizeTsModule(content, { path }) : content;

/**
 * The node backend's output map: the write-once `EmissionSink`, with every
 * TypeScript module finalized as it is written — its `ref()` markers spelled
 * and the imports they need derived (`src/generator/_imports/ts.ts`).  The
 * path a module is written under is the base of its project-relative
 * specifiers, so a caller that relocates a module finalizes it first under
 * its byLayer path (`finalizeTsModule`) and the layout pass fixes the
 * specifiers up.  Readers that need the final text read it back with `get`.
 */
export class TsOutputMap extends EmissionSink {
  override set(path: string, content: string): this {
    return super.set(path, finalize(path, content));
  }

  override replace(path: string, content: string): this {
    return super.replace(path, finalize(path, content));
  }

  /** Fail closed: no emitted file may carry an unresolved marker or slot. */
  assertFinal(): this {
    for (const [path, content] of this) {
      assertNoMarkers(path, content);
      assertNoSlots(path, content);
    }
    return this;
  }
}
