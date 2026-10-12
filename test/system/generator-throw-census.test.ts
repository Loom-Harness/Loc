import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  codeOfMessageKey,
  DIAGNOSTIC_MESSAGES,
  type DiagnosticMessageKey,
} from "../../src/diagnostics/messages.js";
import { CLASSIFICATIONS, type ThrowClassification } from "./generator-throw-census.manifest.js";
import { computeThrowSites, repoRoot, type ThrowSite } from "./generator-throw-sites.js";

// ---------------------------------------------------------------------------
// The generator THROW census: the "validated clean, then `generate` crashed"
// class.
//
// The September 2026 bugfix analysis (252 merged PRs) found that about 25
// fixes shared one cause: the pipeline FAILS OPEN. `ddd parse` accepts a model,
// and then an emitter either crashes on it (24 PRs: #2871, #2947, #2896,
// #2860, #2913, #2915, #2916, #2927, #3084, ...) or silently drops a
// construct. Every `throw new Error(…)` under `src/generator/**` and
// `src/platform/**` is a place the first half can happen. Each one is a
// promise that some earlier phase keeps valid input away from it, and until
// now nobody wrote that promise down.
//
// This census writes it down. Every site carries ONE typed claim in
// `generator-throw-census.manifest.ts`:
//
//   { guardedBy: ["loom.x", …], note? }
//       A named `loom.*` diagnostic rejects every model that would reach the
//       throw. The census checks that each code is in the catalog AND is
//       raised by a pre-codegen phase (macro / AST validator / IR validator /
//       api), so a guard can't name a code that only the emitter spells.
//       A throw whose message is rendered from `diagMessage("loom.x#…")` is
//       auto-classified as guarded by `loom.x`, since it's that diagnostic's
//       emitter-side twin. It still has to pass the raised-upstream check.
//
//   { invariant: "<reason>" }
//       Valid IR can't reach it for a structural reason that isn't a
//       diagnostic: enrichment always derives the thing, the lowerer never
//       builds the shape, a target shim the engine never calls, a bad argument
//       from our own code, or a shipped pack asset that failed to load. The
//       reason names what guarantees that.
//
//   { deferred: "<what valid input reaches it>", mission: "M-…", reviewUntil }
//       A LIVE DEFECT: a model `ddd parse` accepts crashes here. It has to
//       name the mission that owns it (in docs/new-plan/) and a review date.
//       Like the ir-walk census, a deferral EXPIRES: a past date, or one
//       parked more than MAX_DEFERRAL_DAYS out, fails the census.
//
// RATCHET (CLAUDE.md "Mutation-prove a new gate"): a site without a claim
// fails, and so does a claim whose site is gone. Fixing a deferred site means
// either adding the guard (and re-classifying it `guardedBy`) or making the
// emitter render it (and the throw goes away).
//
// The DETECTOR is syntactic (`throw new Error(...)` statements, read with the
// TypeScript parser): see `generator-throw-sites.ts`. A coded refusal class
// (`QueryEmissionRefusal`, thrown by `refuseOutOfVocabulary`) is not counted.
// It already carries a `loom.*` code, which is the shape this census pushes
// sites toward.
// ---------------------------------------------------------------------------

const MAX_DEFERRAL_DAYS = 180;

/** The pre-codegen phases a guarding diagnostic must be raised from. */
const UPSTREAM_ROOTS = ["src/macros", "src/language", "src/ir", "src/api", "src/system"];

function listFiles(dir: string, out: string[]): void {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "generated") continue;
      listFiles(p, out);
    } else if (ent.name.endsWith(".ts")) out.push(p);
  }
}

let upstreamText: string | null = null;
/** Concatenated source of every upstream file. A code counts as "raised
 *  upstream" when its bare code, or one of its `#slug` keys, appears there as
 *  a string literal. */
function upstreamSource(): string {
  if (upstreamText !== null) return upstreamText;
  const files: string[] = [];
  for (const r of UPSTREAM_ROOTS) listFiles(path.join(repoRoot, r), files);
  upstreamText = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  return upstreamText;
}

const CATALOG_CODES = new Set(
  (Object.keys(DIAGNOSTIC_MESSAGES) as DiagnosticMessageKey[]).map((k) => codeOfMessageKey(k)),
);

function raisedUpstream(code: string): boolean {
  const src = upstreamSource();
  return src.includes(`"${code}"`) || src.includes(`"${code}#`) || src.includes(`'${code}'`);
}

