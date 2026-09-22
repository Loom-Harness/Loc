// ---------------------------------------------------------------------------
// The seeder-contract DENOMINATOR (Wave C4 packet 4a).
//
// `src/generator/_persistence/seed-datasets.ts` is the shared seeder model
// (M-T6.52, Wave 2 packet 2.5): it decides ONCE what the seeder knows about an
// aggregate — its persistence kind and its ORDERED create parameters — so five
// backends cannot each re-derive it and disagree. Three of them did, and the
// disagreements were a CS1739, a javac arity error and a silently dropped row.
//
// `test/generator/_persistence/seed-model-census.test.ts` is the reader
// census: four source-text checks per reader, over a HARD-CODED list of five
// paths. That asserts its numerator and not its DENOMINATOR — the class
// M-T9.62 names, and the reason #2843 existed. A SIXTH seeding emitter (a new
// backend, a versioned backend package under `src/platform/**`) would read
// nothing, re-derive the create shape, and the census would stay green because
// its list never grew.
//
// This scan is the denominator half, and only that half: it DISCOVERS every
// seeding emitter by construction and fails when one is not covered by the
// census. The per-reader checks stay where they are.
//
// Discovery is deliberately WIDER than "imports the contract" — a bypassing
// emitter is exactly the one that does not import it — so it also catches a
// file by name and by the seed-specific vocabulary it would have to use.
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

/** Where an emitter could live: the per-platform generators and the versioned
 *  backend packages (hono v4/v5 live under `src/platform/`, not
 *  `src/generator/`). */
const SCAN_ROOTS = ["src/generator", "src/platform"] as const;

/** The shared model itself — the thing the readers read. */
const CONTRACT = "src/generator/_persistence/seed-datasets.ts";

/** The reader census whose list this scan is the denominator of. */
const CENSUS = "test/generator/_persistence/seed-model-census.test.ts";

function collectTsFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectTsFiles(full, out);
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
}

/** Vocabulary only a seed-DATASET emitter uses — the contract's own exports.
 *  A file that carries one of these either reads the contract or carries a
 *  LOCAL copy of it under the same names, which is exactly how java's
 *  byte-for-byte `groupByDataset` duplicate surfaced.
 *
 *  Deliberately NOT a marker: `__loom_seed`, the ship-once marker TABLE. Seven
 *  boot/migration wiring files name it (`dotnet/emit/program.ts`,
 *  `elixir/vanilla/shell-emit.ts`, `typescript/emit/routes.ts`, …) because
 *  they CALL the emitted seeder; none of them derives a create shape. */
const SEEDING_MARKERS = ["seed-datasets.js", "groupByDataset", "usedAggregates", "seederAggregate"];

/** Files whose name says "seed" but whose subject is not a seed DATASET.
 *  Listed rather than pattern-excluded so a new one is a decision. */
const NOT_A_DATASET_EMITTER: ReadonlySet<string> = new Set([
  // A `field: T = <expr>` form DEFAULT rendered into a frontend form — the
  // other sense of "seed" entirely.
  "src/generator/_frontend/default-seed.ts",
]);

/** Discovery runs on two signals so that an emitter which BYPASSES the
 *  contract is still found: the contract vocabulary, and the file name. An
 *  emitter that neither imports the contract nor is named for its subject is
 *  outside what a source scan can see — the reader census's per-file checks
 *  are the second line. */
function discoverSeedEmitters(): string[] {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) collectTsFiles(join(REPO_ROOT, root), files);
  const found: string[] = [];
  for (const file of files) {
    const rel = relative(REPO_ROOT, file).replaceAll("\\", "/");
    if (rel === CONTRACT || NOT_A_DATASET_EMITTER.has(rel)) continue;
    const src = readFileSync(file, "utf8");
    const base = rel.slice(rel.lastIndexOf("/") + 1).replace(/\.ts$/, "");
    const byName = /(^|[-.])seed([-.]|$)/.test(base);
    const byMarker = SEEDING_MARKERS.some((m) => src.includes(m));
    if (byName || byMarker) found.push(rel);
  }
  return found.sort();
}

/** The five readers the contract has, as of the merged C4 base. This list is
 *  not a waiver: it is the denominator the census must cover, and a new entry
 *  here is only legitimate once the census covers it too (asserted below). */
const KNOWN_SEED_EMITTERS = [
  "src/generator/dotnet/emit/seed.ts",
  "src/generator/elixir/vanilla/seed-emit.ts",
  "src/generator/java/emit/seed.ts",
  "src/generator/python/emit/seed.ts",
  "src/generator/typescript/emit/seed.ts",
] as const;

/** Re-deriving the create shape instead of reading it off the contract is what
 *  M-T6.52 fixed; importing either of these into a seeding emitter is the
 *  shape of that regression. */
const BYPASS_IMPORTS = ["forCreateInput", "createInputFields"] as const;

describe("seeder-contract denominator", () => {
  const discovered = discoverSeedEmitters();

  it("discovers every seeding emitter — the list is complete, not hard-coded", () => {
    expect(
      discovered,
      "a file emits seed datasets that no reader census covers. Add it to `test/generator/_persistence/seed-model-census.test.ts` AND to this list, or stop it emitting seeds",
    ).toEqual([...KNOWN_SEED_EMITTERS]);
  });

  it("the reader census names every discovered emitter", () => {
    const census = readFileSync(join(REPO_ROOT, CENSUS), "utf8");
    const uncovered = discovered.filter((f) => !census.includes(f));
    expect(
      uncovered,
      `${CENSUS} does not name these seeding emitters, so its four per-reader checks never run on them`,
    ).toEqual([]);
  });

  it("every discovered emitter reads the shared seeder model", () => {
    const missing = discovered.filter(
      (f) => !readFileSync(join(REPO_ROOT, f), "utf8").includes("seederAggregate"),
    );
    expect(
      missing,
      "a seeding emitter that never calls `seederAggregate(s)` derives the create shape itself — the M-T6.52 root cause (an event-sourced aggregate's create params are the create ACTION's, not `createInputFields`)",
    ).toEqual([]);
  });

  it("no discovered emitter imports the create-shape derivation directly", () => {
    const offenders: string[] = [];
    for (const f of discovered) {
      const src = readFileSync(join(REPO_ROOT, f), "utf8");
      for (const line of src.split("\n")) {
        // An import LINE only — the name appearing in a comment is how the
        // emitters record what they used to do.
        if (!/^\s*(import|\s+)/.test(line)) continue;
        if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) continue;
        for (const name of BYPASS_IMPORTS) {
          if (new RegExp(`^\\s*${name},?\\s*$`).test(line) || line.includes(`{ ${name} }`)) {
            offenders.push(`${f}: ${line.trim()}`);
          }
        }
      }
    }
    expect(
      offenders,
      "a seeding emitter imports `forCreateInput`/`createInputFields` — the derivation the shared seeder model exists to own",
    ).toEqual([]);
  });
});
