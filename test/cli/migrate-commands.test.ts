import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// `ddd migrate status` / `remove` / `rebase` over a real `migrations/`
// directory — including the two-branch merge `rebase` exists for.
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(path.resolve(here, "..", ".."), "bin", "cli.js");

function runCli(args: string[], cwd: string): { out: string; status: number } {
  try {
    const out = execSync(`node ${cli} ${args.join(" ")}`, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    return { out, status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { out: (e.stdout ?? "") + (e.stderr ?? ""), status: e.status ?? 1 };
  }
}

const model = (fields: string) => `system S {
  subdomain Sales {
    context Sales {
      aggregate Order with crudish { ${fields} }
      repository Orders for Order {}
    }
  }
  api SalesApi from Sales
  storage pg { type: postgres }
  resource st { for: Sales, kind: state, use: pg }
  deployable api { platform: node  contexts: [Sales]  dataSources: [st]  serves: SalesApi  port: 3000 }
}
`;

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function project(fields: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-migrate-"));
  tmpDirs.push(dir);
  fs.writeFileSync(path.join(dir, "app.ddd"), model(fields));
  return dir;
}
const chainFiles = (dir: string) => fs.readdirSync(path.join(dir, "migrations")).sort();

describe("ddd migrate status", () => {
  it("names each module's head and its unrecorded steps", () => {
    const dir = project("label: string");
    expect(runCli(["migrate", "status", "app.ddd"], dir).out).toContain("No migrations/ yet");
    expect(runCli(["migrate", "add", "initial", "app.ddd"], dir).status).toBe(0);
    expect(runCli(["migrate", "status", "app.ddd"], dir).out).toMatch(
      /Sales\s+up to date at \d+ Initial/,
    );

    fs.writeFileSync(path.join(dir, "app.ddd"), model("label: string  note: string?"));
    const status = runCli(["migrate", "status", "--json", "app.ddd"], dir);
    expect(status.status).toBe(0);
    const json = JSON.parse(status.out.slice(status.out.indexOf("{")));
    expect(json.modules).toEqual([
      { module: "Sales", head: { version: json.head, name: "Initial" }, unrecordedSteps: 1 },
    ]);
  });
});

describe("ddd migrate remove", () => {
  it("deletes the head entry, so the next add diffs against the one before", () => {
    const dir = project("label: string");
    runCli(["migrate", "add", "initial", "app.ddd"], dir);
    fs.writeFileSync(path.join(dir, "app.ddd"), model("label: string  note: string?"));
    runCli(["migrate", "add", "add-note", "app.ddd"], dir);
    expect(chainFiles(dir)).toHaveLength(2);

    const removed = runCli(["migrate", "remove", "app.ddd"], dir);
    expect(removed.status).toBe(0);
    expect(removed.out).toMatch(/removed\s+migrations\/\d+_sales_add_note\.json/);
    expect(chainFiles(dir)).toHaveLength(1);
    expect(runCli(["migrate", "status", "app.ddd"], dir).out).toContain("1 unrecorded step(s)");
  });

  it("refuses when nothing is recorded", () => {
    const dir = project("label: string");
    expect(runCli(["migrate", "remove", "app.ddd"], dir).status).not.toBe(0);
  });
});

describe("ddd migrate rebase", () => {
  it("re-records one branch's migration on top of the other's after a merge", () => {
    // main records the Initial; branch A adds `note`, branch B adds `code`.
    const main = project("label: string");
    runCli(["migrate", "add", "initial", "app.ddd"], main);
    const branchB = project("label: string");
    fs.cpSync(path.join(main, "migrations"), path.join(branchB, "migrations"), { recursive: true });

    fs.writeFileSync(path.join(main, "app.ddd"), model("label: string  note: string?"));
    expect(runCli(["migrate", "add", "add-note", "app.ddd"], main).status).toBe(0);
    fs.writeFileSync(path.join(branchB, "app.ddd"), model("label: string  code: string?"));
    expect(runCli(["migrate", "add", "add-code", "app.ddd"], branchB).status).toBe(0);

    // The merge: both migrations, both fields.
    for (const f of chainFiles(branchB)) {
      fs.copyFileSync(path.join(branchB, "migrations", f), path.join(main, "migrations", f));
    }
    fs.writeFileSync(
      path.join(main, "app.ddd"),
      model("label: string  note: string?  code: string?"),
    );
    expect(chainFiles(main)).toHaveLength(3);
    const refused = runCli(["generate", "system", "app.ddd", "-o", "out"], main);
    expect(refused.status).not.toBe(0);
    expect(refused.out).toContain("two heads");

    const rebased = runCli(["migrate", "rebase", "app.ddd"], main);
    expect(rebased.status, rebased.out).toBe(0);
    expect(chainFiles(main)).toHaveLength(3);

    // One list again, every change recorded, and generate renders it.
    expect(runCli(["migrate", "status", "app.ddd"], main).out).toMatch(/up to date/);
    expect(runCli(["generate", "system", "app.ddd", "-o", "out"], main).status).toBe(0);
    const sql = fs
      .readdirSync(path.join(main, "out", "api", "db", "migrations"))
      .filter((f) => f.endsWith(".sql"));
    expect(sql).toHaveLength(3);
  });

  it("does nothing on a chain with one head", () => {
    const dir = project("label: string");
    runCli(["migrate", "add", "initial", "app.ddd"], dir);
    const r = runCli(["migrate", "rebase", "app.ddd"], dir);
    expect(r.status).toBe(0);
    expect(r.out).toContain("nothing to rebase");
  });
});
