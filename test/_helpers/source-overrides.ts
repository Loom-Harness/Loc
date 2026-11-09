// The source-language text of a migrated `.ddd`.
//
// A rule is NAMED (`invariant balanceNegative: …`) and its English sentence lives
// in `locales/en/<Ctx>.json` beside the `.ddd` — not in the model.  `ddd generate`
// reads that tree itself; a test that hands the generator a SOURCE STRING has no
// file beside it, so the override has to travel with the string.  A loader that
// turns a `.ddd` file into a string (the corpus harness, `loadExample`) appends a
// trailing line comment naming the file (`readWithOverrides`), and the shared
// generate helpers (`generateSystemFiles` / `generateSystemResult`) read it back
// (`overridesOf`) — so a migrated fixture emits the same English in a test as it
// does under the CLI, without any test knowing the tree exists.  The pointer
// rides in the text, not in module state: it survives the `.replace(…)` a test
// applies to a fixture, and nothing is shared across test files.

import { resolve } from "node:path";
import { loadSourceOverrides } from "../../src/cli/i18n/tree.js";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const MARKER = "// loom-test-source: ";
const MARKER_AT = new RegExp(`\\n${MARKER}(\\S+)\\s*$`);

/** The overrides of the translator tree beside `dddFile` (`locales/en/*.json`);
 *  empty when it has none. */
export function overridesBeside(dddFile: string): ReadonlyMap<string, string> {
  return loadSourceOverrides(dddFile);
}

/** `source`, read from `dddFile` (absolute), stamped with the repo-relative path
 *  of the file when a translator tree sits beside it; otherwise unchanged. */
export function readWithOverrides(dddFile: string, source: string): string {
  if (overridesBeside(dddFile).size === 0) return source;
  const rel = dddFile.slice(REPO_ROOT.length + 1);
  return `${source.replace(/\s+$/, "")}\n${MARKER}${rel}\n`;
}

/** The overrides of the file `source` was stamped with by
 *  {@link readWithOverrides}, if it was. */
export function overridesOf(source: string): ReadonlyMap<string, string> | undefined {
  const rel = MARKER_AT.exec(source)?.[1];
  return rel ? overridesBeside(resolve(REPO_ROOT, rel)) : undefined;
}
