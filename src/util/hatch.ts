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
// `hatchStub(content)`, which prefixes a private tag.  The tag contains NUL
// characters, so it cannot occur in real source text, and it never reaches
// output: `splitHatches` (called once, by the system orchestrator) moves every
// tagged file into the hatch map and strips the tag.  This lets a hatch travel
// through every backend's existing path routing (layout adapters, `place`)
// without a second output map threaded through each of them.

const HATCH_TAG = "\u0000hatch\u0000";

/** Mark `content` as the stub of a user-owned hatch file. */
export function hatchStub(content: string): string {
  return HATCH_TAG + content;
}

/** True when `content` was built by {@link hatchStub} and not yet split out. */
function isHatchStub(content: string): boolean {
  return content.startsWith(HATCH_TAG);
}

/** Apply a content post-processor (an import finalizer, say) to the text of
 *  `content`, keeping the hatch tag in place when there is one. */
export function mapStubContent(content: string, fn: (text: string) => string): string {
  return isHatchStub(content) ? hatchStub(fn(content.slice(HATCH_TAG.length))) : fn(content);
}

/** Move every hatch stub out of `files` (in place) and return them, tag
 *  stripped, keyed by the same path.  After this `files` holds generated
 *  output only, so a path is in exactly one of the two maps. */
export function splitHatches(files: Map<string, string>): Map<string, string> {
  const hatches = new Map<string, string>();
  for (const [path, content] of files) {
    if (!isHatchStub(content)) continue;
    hatches.set(path, content.slice(HATCH_TAG.length));
  }
  for (const path of hatches.keys()) files.delete(path);
  return hatches;
}

/** True when any content still carries the private tag — the gate that the
 *  tag never leaks into a written file. */
export function containsHatchTag(content: string): boolean {
  return content.includes(HATCH_TAG);
}
