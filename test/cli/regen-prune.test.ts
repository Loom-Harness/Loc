// `ddd generate system` prunes what it no longer emits (M-FT.3, finding G1).
//
// The bug this pins: regeneration only ever ADDED.  Rename `operation comment`
// to `addComment` and regenerate in place, and the old `CommentHandler.cs`
// stayed on disk calling a method the aggregate no longer has — CS1061, and
// the generated project no longer builds.  Rename a page and `board.tsx`
// lingers, routed from nothing.
//
// The prune is narrow by construction (see `src/system/manifest.ts`): a file
// is deleted only when the PREVIOUS `.loom/manifest.json` listed it and the
// current run does not emit it.  This suite pins both halves — what goes, and
// the five families that must survive it:
//
//   * a hand-written file with no manifest entry,
//   * a `.loomignore`d path,
//   * a scaffold-once file the user now owns,
//   * migration files (only the newest is re-emitted each run — a naive prune
//     would delete the whole applied schema history on the second regen),
//   * `.loom/snapshots/` (the migration baselines).

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { MANIFEST_REL_PATH, parseManifest } from "../../src/system/manifest.js";

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

describe("generate system — regeneration prunes stale output", () => {
  it("deletes the files a rename orphaned, and nothing else", () => {
    const tmp = mkTmp("loom-regen-prune-");
    const dddPath = path.join(tmp, "main.ddd");
    const out = path.join(tmp, "out");

    fs.writeFileSync(dddPath, source({ operation: "comment", page: "Board" }));
    const first = runCli(["generate", "system", dddPath, "-o", out]);
    expect(first.status, first.stderr).toBe(0);

    // The manifest records the run.
    const manifestFile = path.join(out, MANIFEST_REL_PATH);
    expect(fs.existsSync(manifestFile)).toBe(true);
    const manifest = parseManifest(fs.readFileSync(manifestFile, "utf8"));
    expect(manifest).not.toBeNull();

    // The two files the rename will orphan.  Located rather than hard-coded so
    // this suite tracks the emitters' layout instead of freezing it.
    const before = listFiles(out);
    const staleHandler = before.find((p) => /CommentHandler\.cs$/.test(p));
    const stalePage = before.find((p) => /pages\/board\.tsx$/i.test(p));
    expect(staleHandler, `no CommentHandler.cs in:\n${before.join("\n")}`).toBeTruthy();
    expect(stalePage, `no board page in:\n${before.join("\n")}`).toBeTruthy();

    // Files that must survive the prune.
    //  (a) hand-written, never emitted ⇒ no manifest entry.
    const handWritten = path.join(out, "api", "NOTES.md");
    fs.writeFileSync(handWritten, "mine\n");
    //  (b) emitted but pinned by `.loomignore` — and edited.
    const pinned = "api/Dockerfile";
    fs.writeFileSync(path.join(out, ".loomignore"), `${pinned}\n`);
    fs.writeFileSync(path.join(out, pinned), "# hand-tuned\n");
    //  (c) migration files: re-emitted by every run (from the model here, it
    //      has no recorded chain), so the prune never sees them as stale.
    const migrations = before.filter((p) => /\/migrations?\//i.test(p) && !p.endsWith(".gitkeep"));
    expect(migrations.length, `no migration files in:\n${before.join("\n")}`).toBeGreaterThan(0);

    // The rename.
    fs.writeFileSync(dddPath, source({ operation: "addComment", page: "Backlog" }));
    const regen = runCli(["generate", "system", dddPath, "-o", out]);
    expect(regen.status, regen.stderr).toBe(0);

    // The orphans are gone …
    expect(fs.existsSync(path.join(out, staleHandler!))).toBe(false);
    expect(fs.existsSync(path.join(out, stalePage!))).toBe(false);
    // … the run said so …
    expect(regen.stdout).toContain(staleHandler!);
    expect(regen.stdout).toContain(stalePage!);
    expect(regen.stdout).toMatch(/removed \(stale\): \d+/);
    // … and the renamed successors took their place.
    const after = listFiles(out);
    expect(after.some((p) => /AddCommentHandler\.cs$/.test(p))).toBe(true);
    expect(after.some((p) => /pages\/backlog\.tsx$/i.test(p))).toBe(true);

    // Nothing else was touched.
    expect(fs.readFileSync(handWritten, "utf8")).toBe("mine\n");
    expect(fs.readFileSync(path.join(out, pinned), "utf8")).toBe("# hand-tuned\n");
    for (const m of migrations) {
      expect(fs.existsSync(path.join(out, m)), `pruned a migration file: ${m}`).toBe(true);
    }
  });

  it("never deletes a scaffold-once file the model stopped declaring", () => {
    const tmp = mkTmp("loom-regen-prune-once-");
    const dddPath = path.join(tmp, "main.ddd");
    const out = path.join(tmp, "out");
    const withExtern = `
system S {
  subdomain M {
    context C {
      aggregate Order {
        status: string
        operation confirm() extern { precondition status == "draft" }
      }
      repository Orders for Order { }
    }
  }
  storage pg { type: postgres }
  resource ordersState { for: C, kind: state, use: pg }
  deployable api { platform: elixir, contexts: [C], dataSources: [ordersState], port: 4000 }
}
`;
    // Same model with the `extern` operation removed — the impl file stops
    // being emitted, so it becomes a prune candidate on the manifest alone.
    const withoutExtern = withExtern.replace(
      /\s*operation confirm\(\) extern \{ precondition status == "draft" \}/,
      "",
    );

    fs.writeFileSync(dddPath, withExtern);
    expect(runCli(["generate", "system", dddPath, "-o", out]).status).toBe(0);
    const implPath = path.join(out, "api/lib/api/c/order_extern_impl.ex");
    expect(fs.existsSync(implPath)).toBe(true);

    // The user owns it now — including dropping the marker comment, which is
    // why the manifest records scaffold-once instead of re-sniffing the file.
    const userImpl = "defmodule Api.C.OrderExternImpl do\n  # mine\nend\n";
    fs.writeFileSync(implPath, userImpl);

    fs.writeFileSync(dddPath, withoutExtern);
    const regen = runCli(["generate", "system", dddPath, "-o", out]);
    expect(regen.status, regen.stderr).toBe(0);
    expect(fs.readFileSync(implPath, "utf8")).toBe(userImpl);
  });

  it("--dry-run lists the stale files and deletes none of them", () => {
    const tmp = mkTmp("loom-regen-prune-dry-");
    const dddPath = path.join(tmp, "main.ddd");
    const out = path.join(tmp, "out");

    fs.writeFileSync(dddPath, source({ operation: "comment", page: "Board" }));
    expect(runCli(["generate", "system", dddPath, "-o", out]).status).toBe(0);
    const staleHandler = listFiles(out).find((p) => /CommentHandler\.cs$/.test(p))!;
    const manifestBefore = fs.readFileSync(path.join(out, MANIFEST_REL_PATH), "utf8");

    fs.writeFileSync(dddPath, source({ operation: "addComment", page: "Backlog" }));
    const dry = runCli(["generate", "system", dddPath, "-o", out, "--dry-run"]);
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toContain(`remove (stale)      ${staleHandler}`);
    expect(dry.stdout).toMatch(/would remove \(stale\): \d+/);
    // Touched nothing — not the stale file, not the manifest.
    expect(fs.existsSync(path.join(out, staleHandler))).toBe(true);
    expect(fs.readFileSync(path.join(out, MANIFEST_REL_PATH), "utf8")).toBe(manifestBefore);
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
