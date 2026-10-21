// Delete every file under out/ whose source under src/ no longer exists.
//
// `tsc -b` maps src/<p>.ts to out/<p>.{js,js.map,d.ts,d.ts.map} (and a
// resolveJsonModule import src/<p>.json to out/<p>.json), rebuilds whatever
// changed, and never removes the output of a deleted source.  On a fresh
// checkout out/ does not exist, so this only matters for a restored one.

import * as fs from "node:fs";
import * as path from "node:path";

const OUTPUT_SUFFIXES = [".d.ts.map", ".js.map", ".d.ts", ".js"];

/** The src/ files that could have produced `rel` (a path relative to out/). */
function sourcesOf(rel) {
  if (rel.endsWith(".json")) return [rel];
  const suffix = OUTPUT_SUFFIXES.find((s) => rel.endsWith(s));
  if (!suffix) return [];
  const stem = rel.slice(0, -suffix.length);
  return [`${stem}.ts`, `${stem}.tsx`];
}

function walk(dir, visit) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, visit);
    else visit(full);
  }
}

if (fs.existsSync("out")) {
  let removed = 0;
  walk("out", (file) => {
    const rel = path.relative("out", file);
    const sources = sourcesOf(rel);
    if (sources.some((src) => fs.existsSync(path.join("src", src)))) return;
    fs.rmSync(file);
    removed++;
  });
  console.log(`prune-stale-out: removed ${removed} stale file(s) from out/`);
}
