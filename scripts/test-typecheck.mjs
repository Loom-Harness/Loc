#!/usr/bin/env node
// Shrink-only typecheck ratchet for `test/`.
//
// `tsconfig.json` excludes `test/`, and nothing else covers it: `npm run build`
// compiles `src/**`, and `biome ci .` is a linter.  So none of the ~2,000 files
// under `test/` are typechecked by any gate — which means a `Record<Union, …>`
// written in a test to prove exhaustiveness proves nothing, because no compiler
// ever reads it.  Three separate packets tripped over that independently.
//
// A bare `--noEmit` step cannot land: there are 768 errors over 219 files, so
// adding one would make every PR red.  This is the shape that CAN land — the
// same one this repo already uses for diagnostic waivers.  `tsconfig.test.json`
// is pinned, every file's CURRENT error count is recorded in
// `test-typecheck-baseline.json`, and from here the number may only go down:
//
//   - a file NOT in the baseline must have zero errors      (no new bad file)
//   - a file IN the baseline may not exceed its pinned count (no new error in
//     an already-dirty file)
//   - a file whose count DROPPED fails until the baseline is updated, and a
//     file that reaches zero must be deleted from it entirely
//
// That last direction is the half people leave out, and without it the file
// decays into a list of numbers that used to be true.  It also means a fix and
// its baseline edit land in the same commit, so the ratchet records progress
// instead of merely permitting it.
//
// Usage:  node scripts/test-typecheck.mjs [--update]
//         --update rewrites the baseline from the current state.  Use it when
//         you have FIXED errors, never to make a failure go away.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const BASELINE = "test-typecheck-baseline.json";
const PROJECT = "tsconfig.test.json";

/** file → error count, from a real `tsc -p tsconfig.test.json --noEmit`. */
function measure() {
  let output = "";
  try {
    execFileSync("npx", ["tsc", "-p", PROJECT, "--noEmit"], { encoding: "utf8" });
  } catch (err) {
    // tsc exits non-zero when it reports errors; that is the expected path.
    output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }

  const counts = {};
  const srcErrors = [];
  for (const line of output.split("\n")) {
    const test = line.match(/^(test\/[^(]+)\(\d+,\d+\): error TS\d+/);
    if (test) {
      counts[test[1]] = (counts[test[1]] ?? 0) + 1;
      continue;
    }
    if (/^src\/[^(]+\(\d+,\d+\): error TS\d+/.test(line)) srcErrors.push(line);
  }
  return { counts, srcErrors };
}

const { counts, srcErrors } = measure();

if (process.argv.includes("--update")) {
  const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(BASELINE, `${JSON.stringify(sorted, null, 2)}\n`);
  const total = Object.values(sorted).reduce((a, b) => a + b, 0);
  console.log(`baseline updated: ${Object.keys(sorted).length} files, ${total} errors`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
const failures = [];

// `src/` must stay at zero.  It is compiled by `npm run build` already, but the
// test project pulls it in under different options (module resolution, lib), so
// a regression could surface only here — and would otherwise be blamed on a
// test file.
if (srcErrors.length > 0) {
  failures.push(
    `${srcErrors.length} error(s) under src/ in the test project — src/ must stay clean:\n` +
      srcErrors
        .slice(0, 10)
        .map((l) => `    ${l}`)
        .join("\n"),
  );
}

const files = new Set([...Object.keys(counts), ...Object.keys(baseline)]);
const regressed = [];
const improved = [];
const fixed = [];

for (const file of [...files].sort()) {
  const now = counts[file] ?? 0;
  const was = baseline[file] ?? 0;
  if (now > was) regressed.push(`    ${file}: ${was} → ${now}`);
  else if (now < was && now > 0) improved.push(`    ${file}: ${was} → ${now}`);
  else if (now === 0 && was > 0) fixed.push(`    ${file}: ${was} → 0 (delete its entry)`);
}

if (regressed.length > 0) {
  failures.push(
    `${regressed.length} file(s) gained type errors.  Fix them — do NOT raise the ` +
      `baseline; it only shrinks:\n${regressed.join("\n")}`,
  );
}
if (improved.length > 0 || fixed.length > 0) {
  failures.push(
    `${improved.length + fixed.length} file(s) improved but the baseline still records ` +
      `the old count.  Run \`npm run test:typecheck -- --update\` and commit it with the ` +
      `fix, so the ratchet records the progress:\n${[...improved, ...fixed].join("\n")}`,
  );
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
if (failures.length > 0) {
  console.error(`\ntest/ typecheck ratchet FAILED\n\n${failures.join("\n\n")}\n`);
  process.exit(1);
}
console.log(
  `test/ typecheck ratchet OK — ${Object.keys(counts).length} files, ${total} errors, ` +
    `src/ clean.  The baseline only shrinks from here.`,
);
