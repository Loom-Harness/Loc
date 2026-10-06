// The authorization censuses' shared POPULATION — every `.ddd` the repo
// ships a runtime or compile claim about: the corpus fixtures, the shared
// behavioural systems, the examples, and the booted `broad/` tier.
//
// Extracted from `authz-gate-census.test.ts` (M-T9.28 slice 2) so the
// EMITTED-source census (`authz-emitted-census.test.ts`, M-T9.41) reads the
// same population rather than minting a second one: the IR census asks which
// gates each source DERIVES, the emitted census asks whether each backend
// APPLIES them, and the two answering over different source sets is how two
// censuses start disagreeing about the same fixture.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { corpusSource } from "../fixtures/corpus/harness.js";
import { CORPUS } from "../fixtures/corpus/manifest.js";
import { E2E_LESS_CORPUS_FIXTURES } from "./api-caller-census-pins.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// ---------------------------------------------------------------------------
// Population — the corpus, the shared behavioural systems, and the examples.
// ---------------------------------------------------------------------------

export interface CensusCase {
  /** Stable key, also the `AUTHZ_GATE_PINS` key. */
  readonly key: string;
  /** Repo-relative `.ddd` path, quoted in the failure remedy. */
  readonly file: string;
  readonly source: string;
  /** Case name the behavioural runners key `AUTHZ_LADDERS` by — `null` when no
   *  runner boots this source, so no ladder is expressible. */
  readonly ladderKey: string | null;
  /** An HONEST EXEMPTION: a corpus fixture already on
   *  `E2E_LESS_CORPUS_FIXTURES`.  It carries no `test e2e` block at all, so it
   *  has no runtime caller of ANY kind and cannot have a refused one — that
   *  whole-fixture gap is recorded ONCE in that register (M-T9.13 / W3.3 own
   *  the drain) instead of being restated as one pin per gated surface here,
   *  which is what "reuse the honest-exemption list" means.  Its surfaces are
   *  still counted, so the census total stays honest. */
  readonly exempt: boolean;
  /** The source still carrying its `__PLATFORM__` token — the corpus fixtures
   *  and the shared behavioural systems, which specialise to ANY backend — or
   *  `null` for a source with a fixed platform (the examples, the `broad/`
   *  tier).  The emitted-source census (`authz-emitted-census.test.ts`)
   *  generates exactly these, once per backend. */
  readonly tokenized: string | null;
}

const asNode = (src: string): string => src.replaceAll("__PLATFORM__", "node");

export function loadPopulation(): CensusCase[] {
  const cases: CensusCase[] = [];

  for (const feature of CORPUS) {
    cases.push({
      key: `corpus/${feature.id}`,
      file: `test/fixtures/corpus/${feature.id}.ddd`,
      source: asNode(corpusSource(feature.id)),
      tokenized: corpusSource(feature.id),
      ladderKey: E2E_LESS_CORPUS_FIXTURES.includes(feature.id) ? null : feature.id,
      exempt: E2E_LESS_CORPUS_FIXTURES.includes(feature.id),
    });
  }

  const systemsDir = path.join(REPO, "test/behavioral/systems");
  for (const f of fs
    .readdirSync(systemsDir)
    .filter((n) => n.endsWith(".ddd"))
    .sort()) {
    const name = f.replace(/\.ddd$/, "");
    cases.push({
      key: `systems/${name}`,
      file: `test/behavioral/systems/${f}`,
      source: asNode(fs.readFileSync(path.join(systemsDir, f), "utf8")),
      tokenized: fs.readFileSync(path.join(systemsDir, f), "utf8"),
      ladderKey: name,
      exempt: false,
    });
  }

  // `examples/` — the packet's "and `examples/`" half.  Nothing boots these, so
  // every gate they carry is an `R.notABehaviouralCase` pin rather than a hole;
  // they are censused anyway because an ungated authorization surface in the
  // repo's own showcase is exactly what a reader copies.
  for (const f of fs
    .readdirSync(path.join(REPO, "examples"))
    .filter((n) => n.endsWith(".ddd"))
    .sort()) {
    cases.push({
      key: `examples/${f.replace(/\.ddd$/, "")}`,
      file: `examples/${f}`,
      source: asNode(fs.readFileSync(path.join(REPO, "examples", f), "utf8")),
      tokenized: null,
      ladderKey: null,
      exempt: false,
    });
  }

  // The `broad/` tier — the corpus.json entries the behavioural runners BOOT,
  // which live under `web/src/examples/`.  Only these, not the whole directory:
  // it also holds multi-file FRAGMENTS (`multifile-main`, `multifile-landing`,
  // `fulfillment-newest`) that resolve only as a set and cannot be lowered
  // one file at a time, so censusing the directory wholesale would report a
  // parse failure that is not a defect.  (One real authorization surface sits
  // outside the census because of that: `web/src/examples/auth-capabilities.ddd`
  // carries two `requires` gates and no runner boots it — handed off, see the
  // pins file.)
  for (const c of (
    JSON.parse(fs.readFileSync(path.join(REPO, "test/behavioral/corpus.json"), "utf8")) as {
      cases: { name: string; ddd: string; api?: boolean; unit?: boolean }[];
    }
  ).cases) {
    if (!c.api && !c.unit) continue;
    cases.push({
      key: `broad/${c.name}`,
      file: c.ddd,
      source: asNode(fs.readFileSync(path.join(REPO, c.ddd), "utf8")),
      tokenized: null,
      ladderKey: c.name,
      exempt: false,
    });
  }

  return cases;
}
