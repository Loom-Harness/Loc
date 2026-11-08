// A behavioural case's `.ddd` and the translator tree beside it.
//
// A rule is NAMED and its English sentence lives in `locales/en/<Ctx>.json`
// next to the `.ddd` (`ddd generate` reads that tree).  The runners hold a case
// as a SOURCE STRING they write into a work dir before invoking the CLI, so the
// tree has to be carried along with the string — otherwise the generated
// backend answers the name-derived sentence instead of the authored one and the
// wire golden it is diffed against moves.  This module is the one place that
// knows the arrangement; dependency-free (fs only) like `registers.mjs`.

import { cpSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The `locales/` directory beside `dddPath`, or `undefined` when it has none. */
export function localesBeside(dddPath) {
  const dir = join(dirname(dddPath), "locales");
  return existsSync(dir) ? dir : undefined;
}

/** Copy `locales` (a case's translator tree) to `<destDir>/locales`, replacing
 *  what is there.  No-op for a case without one. */
export function copyLocales(locales, destDir) {
  if (!locales) return;
  const dest = join(destDir, "locales");
  rmSync(dest, { recursive: true, force: true });
  cpSync(locales, dest, { recursive: true });
}

/** Write `source` to `srcPath` and its translator tree beside it — what every
 *  runner does with a case before `ddd generate system <srcPath>`. */
export function writeCaseSource(srcPath, source, locales) {
  writeFileSync(srcPath, source);
  copyLocales(locales, dirname(srcPath));
}
