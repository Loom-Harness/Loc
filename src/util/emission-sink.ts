// ---------------------------------------------------------------------------
// Write-once emission sink — the output map every generator writes into.
//
// A generator's output is a `Map<path, content>`.  On a plain `Map`, two
// emitters that resolve to the SAME path silently clobber each other: the
// last `set` wins and the first file vanishes from the generated tree with
// no diagnostic (#3045 — an elixir operation's request schema emitted, then
// overwritten by a workflow's; the per-context `workflows_controller.ex`
// note in `elixir/vanilla/workflow-execution-emit.ts`).  `EmissionSink` is a
// drop-in `Map` whose `set` REFUSES a second write of DIFFERENT content to a
// path and names both writers, so a path collision fails generation instead
// of shipping a tree that is missing a file.
//
// Identical re-writes are allowed, deliberately: several producers emit a
// byte-identical shared file by design (e.g. one shared runtime helper per
// hosted context, the per-deployable copy of a system-level artifact).
// Writing the same bytes twice loses nothing, so it is a dedupe, not a
// clobber, and forcing every such producer to coordinate would only move
// the "who writes it" bookkeeping around.
//
// A DELIBERATE rewrite of a path already written (post-processing a finished
// file — appending a source-map directive, injecting an import) goes through
// `replace` / `rewrite`, which say so at the call site.  `test/generator/
// emission-sink-census.test.ts` bans a plain `new Map<string, string>()`
// output map under src/generator, src/platform and src/system, so a new
// orchestrator cannot opt out by accident.
// ---------------------------------------------------------------------------

/** Thrown when two producers write different content to one output path. */
export class EmissionClobberError extends Error {
  constructor(
    readonly sink: string,
    readonly path: string,
    firstWriter: string,
    secondWriter: string,
  ) {
    super(
      `[${sink}] two producers wrote different content to the same output path "${path}" — ` +
        `the second write would silently drop the first file.\n` +
        `  first writer:  ${firstWriter}\n` +
        `  second writer: ${secondWriter}\n` +
        `Give one of them a distinct path (or, for a deliberate post-processing rewrite, use ` +
        `sink.replace / rewrite from src/util/emission-sink.ts).`,
    );
    this.name = "EmissionClobberError";
  }
}

/** The first generator frame of a captured stack — the emitter that wrote. */
function writerOf(err: Error | undefined): string {
  if (!err?.stack) return "<unknown>";
  const frames = err.stack.split("\n").slice(1);
  const own = frames.find(
    (f) => !/[\\/]util[\\/]emission-sink\.[jt]s/.test(f) && !f.includes("node:internal"),
  );
  return (own ?? frames[0] ?? "<unknown>").trim().replace(/^at /, "");
}

export class EmissionSink extends Map<string, string> {
  /** Where each path's live content was written from.  An `Error` captures
   *  its raw frames cheaply; the stack is only formatted on a collision. */
  private readonly writers = new Map<string, Error>();

  constructor(
    readonly label: string,
    entries?: Iterable<readonly [string, string]>,
  ) {
    super();
    if (entries) for (const [k, v] of entries) this.set(k, v);
  }

  override set(path: string, content: string): this {
    // `Map`'s own constructor calls `set` before our fields exist.
    if (this.writers === undefined) return super.set(path, content);
    return this.write(path, content, new Error());
  }

  /** The emitter that wrote `path` (its first non-sink stack frame). */
  writerOf(path: string): string {
    return writerOf(this.writers.get(path));
  }

  /** Copy every file of `src` under `prefix`, write-once, carrying each file's
   *  ORIGINAL writer across when `src` is itself a sink — so a collision
   *  between two deployables' trees names the two emitters, not the copy loop. */
  copyFrom(src: ReadonlyMap<string, string>, prefix = ""): this {
    for (const [path, content] of src) {
      const origin = src instanceof EmissionSink ? src.writers.get(path) : undefined;
      this.write(`${prefix}${path}`, content, origin ?? new Error());
    }
    return this;
  }

  private write(path: string, content: string, writer: Error): this {
    const prev = super.get(path);
    if (prev !== undefined && prev !== content) {
      throw new EmissionClobberError(
        this.label,
        path,
        writerOf(this.writers.get(path)),
        writerOf(writer),
      );
    }
    if (prev === undefined) this.writers.set(path, writer);
    return super.set(path, content);
  }

  /** Deliberately overwrite a path (post-processing an already-emitted file). */
  replace(path: string, content: string): this {
    this.writers.set(path, new Error());
    return super.set(path, content);
  }

  override delete(path: string): boolean {
    this.writers.delete(path);
    return super.delete(path);
  }

  override clear(): void {
    this.writers.clear();
    super.clear();
  }
}

/** A fresh write-once output map.  `label` names the producer in errors. */
export function emissionSink(label: string): EmissionSink {
  return new EmissionSink(label);
}

/** Deliberately overwrite `path` in an output map that may or may not be a
 *  sink — the explicit spelling of a post-processing rewrite. */
export function rewrite(out: Map<string, string>, path: string, content: string): void {
  if (out instanceof EmissionSink) out.replace(path, content);
  else out.set(path, content);
}
