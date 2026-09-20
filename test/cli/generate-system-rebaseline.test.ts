// `ddd generate system` into a clean output directory must not silently
// re-baseline the migration history (F-029).
//
// The unit half lives in `test/system/migration-ledger.test.ts`.  This suite
// spawns the REAL CLI, because every part of the defect that matters is
// wiring: the ledger is read from beside the `.ddd` (not from `-o`), written
// after a successful run (and never on a dry run), and the refusal has to
// reach the EXIT CODE — a CI job that keeps going on a printed error is the
// outage all over again.
//
// The walk is the one from the report: generate, add ONE optional field,
// generate into a clean directory.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cli = path.join(repoRoot, "bin", "cli.js");

const model = (extraField = ""): string => `
system Shop {
  subdomain Sales {
    context Orders {
      aggregate Order {
        total: int${extraField ? `\n        ${extraField}` : ""}
      }
      repository Orders for Order { }
    }
  }
  storage pg { type: postgres }
  resource ordersState { for: Orders, kind: state, use: pg }
  deployable api { platform: node, contexts: [Orders], dataSources: [ordersState], port: 3000 }
}
`;

function generate(
  sourceFile: string,
  outDir: string,
  ...flags: string[]
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync("node", [cli, "generate", "system", sourceFile, "-o", outDir, ...flags], {
    encoding: "utf8",
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? 1 };
}

const migrationFiles = (outDir: string): string[] => {
  const dir = path.join(outDir, "api", "db", "migrations");
  return fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".sql"))
        .sort()
    : [];
};

