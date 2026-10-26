import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// `ddd diff` — one test per classification rule, run through the real CLI:
// each wire rule is breaking-for-clients, each destructive-gate refusal is
// breaking-for-data, a declared rename is a rename (one wire change, a
// compatible RENAME COLUMN), and the exit code answers the gate.
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(path.resolve(here, "..", ".."), "bin", "cli.js");

function run(args: string[], cwd: string): { stdout: string; stderr: string; status: number } {
  const r = spawnSync("node", [cli, ...args], { cwd, encoding: "utf8" });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? -1 };
}

const model = (fields: string, extra = "") => `system S {
  subdomain Sales {
    context Sales {
      enum Status { New, Paid, Lost }
      aggregate Order with crudish { ${fields} }
      repository Orders for Order {}
    }
  }
  api SalesApi from Sales
  storage pg { type: postgres }
  resource st { for: Sales, kind: state, use: pg }
  deployable api { platform: node  contexts: [Sales]  dataSources: [st]  serves: SalesApi  port: 3000 }
}
${extra}`;

const BASE_FIELDS = "label: string  qty: int  amount: decimal  note: string?  status: Status";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function project(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-diff-"));
  tmpDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

interface Report {
  ok: boolean;
  breaking: boolean;
  breakingForClients: boolean;
  breakingForData: boolean;
  baseline: { kind: string };
  wireChanges: { kind: string; field?: string; class: string }[];
  migrations: { class: string; destructive: boolean; steps: { op: string; sql: string }[] }[];
}

/** `ddd diff --json` of `next` against `old` as a `--baseline` file. */
function diffJson(old: string, next: string): { status: number; report: Report } {
  const dir = project({ "old.ddd": old, "app.ddd": next });
  const r = run(["diff", "app.ddd", "--baseline", "old.ddd", "--json"], dir);
  return { status: r.status, report: JSON.parse(r.stdout) as Report };
}

// Every test spawns the CLI one to four times; on a loaded machine one spawn
// alone can take tens of seconds.
const SPAWNING = { timeout: 180_000 };

describe("ddd diff — classification rules", SPAWNING, () => {
  it("an added optional field is compatible and exits 0", () => {
    const { status, report } = diffJson(model(BASE_FIELDS), model(`${BASE_FIELDS}  memo: string?`));
    expect(report.wireChanges).toEqual([
      expect.objectContaining({
        kind: "property-added-optional",
        field: "memo",
        class: "compatible",
      }),
    ]);
    expect(report.migrations.map((m) => m.class)).toEqual(["compatible"]);
    expect(report.breaking).toBe(false);
    expect(status).toBe(0);
  });

  it("a dropped field breaks clients and data", () => {
    const { status, report } = diffJson(
      model(BASE_FIELDS),
      model(BASE_FIELDS.replace("  note: string?", "")),
    );
    expect(report.wireChanges).toContainEqual(
      expect.objectContaining({
        kind: "property-removed",
        field: "note",
        class: "breaking-for-clients",
      }),
    );
    expect(report.migrations).toEqual([
      expect.objectContaining({ class: "breaking-for-data", destructive: true }),
    ]);
    expect(report.breakingForClients).toBe(true);
    expect(report.breakingForData).toBe(true);
    expect(status).toBe(1);
  });

  it("a removed enum member breaks clients", () => {
    const { status, report } = diffJson(
      model(BASE_FIELDS),
      model(BASE_FIELDS).replace("enum Status { New, Paid, Lost }", "enum Status { New, Paid }"),
    );
    expect(report.wireChanges).toContainEqual(
      expect.objectContaining({
        kind: "property-type-changed",
        field: "status",
        class: "breaking-for-clients",
      }),
    );
    expect(report.breakingForClients).toBe(true);
    expect(status).toBe(1);
  });

  it("a narrowed carrier breaks clients and data", () => {
    const { status, report } = diffJson(
      model(BASE_FIELDS),
      model(BASE_FIELDS.replace("amount: decimal", "amount: int")),
    );
    expect(report.wireChanges).toContainEqual(
      expect.objectContaining({
        kind: "property-type-changed",
        field: "amount",
        class: "breaking-for-clients",
      }),
    );
    expect(report.migrations).toEqual([
      expect.objectContaining({ class: "breaking-for-data", destructive: true }),
    ]);
    expect(status).toBe(1);
  });

  it("optional → required breaks clients and data", () => {
    const { status, report } = diffJson(
      model(BASE_FIELDS),
      model(BASE_FIELDS.replace("note: string?", "note: string")),
    );
    expect(report.wireChanges).toContainEqual(
      expect.objectContaining({
        kind: "property-made-required",
        field: "note",
        class: "breaking-for-clients",
      }),
    );
    expect(report.migrations).toEqual([
      expect.objectContaining({ class: "breaking-for-data", destructive: true }),
    ]);
    expect(status).toBe(1);
  });

  it("a declared rename is ONE rename and compatible for data", () => {
    const { report } = diffJson(
      model(BASE_FIELDS),
      model(
        BASE_FIELDS.replace("qty: int", "quantity: int"),
        'migration "rename-qty" { Order.qty -> quantity }\n',
      ),
    );
    // Reported as the rename it is — not a dropped `qty` plus an added
    // `quantity` — and still breaking for clients: the wire name moved.
    expect(report.wireChanges).toEqual([
      expect.objectContaining({
        kind: "property-renamed",
        field: "quantity",
        class: "breaking-for-clients",
      }),
    ]);
    // The data side is a RENAME COLUMN, which the destructive gate passes.
    expect(report.migrations).toEqual([
      expect.objectContaining({ class: "compatible", destructive: false }),
    ]);
    expect(report.migrations[0]!.steps.map((s) => s.op)).toEqual(["renameColumn"]);
    expect(report.breakingForData).toBe(false);
  });

  it("prints one classified line per change and the verdict", () => {
    const dir = project({
      "old.ddd": model(BASE_FIELDS),
      "app.ddd": model(BASE_FIELDS.replace("  note: string?", "")),
    });
    const r = run(["diff", "app.ddd", "--baseline", "old.ddd"], dir);
    expect(r.stdout).toMatch(/breaking-for-clients\s+property 'note' removed from Order/);
    expect(r.stdout).toMatch(/breaking-for-data\s+module Sales: /);
    expect(r.stdout).toContain("BREAKING for clients and data.");
    expect(r.status).toBe(1);
  });
});

describe("ddd diff — baselines", SPAWNING, () => {
  it("with no flag the committed migrations/ chain is the schema baseline", () => {
    const dir = project({ "app.ddd": model(BASE_FIELDS) });
    expect(run(["migrate", "add", "initial", "app.ddd"], dir).status).toBe(0);
    expect(run(["diff", "app.ddd"], dir).status).toBe(0);

    fs.writeFileSync(path.join(dir, "app.ddd"), model(BASE_FIELDS.replace("  note: string?", "")));
    const r = run(["diff", "app.ddd", "--json"], dir);
    const report = JSON.parse(r.stdout) as Report;
    expect(report.baseline.kind).toBe("chain");
    // The chain records a schema, not a wire contract: only the data side.
    expect(report.wireChanges).toEqual([]);
    expect(report.breakingForData).toBe(true);
    expect(r.status).toBe(1);
  });

  it("with no baseline at all it refuses (exit 2) rather than answer compatible", () => {
    const dir = project({ "app.ddd": model(BASE_FIELDS) });
    const r = run(["diff", "app.ddd"], dir);
    expect(r.stderr).toContain("nothing to diff against");
    expect(r.status).toBe(2);
  });

  it("a baseline that does not load refuses (exit 2)", () => {
    const dir = project({ "old.ddd": "system {", "app.ddd": model(BASE_FIELDS) });
    const r = run(["diff", "app.ddd", "--baseline", "old.ddd"], dir);
    expect(r.stderr).toContain("does not load");
    expect(r.status).toBe(2);
  });

  it("--git <ref> diffs a multi-file project against its committed import graph", () => {
    const entry = (fields: string) =>
      model(fields).replace("system S {", 'import "./types.ddd"\nsystem S {');
    const dir = project({
      "app.ddd": entry("label: string  status: Status"),
      "types.ddd": "",
    });
    // The enum lives in the imported file, so only a baseline that follows the
    // import sees the member that was removed.
    const app = fs.readFileSync(path.join(dir, "app.ddd"), "utf8");
    fs.writeFileSync(
      path.join(dir, "app.ddd"),
      app.replace("      enum Status { New, Paid, Lost }\n", ""),
    );
    fs.writeFileSync(path.join(dir, "types.ddd"), "enum Status { New, Paid, Lost }\n");
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
        cwd: dir,
        stdio: "ignore",
      });
    git("init", "-q");
    git("add", ".");
    git("commit", "-q", "-m", "v1");
    expect(run(["diff", "app.ddd", "--git", "HEAD"], dir).status).toBe(0);

    fs.writeFileSync(path.join(dir, "types.ddd"), "enum Status { New, Paid }\n");
    const r = run(["diff", "app.ddd", "--git", "HEAD", "--json"], dir);
    const report = JSON.parse(r.stdout) as Report;
    expect(report.baseline).toEqual({ kind: "git", ref: "HEAD", path: "app.ddd" });
    expect(report.wireChanges).toContainEqual(
      expect.objectContaining({ field: "status", class: "breaking-for-clients" }),
    );
    expect(r.status).toBe(1);
  });
});
