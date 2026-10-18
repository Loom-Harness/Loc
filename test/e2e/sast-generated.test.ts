// ---------------------------------------------------------------------------
// M-T3.14 — SAST over the generated auth + tenancy code (nightly / `security`).
//
// Generates every authorization/tenancy corpus fixture (+ the leak-shape
// fixture) on every backend it targets, runs the semgrep ruleset
// `test/sast/loom-auth-tenancy.yml` over the emitted source, and asserts:
//
//   1. no FORBIDDEN-rule hit outside `TRIAGE` (a hardcoded secret, a logged
//      token, an aggregation missing the tenant floor, an EF bypass lifting
//      every filter), and no stale triage row;
//   2. every REQUIRED rule fires on every backend of every OIDC fixture (the
//      callback binds `state` to its cookie; the exchange sends the PKCE
//      verifier);
//   3. every SEED is named — each rule's historical defect is re-seeded into a
//      copy of the emitted tree and the rule must fire (forbidden) or go silent
//      (required).  This is the standing mutation proof: it re-finds the two
//      historical leaks the authz missions name (F2-ADP-1, audit A1) on every
//      run.
//
// Run: LOOM_SAST=1 npx vitest run test/e2e/sast-generated.test.ts
//      (needs `semgrep` on PATH — `pip install semgrep`; `LOOM_SEMGREP=<bin>`
//      points at another binary.)
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";
import type { Backend } from "../fixtures/corpus/backends.js";
import {
  type Finding,
  findingKey,
  isScannedSource,
  LEAK_SHAPES_ID,
  parseSemgrep,
  sastCorpusFeatures,
  sourceFor,
  type Trees,
  treeKey,
  writeTrees,
} from "../sast/harness.js";
import {
  FORBIDDEN_RULES,
  OIDC_FEATURES,
  REQUIRED_RULES,
  SEEDS,
  TRIAGE,
} from "../sast/registers.js";

const ENABLED = process.env.LOOM_SAST === "1";
const SEMGREP = process.env.LOOM_SEMGREP ?? "semgrep";
const RULES = path.resolve(import.meta.dirname, "..", "sast", "loom-auth-tenancy.yml");
const ALL_BACKENDS: readonly Backend[] = ["node", "dotnet", "java", "python", "vanilla"];

async function emit(fixture: string, backend: Backend): Promise<Map<string, string>> {
  const files = await generateSystemFiles(sourceFor(fixture, backend));
  return new Map([...files].filter(([rel]) => isScannedSource(rel)));
}

describe.runIf(ENABLED)("SAST over generated auth + tenancy code (M-T3.14)", () => {
  it("no untriaged forbidden hit, every required rule fires, every seed is named", async () => {
    // --- 1. generate ------------------------------------------------------
    const clean: Trees = new Map();
    const plan = [...sastCorpusFeatures(), { id: LEAK_SHAPES_ID, backends: ALL_BACKENDS }];
    for (const f of plan) {
      for (const b of f.backends) clean.set(treeKey(f.id, b), await emit(f.id, b));
    }
    // --- 2. seed a copy per seed -----------------------------------------
    const seeded: Trees = new Map();
    const anchorsGone: string[] = [];
    for (const s of SEEDS) {
      const tree = clean.get(treeKey(s.fixture, s.backend));
      expect(tree, `${s.id}: ${s.fixture}/${s.backend} is not in the sweep`).toBeDefined();
      const copy = new Map(tree!);
      const target = [...copy.keys()].find((k) => s.file.test(k));
      expect(target, `${s.id}: no emitted file matches ${s.file}`).toBeDefined();
      const text = copy.get(target!)!;
      // The seed must still apply: an emitter that re-spelled the line would
      // otherwise leave the "seeded" copy identical to the clean one.  Recorded,
      // not asserted here, so a CLEAN-tree finding (the defect already shipped,
      // which is also what removes the anchor) is reported first, by name.
      if (!text.includes(s.from)) {
        anchorsGone.push(`${s.id}: seed anchor gone from ${target}`);
        continue;
      }
      copy.set(target!, text.replace(s.from, s.to));
      seeded.set(`__seed__${s.id.replace("/", "~")}/${s.backend}`, copy);
    }
    // --- 3. scan both in one semgrep run ---------------------------------
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-sast-"));
    try {
      writeTrees(root, clean);
      writeTrees(root, seeded);
      const r = spawnSync(
        SEMGREP,
        [
          "scan",
          "--metrics=off",
          "--disable-version-check",
          "--quiet",
          "--json",
          "--config",
          RULES,
          ".",
        ],
        { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 1_200_000 },
      );
      expect(r.error, `could not run ${SEMGREP}: ${r.error}`).toBeUndefined();
      expect(r.stdout.length, `semgrep produced no JSON\n${r.stderr}`).toBeGreaterThan(0);
      const { findings, errors } = parseSemgrep(r.stdout, root);
      expect(errors, "semgrep reported rule / parse errors").toEqual([]);

      const onClean = findings.filter((f) => !f.tree.startsWith("__seed__"));
      const onSeed = (s: (typeof SEEDS)[number]): Finding[] =>
        findings.filter((f) => f.tree === `__seed__${s.id.replace("/", "~")}/${s.backend}`);

      // 1. forbidden hits vs the triage register (both directions).
      const forbidden = onClean.filter((f) =>
        (FORBIDDEN_RULES as readonly string[]).includes(f.rule),
      );
      const keys = forbidden.map(findingKey);
      expect(
        keys.filter((k) => !TRIAGE[k]),
        "untriaged SAST findings in the generated auth/tenancy code",
      ).toEqual([]);
      expect(
        Object.keys(TRIAGE).filter((k) => !keys.includes(k)),
        "stale triage rows — the hit is gone, delete the row",
      ).toEqual([]);

      // 2. required rules on every backend of every OIDC fixture.
      const missing: string[] = [];
      for (const feature of OIDC_FEATURES) {
        const backends = plan.find((p) => p.id === feature)?.backends ?? [];
        expect(backends.length, `${feature} fell out of the sweep`).toBeGreaterThan(0);
        for (const b of backends) {
          for (const rule of REQUIRED_RULES) {
            if (!onClean.some((f) => f.tree === treeKey(feature, b) && f.rule === rule)) {
              missing.push(`${rule} @ ${feature}/${b}`);
            }
          }
        }
      }
      expect(missing, "required auth invariants absent from the emitted code").toEqual([]);

      // 3. every seed named.
      expect(anchorsGone, "seeds whose anchor the emitter no longer produces").toEqual([]);
      const unproved: string[] = [];
      for (const s of SEEDS) {
        const hits = onSeed(s).filter((f) => f.rule === s.rule);
        const required = (REQUIRED_RULES as readonly string[]).includes(s.rule);
        if (required ? hits.length > 0 : !hits.some((f) => s.file.test(f.file))) {
          unproved.push(`${s.id} (${s.rule}) — ${s.defect}`);
        }
      }
      expect(unproved, "rules that no longer re-find their own historical defect").toEqual([]);

      // Vacuity: the sweep is the auth/tenancy population, not a sliver of it.
      expect(clean.size).toBeGreaterThan(40);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 1_800_000);
});
