// Ratchet: a runtime harness builds its database from the EMITTED migrations —
// the artifact a user's `docker compose up` applies — never from a second
// description of the schema.
//
// The defect class (#2773, #2919, #2988): the node behavioural leg — the oracle
// every wire golden is captured on — created its PGlite tables with
// `synthDDL(schema)` (web/src/runtime/ddl.ts), which walks the drizzle SCHEMA
// OBJECT.  No deployed node app ever runs that DDL: the generated `index.ts`
// applies `db/migrations/*.sql`.  The synthesised schema had no foreign keys,
// unique constraints, composite PKs or CHECKs, and read an enum column as a
// `CREATE TYPE … AS ENUM` while the migration created TEXT — so the harness
// was green on a schema nobody ships, and a broken migration was invisible to
// it (mutation-proved on the PR that added this test: a CHECK missing an enum
// member passed the old leg and fails the new one).
//
// `synthDDL` remains the PLAYGROUND's DDL source (a browser worker cannot run
// drizzle's fs-based migrator), so its users are an explicit, reasoned list.
// Any other test/script that reaches it — or a PGlite harness that boots a
// generated app without going through `emitted-schema.mjs` — fails here.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(__dirname, "..", "..");

/** Files allowed to reference `synthDDL`, each with the reason. A stale entry
 *  (the file no longer references it) fails — the list only shrinks. */
const SYNTH_DDL_ALLOWED: Record<string, string> = {
  "web/src/runtime/ddl.ts": "the definition",
  "web/src/runtime/runtime.worker.ts": "the playground's in-browser boot — its shipped path",
  "web/scripts/smoke-runtime.mjs": "smoke of the playground runtime, which is what it ships",
  "web/scripts/test-ddl.mjs": "unit test of synthDDL itself",
  "test/generator/hono/audit-schema-ddl-agreement.test.ts":
    "asserts synthDDL AGREES with the emitted migration (keeps the playground honest)",
  "test/generator/hono/provenance-schema-ddl-agreement.test.ts":
    "asserts synthDDL AGREES with the emitted migration (keeps the playground honest)",
  "src/generator/typescript/emit/schema.ts": "comment cross-reference only",
  "src/system/migrations-builder.ts": "comment cross-reference only",
  "test/behavioral/emitted-schema.mjs": "documents why it replaced synthDDL",
  "test/system/harness-schema-source.test.ts": "this ratchet",
};

const SKIP_DIRS = new Set([
  "node_modules",
  ".work",
  "out",
  "dist",
  "fixtures",
  ".git",
  "generated",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e) || e.startsWith(".work")) continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(m?[jt]s|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

const files = ["src", "test", "scripts", "web/src", "web/scripts"].flatMap((d) =>
  walk(join(REPO, d)),
);
const rel = (p: string) => relative(REPO, p).split("\\").join("/");

describe("harness schema source — the emitted migrations, not the ORM schema", () => {
  it("scans a non-trivial tree (vacuity guard)", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files.map(rel)).toContain("test/behavioral/run.mjs");
  });

  it("only the reasoned allowlist references synthDDL", () => {
    const users = files.filter((p) => readFileSync(p, "utf8").includes("synthDDL")).map(rel);
    const unexpected = users.filter((u) => !(u in SYNTH_DDL_ALLOWED));
    expect(
      unexpected,
      "build the harness DB from the emitted migrations (test/behavioral/emitted-schema.mjs)",
    ).toEqual([]);
    const stale = Object.keys(SYNTH_DDL_ALLOWED).filter((a) => !users.includes(a));
    expect(stale, "stale allowlist entry — delete it").toEqual([]);
  });

  it("every PGlite harness that boots a generated app applies the emitted migrations", () => {
    // A harness = a test/behavioral or scripts module that templates a boot
    // entry calling a generated `createApp` on PGlite.
    const harnesses = files
      .filter((p) => /^(test\/behavioral|scripts)\//.test(rel(p)))
      .filter((p) => {
        const s = readFileSync(p, "utf8");
        return s.includes("new PGlite(") && s.includes("createApp");
      });
    expect(harnesses.length, "vacuity: the four known PGlite harnesses").toBeGreaterThanOrEqual(4);
    for (const h of harnesses) {
      const s = readFileSync(h, "utf8");
      expect(s, `${rel(h)} must import emitted-schema.mjs`).toMatch(
        /from "\.\/emitted-schema\.mjs"/,
      );
      expect(s, `${rel(h)} must apply the migrations in its boot entry`).toContain(
        "${applyMigrationsStmt(",
      );
    }
  });

  it("the helper applies the folder the shipped entrypoint migrates from", () => {
    // The generated node index.ts migrates `./db/migrations`; the helper must
    // read the same folder through drizzle's own reader, not a re-implementation.
    const helper = readFileSync(join(REPO, "test/behavioral/emitted-schema.mjs"), "utf8");
    expect(helper).toContain('join(deplDir, "db", "migrations")');
    expect(helper).toContain('from "drizzle-orm/migrator"');
    const emitter = readFileSync(join(REPO, "src/platform/hono/v4/emit.ts"), "utf8");
    expect(emitter).toContain('migrationsFolder: "./db/migrations"');
  });
});