/** The claim in force for a site: the manifest's, else the automatic
 *  `guardedBy` a `diagMessage`-rendered throw earns. */
function claimFor(site: ThrowSite): ThrowClassification | undefined {
  const explicit = CLASSIFICATIONS[site.id];
  if (explicit) return explicit;
  if (site.diagCodes.length > 0) return { guardedBy: site.diagCodes };
  return undefined;
}

function loc(site: ThrowSite): string {
  return `${site.file}:${site.line} (${site.id})`;
}

describe("generator throw census — every codegen crash site names what keeps valid input off it", () => {
  const sites = computeThrowSites();
  const byId = new Map(sites.map((s) => [s.id, s]));

  it("finds a substantial surface, not an empty one", () => {
    // A detector that silently stopped matching would pass every other test.
    expect(sites.length).toBeGreaterThan(200);
  });

  it("every throw site carries a claim", () => {
    const missing = sites.filter((s) => !claimFor(s)).map(loc);
    expect(
      missing,
      "Unclassified `throw new Error(…)` in a generator. Prefer a `loom.*` validator diagnostic that " +
        "refuses the input up front, then add `{ guardedBy: [code] }` to generator-throw-census.manifest.ts. " +
        "If valid IR genuinely can't reach it, add `{ invariant: reason }`.",
    ).toEqual([]);
  });

  it("claims ratchet — every manifest entry names a live site", () => {
    const stale = Object.keys(CLASSIFICATIONS).filter((id) => !byId.has(id));
    expect(stale, "Manifest entries whose throw no longer exists. Delete them.").toEqual([]);
  });

  it("a manifest entry never restates the automatic diagMessage guard", () => {
    const redundant = Object.entries(CLASSIFICATIONS)
      .filter(([id, c]) => {
        const s = byId.get(id);
        return (
          s &&
          s.diagCodes.length > 0 &&
          "guardedBy" in c &&
          c.note === undefined &&
          [...c.guardedBy].sort().join() === [...s.diagCodes].sort().join()
        );
      })
      .map(([id]) => id);
    expect(redundant).toEqual([]);
  });

  it("every guarding code is catalogued and raised before codegen", () => {
    const bad: string[] = [];
    for (const s of sites) {
      const c = claimFor(s);
      if (!c || !("guardedBy" in c)) continue;
      if (c.guardedBy.length === 0) bad.push(`${loc(s)}: empty guardedBy`);
      for (const code of c.guardedBy) {
        if (!CATALOG_CODES.has(code))
          bad.push(`${loc(s)}: '${code}' is not in src/diagnostics/messages.ts`);
        else if (!raisedUpstream(code)) {
          bad.push(`${loc(s)}: '${code}' is never raised by a macro / AST / IR validator`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("an invariant states its reason", () => {
    const thin = Object.entries(CLASSIFICATIONS)
      .filter(([, c]) => "invariant" in c && c.invariant.trim().length < 20)
      .map(([id]) => id);
    expect(thin).toEqual([]);
  });

  it("a deferred site is a live defect with an owner and an expiry", () => {
    const now = Date.now();
    const plan = fs
      .readdirSync(path.join(repoRoot, "docs/new-plan"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => fs.readFileSync(path.join(repoRoot, "docs/new-plan", f), "utf8"))
      .join("\n");
    const bad: string[] = [];
    for (const [id, c] of Object.entries(CLASSIFICATIONS)) {
      if (!("deferred" in c)) continue;
      const due = Date.parse(`${c.reviewUntil}T00:00:00Z`);
      if (Number.isNaN(due)) bad.push(`${id}: unparseable reviewUntil '${c.reviewUntil}'`);
      else if (due < now)
        bad.push(`${id}: reviewUntil ${c.reviewUntil} has passed — fix it or re-justify`);
      else if (due - now > MAX_DEFERRAL_DAYS * 86_400_000) {
        bad.push(`${id}: reviewUntil ${c.reviewUntil} is more than ${MAX_DEFERRAL_DAYS} days out`);
      }
      if (!/^M-[A-Z0-9]+\.\d+$/.test(c.mission))
        bad.push(`${id}: mission '${c.mission}' is not an M-… id`);
      else if (!plan.includes(c.mission))
        bad.push(`${id}: mission ${c.mission} is not in docs/new-plan/`);
    }
    expect(bad).toEqual([]);
  });
});