describe("ddd generate system — migration baseline across output directories", () => {
  let root: string;
  let sourceFile: string;
  let ledgerFile: string;
  let outA: string;
  let outB: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-cli-f029-"));
    const srcDir = path.join(root, "app");
    fs.mkdirSync(srcDir);
    sourceFile = path.join(srcDir, "main.ddd");
    ledgerFile = path.join(srcDir, ".loom", "migration-history.json");
    outA = path.join(root, "out-a");
    outB = path.join(root, "out-b");
    fs.writeFileSync(sourceFile, model());
  });

  it("a first run into an empty directory is silent, and records the history beside the source", () => {
    const { status, stderr } = generate(sourceFile, outA);
    expect(status, stderr).toBe(0);
    // Silence matters as much as the refusal: `ddd new` → first generate is
    // the most-travelled path in the toolchain.
    expect(stderr).not.toMatch(/re-baseline|refus/i);
    expect(migrationFiles(outA)).toHaveLength(1);
    expect(fs.existsSync(ledgerFile), "the source-side ledger is written").toBe(true);
    const ledger = JSON.parse(fs.readFileSync(ledgerFile, "utf8"));
    expect(Object.keys(ledger.modules)).toEqual(["Sales"]);
    expect(ledger.modules.Sales.versions).toHaveLength(1);
  });

  it("a dry run writes no ledger, and previews the delta rather than recording it", () => {
    const before = fs.readFileSync(ledgerFile, "utf8");
    fs.writeFileSync(sourceFile, model("note: string?"));
    const { status, stdout } = generate(sourceFile, outA, "--dry-run");
    expect(status).toBe(0);
    expect(stdout).toMatch(/Would write/);
    // The ledger records what was GENERATED; a dry run generated nothing, so
    // it must still describe the tree as it stands.
    expect(fs.readFileSync(ledgerFile, "utf8")).toBe(before);
    expect(migrationFiles(outA)).toHaveLength(1);
  });

  it("REFUSES the same change into a clean output directory, non-zero and writing nothing", () => {
    // The model now carries the extra field (written by the dry-run case
    // above) — this is the report's step 1, into a directory that has never
    // been generated into.
    const { status, stderr } = generate(sourceFile, outB);
    expect(status, "the refusal must fail the command, not just print").toBe(1);
    expect(stderr).toMatch(/refusing to re-baseline module 'Sales'/);
    expect(stderr).toMatch(/migration-history\.json/);
    expect(stderr).toMatch(/--allow-rebaseline/);
    expect(fs.existsSync(outB), "nothing is written when the guard refuses").toBe(false);
  });

  it("emits the correct incremental delta in place", () => {
    const { status, stderr } = generate(sourceFile, outA);
    expect(status, stderr).toBe(0);
    const files = migrationFiles(outA);
    expect(files).toHaveLength(2);
    const delta = path.join(outA, "api", "db", "migrations", files[1]!);
    expect(fs.readFileSync(delta, "utf8")).toMatch(/ADD COLUMN "note"/);
    // The already-applied migration is left exactly as it was.
    const initial = fs.readFileSync(path.join(outA, "api", "db", "migrations", files[0]!), "utf8");
    expect(initial).not.toContain('"note"');
    expect(JSON.parse(fs.readFileSync(ledgerFile, "utf8")).modules.Sales.versions).toHaveLength(2);
  });

  it("--allow-rebaseline is the way through, and re-shortens the recorded history", () => {
    const { status, stderr } = generate(sourceFile, outB, "--allow-rebaseline");
    expect(status, stderr).toBe(0);
    // A fresh single Initial for a fresh database, carrying the new column.
    const files = migrationFiles(outB);
    expect(files).toHaveLength(1);
    expect(
      fs.readFileSync(path.join(outB, "api", "db", "migrations", files[0]!), "utf8"),
    ).toContain('"note"');
    // …and the ledger now describes THAT tree, so the next delta in it is not
    // refused for re-using a version the discarded history had spent.
    expect(JSON.parse(fs.readFileSync(ledgerFile, "utf8")).modules.Sales.versions).toHaveLength(1);
    fs.writeFileSync(sourceFile, model("note: string?\n        memo: string?"));
    const next = generate(sourceFile, outB);
    expect(next.status, next.stderr).toBe(0);
    expect(migrationFiles(outB)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// The other half of the guard: an UNCHANGED model into a fresh directory is a
// reproducible build, not a re-baseline.
// ---------------------------------------------------------------------------

describe("ddd generate system — regenerating an unchanged model into a clean directory", () => {
  let root: string;
  let sourceFile: string;
  let outA: string;
  let outB: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-cli-f029-det-"));
    const srcDir = path.join(root, "app");
    fs.mkdirSync(srcDir);
    sourceFile = path.join(srcDir, "main.ddd");
    outA = path.join(root, "out-a");
    outB = path.join(root, "out-b");
    fs.writeFileSync(sourceFile, model());
    const first = generate(sourceFile, outA);
    expect(first.status, first.stderr).toBe(0);
  });

  it("is SILENT, and reproduces the first tree byte for byte", () => {
    // CI, a second environment, or a clone that never committed the output
    // tree all take this path. A presence-only guard would refuse it — and
    // then `-o` would be a one-directory lock. The Initial this run writes IS
    // the Initial the ledger records, so there is nothing to refuse.
    const { status, stderr } = generate(sourceFile, outB);
    expect(status, stderr).toBe(0);
    expect(stderr).not.toMatch(/re-baseline|refus/i);
    expect(migrationFiles(outB)).toEqual(migrationFiles(outA));
    const read = (dir: string, f: string): string =>
      fs.readFileSync(path.join(dir, "api", "db", "migrations", f), "utf8");
    for (const f of migrationFiles(outA)) expect(read(outB, f)).toBe(read(outA, f));
    expect(read(outB, "meta/_journal.json")).toBe(read(outA, "meta/_journal.json"));
  });

  it("but refuses once the model has MOVED — same tree, one field later", () => {
    // The only difference from the case above is the schema the re-issued
    // Initial would carry. That is the whole of F-029.
    fs.writeFileSync(sourceFile, model("phone: string?"));
    const outC = path.join(root, "out-c");
    const { status, stderr } = generate(sourceFile, outC);
    expect(status, "a changed model into a clean dir must fail the command").toBe(1);
    expect(stderr).toMatch(/refusing to re-baseline module 'Sales'/);
    expect(fs.existsSync(outC)).toBe(false);
  });

  it("and refuses to COLLAPSE a multi-migration history, unchanged model or not", () => {
    // In-place first, so the recorded history is Initial + delta…
    const inPlace = generate(sourceFile, outA);
    expect(inPlace.status, inPlace.stderr).toBe(0);
    expect(migrationFiles(outA)).toHaveLength(2);
    // …then the SAME model into a clean dir. The end schema matches, but one
    // Initial cannot reproduce two migrations: a database that applied only
    // the first would never receive the second, and the file that delivers it
    // is not in the tree this run would write.
    const outD = path.join(root, "out-d");
    const { status, stderr } = generate(sourceFile, outD);
    expect(status, "collapsing a two-migration history is a re-baseline").toBe(1);
    expect(stderr).toMatch(/refusing to re-baseline module 'Sales'/);
  });
});
