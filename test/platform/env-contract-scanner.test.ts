// Contract-to-code scanner — holds each backend's env contract
// (`operations.env`) to the CODE it emits: every environment read found in a
// backend deployable's emitted (non-test) sources must be a name the contract
// declares, or an allowlisted framework / test hook.  A read the contract does
// not list is a variable compose / k8s will never be required to wire.
//
// Wiring/static-scan only: no compile or boot tier enumerates which env names
// emitted source reads, so this asserts on the emitted text.

import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { platformFor } from "../../src/platform/registry.js";
import { serviceSlug } from "../../src/util/service-slug.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { buildLoomModel } from "../_helpers/ir.js";
import { BACKENDS, PLATFORM_CLAUSE } from "../fixtures/corpus/backends.js";

const FIXTURES = [
  "api-call",
  "auth-oidc",
  "channels-broker",
  "resources",
  "factory-param-local-collision",
];

/** Reads that are defects, each naming its open issue.  A waiver ratchets:
 *  one that no longer matches a read fails the suite, so a fix deletes it. */
const WAIVERS: Record<string, string> = {};
const usedWaivers = new Set<string>();
let cellsRun = 0;

const IDENT = "[A-Z][A-Z0-9_]*";
const corpusDir = path.join(__dirname, "../fixtures/corpus");

interface Read {
  name: string;
  file: string;
  line: number;
}

function isTestPath(rel: string): boolean {
  const segs = rel.split("/");
  if (segs.slice(0, -1).some((s) => /^(test|tests|Tests)$/.test(s) || /\.Tests$/.test(s)))
    return true;
  return /\.test\.[^/]*$/.test(rel) || /_test\.[^/]*$/.test(rel);
}

function isCommentLine(line: string): boolean {
  return /^\s*(\/\/|#|\*|\/\*|--|%)/.test(line);
}

/** `a:b` → `a__b` for .NET `Configuration["a:b"]`; upper-cased check done by caller. */
function netKey(k: string): string {
  return k.replaceAll(":", "__");
}

const PATTERNS: Array<{ re: RegExp; map?: (s: string) => string }> = [
  // TS
  { re: new RegExp(`process\\.env\\.(${IDENT})\\b`, "g") },
  { re: new RegExp(`process\\.env\\[\\s*["'](${IDENT})["']\\s*\\]`, "g") },
  // C#
  { re: new RegExp(`GetEnvironmentVariable\\(\\s*"(${IDENT})"`, "g") },
  { re: /Configuration\[\s*"([A-Za-z0-9_:]+)"\s*\]/g, map: netKey },
  { re: /GetValue<[^>]+>\(\s*"([A-Za-z0-9_:]+)"/g, map: netKey },
  { re: /GetConnectionString\(\s*"([A-Za-z0-9_]+)"/g, map: (s) => `ConnectionStrings__${s}` },
  // Elixir
  { re: new RegExp(`System\\.(?:get_env|fetch_env!?)\\(\\s*"(${IDENT})"`, "g") },
  // Python
  { re: new RegExp(`os\\.environ\\[\\s*["'](${IDENT})["']\\s*\\]`, "g") },
  { re: new RegExp(`os\\.environ\\.get\\(\\s*["'](${IDENT})["']`, "g") },
  { re: new RegExp(`os\\.getenv\\(\\s*["'](${IDENT})["']`, "g") },
  // Java
  { re: new RegExp(`System\\.getenv\\(\\s*"(${IDENT})"`, "g") },
  { re: new RegExp(`System\\.getenv\\(\\)\\.(?:getOrDefault|get)\\(\\s*"(${IDENT})"`, "g") },
  // Dynamic binding-table names
  { re: /["'](LOOM_CHANNEL_[A-Z0-9_]+_URL)["']/g },
];

/** Spring `${X}` / `${X:default}` placeholders in yml / properties. */
const SPRING = new RegExp(`\\$\\{(${IDENT})(?::[^}]*)?\\}`, "g");

function scan(rel: string, text: string): Read[] {
  const out: Read[] = [];
  const spring = /(^|\/)application[^/]*\.(ya?ml|properties)$/.test(rel);
  const lines = text.split("\n");
  // Multi-line-tolerant: run on the whole text, then map offset → line.
  const lineStarts: number[] = [];
  let off = 0;
  for (const l of lines) {
    lineStarts.push(off);
    off += l.length + 1;
  }
  const lineOf = (o: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= o) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const pats = spring ? [{ re: SPRING } as (typeof PATTERNS)[number]] : PATTERNS;
  for (const { re, map } of pats) {
    for (const m of text.matchAll(re)) {
      const ln = lineOf(m.index!);
      if (isCommentLine(lines[ln]!)) continue;
      const name = map ? map(m[1]!) : m[1]!;
      if (!new RegExp(`^${IDENT}$`).test(name) && !name.startsWith("ConnectionStrings__")) continue;
      out.push({ name, file: rel, line: ln + 1 });
    }
  }
  return out;
}

describe("env contract × emitted code reads", () => {
  for (const fixture of FIXTURES) {
    for (const backend of BACKENDS) {
      it(`${fixture} on ${backend}: every env read is in the contract`, async () => {
        const src = fs
          .readFileSync(path.join(corpusDir, `${fixture}.ddd`), "utf8")
          .replaceAll("__PLATFORM__", PLATFORM_CLAUSE[backend]);
        const files = await generateSystemFiles(src, {});
        const sys = (await buildLoomModel(src)).systems[0]!;
        const offenders: string[] = [];
        let scanned = 0;
        for (const d of sys.deployables) {
          const surface = platformFor(d.platform);
          if (surface.isFrontend) continue;
          const known = new Set(surface.operations.env({ deployable: d, sys }).map((e) => e.name));
          const prefix = `${serviceSlug(d.name)}/`;
          const seen = new Set<string>();
          for (const [rel, text] of files) {
            if (!rel.startsWith(prefix) || isTestPath(rel)) continue;
            scanned++;
            for (const r of scan(rel, text)) {
              const waiver = `${backend}:${r.name}`;
              if (waiver in WAIVERS) usedWaivers.add(waiver);
              if (known.has(r.name) || waiver in WAIVERS || seen.has(r.name)) continue;
              seen.add(r.name);
              offenders.push(`${d.name}: ${r.name} (${r.file}:${r.line})`);
            }
          }
        }
        cellsRun++;
        expect(scanned).toBeGreaterThan(0);
        expect(offenders.sort()).toEqual([]);
      });
    }
  }
  afterAll(() => {
    // Only meaningful over the full matrix — a filtered run skips the check.
    if (cellsRun < FIXTURES.length * BACKENDS.length) return;
    const stale = Object.keys(WAIVERS).filter((w) => !usedWaivers.has(w));
    expect(stale, "stale waivers — the read is gone, delete the entry").toEqual([]);
  });
});
