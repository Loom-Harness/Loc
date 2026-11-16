// Escape-hatch stubs — the user-owned files an `extern` construct calls into.
//
// A hatch stub is NOT generated output: it is the starting content of a file
// the user owns from the moment it exists (`docs/extern.md`).  The emitters
// build it next to the generated code that calls it, so the stub and its
// caller cannot disagree on a name or a path, but it must leave generation in
// a separate map: the CLI writes generated files and never writes a hatch
// path, except through the explicit `ddd scaffold` step.  A hatch is present
// when its file exists and pending when it does not; nothing else records it.
//
// Transport inside one compiler run: an emitter wraps the stub with
// `hatchStub(content, owner)`, which prefixes a private tag naming the model
// construct that owns the file (`Ctx.Agg` for an aggregate's extern hooks,
// `Ctx.Handler` for an extern handler).  The tag contains NUL characters, so
// it cannot occur in real source text, and it never reaches output:
// `splitHatches` (called once, by the system orchestrator) moves every tagged
// file into the hatch map and strips the tag.  This lets a hatch travel
// through every backend's existing path routing (layout adapters, `place`)
// without a second output map threaded through each of them.

const TAG_OPEN = "\u0000hatch\u0000";
const TAG_CLOSE = "\u0000";

/** One hatch file as generation renders it. */
export interface HatchFile {
  /** The model construct that calls into the file: `Ctx.Agg` or `Ctx.Handler`. */
  readonly owner: string;
  /** The starting content `ddd scaffold` writes when the file is missing. */
  readonly stub: string;
}

/** Mark `content` as the stub of the hatch file `owner` calls into. */
export function hatchStub(content: string, owner: string): string {
  return `${TAG_OPEN}${owner}${TAG_CLOSE}${content}`;
}

function parseTag(content: string): HatchFile | undefined {
  if (!content.startsWith(TAG_OPEN)) return undefined;
  const end = content.indexOf(TAG_CLOSE, TAG_OPEN.length);
  return {
    owner: content.slice(TAG_OPEN.length, end),
    stub: content.slice(end + TAG_CLOSE.length),
  };
}

/** Apply a content post-processor (an import finalizer, say) to the text of
 *  `content`, keeping the hatch tag in place when there is one. */
export function mapStubContent(content: string, fn: (text: string) => string): string {
  const tagged = parseTag(content);
  return tagged ? hatchStub(fn(tagged.stub), tagged.owner) : fn(content);
}

/** Move every hatch stub out of `files` (in place) and return them, tag
 *  stripped, keyed by the same path.  After this `files` holds generated
 *  output only, so a path is in exactly one of the two maps. */
export function splitHatches(files: Map<string, string>): Map<string, HatchFile> {
  const hatches = new Map<string, HatchFile>();
  for (const [path, content] of files) {
    const tagged = parseTag(content);
    if (tagged) hatches.set(path, tagged);
  }
  for (const path of hatches.keys()) files.delete(path);
  return hatches;
}

/** True when any content still carries the private tag — the gate that the
 *  tag never leaks into a written file. */
export function containsHatchTag(content: string): boolean {
  return content.includes(TAG_OPEN);
}
