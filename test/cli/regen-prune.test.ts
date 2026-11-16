// Gate for D-NO-READ-BACK (docs/decisions).
// `generate system` and the files a run did not produce.
//
// Nothing records what an earlier run wrote, so the generator cannot tell a
// file the model stopped producing from a file the team added.  It therefore
// leaves every file it did not produce, counts them in one summary line, and
// deletes them only under an explicit `--prune`.  Even then it never touches a
// `.loomignore`d path, a hatch file the model calls for, a dot-entry, a build
// tool's directory, or anything outside the folders the run writes into.

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cli = path.join(repoRoot, "bin", "cli.js");

function runCli(args: string[]): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execSync(`node ${cli} ${args.join(" ")}`, {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    return { stdout, stderr: "", status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", status: e.status ?? 1 };
  }
}

/** The field-test model, reduced to the two names the "rename" moves: an
 *  operation (whose .NET handler is what broke `dotnet build`) and a page. */
function source(opts: { operation: string; page: string }): string {
  return `
system S {
  subdomain M {
    context Tracking {
      aggregate Issue {
        title: string
        note: string
        operation ${opts.operation}(text: string) {
          precondition text.length > 0
          note := text
        }
      }
      repository Issues for Issue { }
    }
  }

  api TrackingApi from M

  ui WebApp {
    api Tracking: TrackingApi
    page ${opts.page} {
      route: "/board"
      title: "Board"
      body: Stack {
        Heading { "Open issues", level: 2 }
      }
    }
  }

  storage primary { type: postgres }
  resource appState { for: Tracking, kind: state, use: primary }

  deployable api {
    platform: dotnet
    contexts: [Tracking]
    dataSources: [appState]
    serves: TrackingApi
    port: 8080
  }

  deployable webApp {
    platform: react
    targets: api
    ui: WebApp { Tracking: api }
    port: 3001
    design: mantine
  }
}
`;
}

const tmpRoots: string[] = [];
function mkTmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true });
});

/** Every file under `root`, as forward-slash paths relative to it. */
function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  walk(root);
  return out.sort();
}

