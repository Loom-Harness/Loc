// Backends sharing one store, booted: the multi-backend harness.
//
// Every corpus fixture whose sidecar carries a `multiBackend` block is copied
// onto one database and one redis, once per backend (`topology.mjs`), and the
// GENERATED docker-compose stack boots as emitted.  Two checks run on it
// (`harness.mjs`): the shared database — every backend reads every other
// backend's writes, value objects and contained parts included, with the
// owner of the migrations rotated through every backend — and the by-id
// cache — every backend reads every other backend's entries, misses the six
// unreadable entry shapes and replays a stored etag.
//
// A member the generator refuses on a shared store, and a check with a known
// cross-backend disagreement, is a row in the fixture's sidecar
// (`multiBackend.xfail`), settled by the behavioural tier's rule: the recorded
// failure keeps the leg green, a pass or any other failure turns it red.
//
// Opt-in: LOOM_MULTI_BACKEND_E2E=1 (npm run test:multi-backend).  Needs docker.
//   LOOM_MB_MEMBERS=node,elixir   members to put on the store (default: all)
//   LOOM_MB_OWNERS=node,elixir    owners to rotate through (default: every member)
//   LOOM_E2E_CA_DIR=<dir>         *.crt a TLS-intercepting proxy needs in each image

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { settle } from "../behavioral/case-loop.mjs";
import { CORPUS } from "../fixtures/corpus/manifest.js";
import { cacheMatrix, makeStack, sharedDatabaseMatrix, waitUp } from "./harness.mjs";
import { CHECKS, expandFixture, MEMBER_KEYS, rotations } from "./topology.mjs";

const ENABLED = process.env.LOOM_MULTI_BACKEND_E2E === "1";
const CORPUS_DIR = join(process.cwd(), "test", "fixtures", "corpus");
const CLI = join(process.cwd(), "bin", "cli.js");
const PROJECT = "loommultibackend";

const listEnv = (name: string, all: readonly string[]): string[] => {
  const v = process.env[name];
  if (!v) return [...all];
  const keys = v.split(",").map((s) => s.trim());
  const unknown = keys.filter((k) => !all.includes(k));
  if (unknown.length > 0) throw new Error(`${name}: unknown ${unknown.join(", ")}`);
  return keys;
};

type Row = Parameters<typeof settle>[0];
type Observed = Parameters<typeof settle>[1];

/** Generate `source` into `<dir>/out`; the CLI's diagnostics when it refuses. */
function generate(dir: string, source: string): { ok: true } | { ok: false; message: string } {
  writeFileSync(join(dir, "sys.ddd"), source);
  try {
    execFileSync("node", [CLI, "generate", "system", "sys.ddd", "-o", "out"], {
      cwd: dir,
      stdio: "pipe",
    });
    return { ok: true };
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer };
    return { ok: false, message: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

const fixtures = CORPUS.filter((f) => f.multiBackend);

describe.skipIf(!ENABLED)("backends sharing one store", () => {
  for (const f of fixtures) {
    it(f.id, async () => {
      const source = readFileSync(join(CORPUS_DIR, `${f.id}.ddd`), "utf8");
      const xfail = (f.multiBackend?.xfail ?? {}) as Record<string, Row>;
      const members = listEnv("LOOM_MB_MEMBERS", MEMBER_KEYS);
      const verdicts: string[] = [];
      const judge = (name: string, observed: Observed): void => {
        const v = settle(xfail[name] ?? null, observed);
        const line =
          v.verdict === "ok"
            ? observed.kind === "pass"
              ? `✓ ${name}`
              : `✗ ${name}: ${observed.message ?? observed.failures?.map((x) => `\n    ${x.name}: ${x.error}`).join("")}`
            : `${v.verdict === "xfail" ? "≈" : "✗"} ${name} [${v.verdict}] ${v.detail ?? ""}`;
        verdicts.push(line);
      };

      // Which members the generator lets onto a shared store: each is
      // probed beside one other backend, and a refusal is settled against
      // the member's row.
      const joined: string[] = [];
      for (const m of members) {
        const dir = mkdtempSync(join(tmpdir(), "loom-mb-probe-"));
        try {
          const partner = m === "node" ? "python" : "node";
          const r = generate(dir, expandFixture(source, [partner, m]));
          if (r.ok) joined.push(m);
          judge(m, r.ok ? { kind: "pass" } : { kind: "error", message: r.message });
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }

      const owners = listEnv("LOOM_MB_OWNERS", joined).filter((o) => joined.includes(o));
      const failures: Record<(typeof CHECKS)[number], { name: string; error: string }[]> = {
        "shared-database": [],
        cache: [],
      };
      const timing: string[] = [];
      const cells: string[] = [];
      let cacheDone = false;
      if (joined.length >= 2) {
        for (const order of rotations(joined).filter((o) => owners.includes(o[0]))) {
          const dir = mkdtempSync(join(tmpdir(), "loom-mb-"));
          const out = join(dir, "out");
          const gen = generate(dir, expandFixture(source, order));
          if (!gen.ok) throw new Error(`generate refused owner ${order[0]}:\n${gen.message}`);
          const stack = makeStack({ project: PROJECT, out, members: order });
          try {
            const t0 = Date.now();
            const built = stack.build();
            const t1 = Date.now();
            stack.down();
            stack.up();
            try {
              await waitUp(stack, order, 420_000);
            } catch (e) {
              console.error(stack.diagnostics());
              throw e;
            }
            const t2 = Date.now();
            if (!cacheDone) {
              const c = await cacheMatrix(stack, order);
              failures.cache.push(...c.failures);
              cells.push(`cache: ${c.cells} cells, ${c.failures.length} failing`);
              cacheDone = true;
            }
            const db = await sharedDatabaseMatrix(stack, order, order[0]);
            failures["shared-database"].push(...db.failures);
            cells.push(
              `shared database, owner ${order[0]}: ${db.cells} cells, ${db.failures.length} failing`,
            );
            timing.push(
              `owner ${order[0]}: build ${Math.round((t1 - t0) / 1000)}s ${JSON.stringify(built)}, boot ${Math.round((t2 - t1) / 1000)}s, checks ${Math.round((Date.now() - t2) / 1000)}s`,
            );
          } finally {
            stack.down();
            rmSync(dir, { recursive: true, force: true });
          }
        }
      }
      for (const check of CHECKS) {
        if (check === "cache" && !cacheDone) continue;
        const fs = failures[check];
        judge(check, fs.length === 0 ? { kind: "pass" } : { kind: "fail", failures: fs });
      }

      // The suite's config keeps a passing test's console quiet, so the
      // matrix goes to a file a run can be read back from as well.
      const report = [
        `multi-backend ${f.id} — members ${joined.join(", ")}; owners ${owners.join(", ")}`,
        ...cells,
        ...timing,
        ...verdicts,
      ].join("\n");
      const reportDir = process.env.LOOM_MB_REPORT_DIR ?? tmpdir();
      writeFileSync(join(reportDir, `multi-backend-${f.id}.txt`), `${report}\n`);
      process.stderr.write(`${report}\n`);
      expect(verdicts.filter((l) => l.startsWith("✗"))).toEqual([]);
    }, 14_400_000);
  }
});
