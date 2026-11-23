import { EmissionSink } from "../../util/emission-sink.js";
import { type CsProjectSpelling, finalizeCsUnit } from "../_imports/dotnet.js";
import { assertNoMarkers } from "../_imports/symbol.js";

/**
 * The .NET backend's output map: the write-once `EmissionSink` (a second
 * write of different content to one path fails generation), with every `.cs`
 * compilation unit finalized as it is written — its `ref()` markers spelled
 * and its derived `using` lines rendered (`src/generator/_imports/dotnet.ts`).
 * A deliberate `replace` is finalized the same way.  Readers that need the
 * final text (the source-map recorder) read it back with `get`.
 */
export class DotnetOutputMap extends EmissionSink {
  constructor(
    label = "generator/dotnet/index",
    /** What every unit of the project is finalized against. */
    private readonly project?: CsProjectSpelling,
  ) {
    super(label);
  }

  /** `content` as this map would finalize it under `path`, without writing. */
  finalized(path: string, content: string): string {
    return this.finalize(path, content);
  }

  private finalize(path: string, content: string): string {
    return path.endsWith(".cs")
      ? finalizeCsUnit(content, { path, project: this.project })
      : content;
  }

  override set(path: string, content: string): this {
    return super.set(path, this.finalize(path, content));
  }

  override replace(path: string, content: string): this {
    return super.replace(path, this.finalize(path, content));
  }

  /** Fail closed: no emitted file may carry an unresolved import marker. */
  assertFinal(): this {
    for (const [path, content] of this) assertNoMarkers(path, content);
    return this;
  }
}
