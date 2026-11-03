// The source-language text of a migrated `.ddd`.
//
// A rule is NAMED (`invariant balanceNegative: …`) and its English sentence lives
// in `locales/en/<Ctx>.json` beside the `.ddd` — not in the model.  `ddd generate`
// reads that tree itself; a test that hands the generator a SOURCE STRING has no
// file beside it, so the override has to travel with the string.  Every loader
// that turns a `.ddd` file into a string (the corpus harness, `loadExample`)
// registers the file's overrides here against the exact text it returned, and
// the shared generate helpers (`generateSystemFiles` / `generateSystemResult`)
// look the text up — so a migrated fixture emits the same English in a test as
// it does under the CLI, without any test knowing the tree exists.

import { loadSourceOverrides } from "../../src/cli/i18n/tree.js";

type Overrides = ReadonlyMap<string, string>;

const bySource = new Map<string, Overrides>();

/** The overrides of the translator tree beside `dddFile` (`locales/en/*.json`);
 *  empty when it has none. */
export function overridesBeside(dddFile: string): Overrides {
  return loadSourceOverrides(dddFile);
}

/** Remember that `source` was read from `dddFile`, so generating it applies the
 *  tree beside that file.  Returns `source` for chaining. */
export function readWithOverrides(dddFile: string, source: string): string {
  const overrides = overridesBeside(dddFile);
  if (overrides.size > 0) bySource.set(source, overrides);
  return source;
}

/** The overrides registered for exactly this source text, if any. */
export function registeredOverrides(source: string): Overrides | undefined {
  return bySource.get(source);
}