describe("generate system — files the model no longer produces", () => {
  it("are left in place and counted; `--prune` deletes exactly them", () => {
    const tmp = mkTmp("regen-prune-");
    const dddPath = path.join(tmp, "main.ddd");
    const out = path.join(tmp, "out");

    fs.writeFileSync(dddPath, source({ operation: "comment", page: "Board" }));
    const first = runCli(["generate", "system", dddPath, "-o", out]);
    expect(first.status, first.stderr).toBe(0);
    // Nothing about the run is recorded in the output.
    expect(fs.existsSync(path.join(out, ".loom", "manifest.json"))).toBe(false);

    // The two files the rename will orphan.  Located rather than hard-coded so
    // this suite tracks the emitters' layout instead of freezing it.
    const before = listFiles(out);
    const staleHandler = before.find((p) => /CommentHandler\.cs$/.test(p));
    const stalePage = before.find((p) => /pages\/board\.tsx$/i.test(p));
    expect(staleHandler, `no CommentHandler.cs in:\n${before.join("\n")}`).toBeTruthy();
    expect(stalePage, `no board page in:\n${before.join("\n")}`).toBeTruthy();

    // Files `--prune` must spare:
    //  (a) emitted but pinned by `.loomignore`, then deleted from the model's
    //      reach by hand-editing — the pin wins.
    const pinned = "api/NOTES.md";
    fs.writeFileSync(path.join(out, ".loomignore"), `${pinned}\n`);
    fs.writeFileSync(path.join(out, pinned), "mine\n");
    //  (b) a dot-entry and a build tool's directory inside a generated folder.
    fs.writeFileSync(path.join(out, "api", ".env"), "SECRET=1\n");
    fs.mkdirSync(path.join(out, "webApp", "node_modules", "x"), { recursive: true });
    fs.writeFileSync(path.join(out, "webApp", "node_modules", "x", "index.js"), "\n");
    //  (c) a file at the output root (the team's own README, a licence).
    fs.writeFileSync(path.join(out, "LICENSE"), "ours\n");

    // The rename.
    fs.writeFileSync(dddPath, source({ operation: "addComment", page: "Backlog" }));
    const regen = runCli(["generate", "system", dddPath, "-o", out]);
    expect(regen.status, regen.stderr).toBe(0);
    // Left in place, and counted in one line.
    const summary =
      /^(\d+) file\(s\) not produced by the model \([\d.]+ KB\), left untouched; `--prune` deletes them\.$/m.exec(
        regen.stdout,
      );
    expect(summary, regen.stdout).not.toBeNull();
    const count = Number(summary![1]);
    expect(fs.existsSync(path.join(out, staleHandler!))).toBe(true);
    expect(fs.existsSync(path.join(out, stalePage!))).toBe(true);
    // The renamed successors are there.
    const after = listFiles(out);
    expect(after.some((p) => /AddCommentHandler\.cs$/.test(p))).toBe(true);
    expect(after.some((p) => /pages\/backlog\.tsx$/i.test(p))).toBe(true);

    // `--dry-run --prune` names them and deletes nothing.
    const dry = runCli(["generate", "system", dddPath, "-o", out, "--prune", "--dry-run"]);
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toContain(`  remove             ${staleHandler}`);
    const listed = dry.stdout.split("\n").filter((l) => l.startsWith("  remove "));
    expect(listed).toHaveLength(count);
    expect(dry.stdout).toContain(`would remove: ${count}`);
    expect(fs.existsSync(path.join(out, staleHandler!))).toBe(true);

    const pruned = runCli(["generate", "system", dddPath, "-o", out, "--prune"]);
    expect(pruned.status, pruned.stderr).toBe(0);
    expect(pruned.stdout).toContain(`  removed            ${staleHandler}`);
    expect(pruned.stdout).toContain(`  removed            ${stalePage}`);
    expect(pruned.stdout).toContain(`removed: ${count}`);
    expect(fs.existsSync(path.join(out, staleHandler!))).toBe(false);
    expect(fs.existsSync(path.join(out, stalePage!))).toBe(false);
    // Nothing else was touched.
    expect(fs.readFileSync(path.join(out, pinned), "utf8")).toBe("mine\n");
    expect(fs.existsSync(path.join(out, "api", ".env"))).toBe(true);
    expect(fs.existsSync(path.join(out, "webApp", "node_modules", "x", "index.js"))).toBe(true);
    expect(fs.readFileSync(path.join(out, "LICENSE"), "utf8")).toBe("ours\n");
    // A clean tree reports nothing.
    const clean = runCli(["generate", "system", dddPath, "-o", out]);
    expect(clean.stdout).not.toMatch(/not produced by the model/);
  });

  it("a project generated into its own root never lists the model or its sources", () => {
    const tmp = mkTmp("regen-prune-root-");
    const dddPath = path.join(tmp, "main.ddd");
    fs.writeFileSync(dddPath, source({ operation: "comment", page: "Board" }));
    expect(runCli(["migrate", "add", "initial", dddPath]).status).toBe(0);
    expect(runCli(["generate", "system", dddPath, "-o", tmp]).status).toBe(0);
    const pruned = runCli(["generate", "system", dddPath, "-o", tmp, "--prune"]);
    expect(pruned.status, pruned.stderr).toBe(0);
    expect(pruned.stdout).not.toMatch(/removed/);
    expect(fs.existsSync(dddPath)).toBe(true);
    expect(fs.readdirSync(path.join(tmp, "migrations")).length).toBeGreaterThan(0);
  });
});

describe("the output tree holds no migration state", () => {
  it("regenerates a deleted deployable subtree, migrations included", () => {
    const tmp = mkTmp("loom-regen-disposable-");
    const dddPath = path.join(tmp, "main.ddd");
    const out = path.join(tmp, "out");

    fs.writeFileSync(dddPath, source({ operation: "comment", page: "Board" }));
    expect(runCli(["migrate", "add", "initial", dddPath]).status).toBe(0);
    expect(runCli(["generate", "system", dddPath, "-o", out]).status).toBe(0);
    const before = listFiles(out).filter((p) => /\/migrations?\//i.test(p));
    expect(before.length).toBeGreaterThan(0);

    // What an operator does when regeneration would not prune: delete the
    // deployable subtree by hand.  The chain beside the source is untouched,
    // so the regenerate brings every migration file back.
    fs.rmSync(path.join(out, "api"), { recursive: true, force: true });
    const regen = runCli(["generate", "system", dddPath, "-o", out]);
    expect(regen.status, regen.stderr).toBe(0);
    expect(listFiles(out).filter((p) => /\/migrations?\//i.test(p))).toEqual(before);
  });
});
