// The regeneration replay: `generate system --merge` / `--check` driven
// through the real CLI and real git, in a scratch repository per backend.
//
// Each backend replays the same story, and every assertion is about what git
// and the CLI did — exit codes, which files conflicted, what a file holds
// after the merge — never about emitted text:
//
//   1. first generation merges; `--check` passes
//   2. the user implements a hook and edits a generated file the next model
//      change also touches; a second `extern` hook is added to the model:
//      `--check` fails, `--merge` is clean, both edits survive, the new hook's
//      stub is in the user's hatch file, `--check` passes
//   3. a `.loomignore`d file keeps the branch's version through the merge
//   4. a removed construct's untouched generated files are deleted by the merge
//   5. renaming a hook → exactly one conflict, in the hatch file
//   6. re-signing a hook → the outcome the backend's hook shape gives (below)
//   7. two branches that each changed the model and regenerated merge cleanly,
//      and one more `--merge` joins the two generated lines
//   8. an uncommitted model is refused

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../bin/cli.js");

/** How many scenarios `replay` runs. */
export const SCENARIOS = 8;

export type Platform = "node" | "dotnet" | "java" | "python" | "elixir";

/** What re-signing a hook (`confirm()` → `confirm(note: string)`) does at
 *  merge time.  `conflict`: the stub's signature line sits next to the user's
 *  body, so the merge stops with one hunk in the hatch file.  `clean`: the
 *  merge takes the new signature and keeps the user's body (.NET's braced
 *  stub puts a line between them).  `unchanged`: the hook's signature does
 *  not carry the parameters (Elixir hooks take the request as a map), so the
 *  stub — and the user's file — do not change. */
const RESIGN: Record<Platform, "conflict" | "clean" | "unchanged"> = {
  node: "conflict",
  dotnet: "clean",
  java: "conflict",
  python: "conflict",
  elixir: "unchanged",
};

interface Variant {
  /** Extra members of `Order`, before its fields. */
  top?: string;
  /** `Order`'s extern operations. */
  ops?: string;
  /** Extra declarations in the context. */
  ctx?: string;
  /** Drop the extern query handler and its route. */
  noQuote?: boolean;
}

const CONFIRM = 'operation confirm() extern { precondition status == "draft" }';
const FLAG = "operation flag(score: int) extern { precondition score >= 0 }";

function model(platform: Platform, v: Variant = {}): string {
  return `system S {
  subdomain M {
    context C {
      aggregate Order with crudish {
        ${v.top ?? ""}
        status: string
        note: string
        ${v.ops ?? CONFIRM}
      }
      repository Orders for Order { }
      ${v.noQuote ? "" : "extern queryHandler GetQuote(sku: string): string;"}
      ${v.ctx ?? ""}
    }
  }
  api CApi from M {
    ${v.noQuote ? "" : 'route GET "/quotes/{sku}" -> C.GetQuote'}
  }
  storage pg { type: postgres }
  resource ordersState { for: C, kind: state, use: pg }
  deployable api {
    platform: ${platform}
    contexts: [C]
    dataSources: [ordersState]
    serves: CApi
    port: 4000
  }
}
`;
}

interface Run {
  status: number;
  /** stdout + stderr, for failure messages. */
  out: string;
  stdout: string;
}

/** Replays every scenario on `platform`; returns the names of those that ran. */
export function replay(platform: Platform): string[] {
  const ran: string[] = [];
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), `regen-replay-${platform}-`));
  const sh = (cmd: string, args: string[]): Run => {
    const r = spawnSync(cmd, args, { cwd: repo, encoding: "utf8" });
    return { status: r.status ?? 1, out: `${r.stdout}${r.stderr}`, stdout: r.stdout };
  };
  const git = (...args: string[]): string => {
    const r = sh("git", args);
    expect(r.status, `git ${args.join(" ")}: ${r.out}`).toBe(0);
    return r.out.trim();
  };
  /** A file's bytes at a revision (untrimmed, unlike `git`). */
  const show = (rev: string, p: string): string => {
    const r = sh("git", ["show", `${rev}:${p}`]);
    expect(r.status, r.out).toBe(0);
    return r.stdout;
  };
  const ddd = (...args: string[]): Run => sh("node", [cli, ...args]);
  const merge = (): Run => ddd("generate", "system", "main.ddd", "-o", "app", "--merge");
  const check = (): number => ddd("generate", "system", "main.ddd", "-o", "app", "--check").status;
  const commitModel = (v: Variant, msg: string): void => {
    fs.writeFileSync(path.join(repo, "main.ddd"), model(platform, v));
    git("add", "-A");
    git("commit", "-q", "-m", msg);
  };
  const read = (rel: string): string => fs.readFileSync(path.join(repo, rel), "utf8");
  const conflicted = (): string[] =>
    git("diff", "--name-only", "--diff-filter=U").split("\n").filter(Boolean);
  const lastGenerated = (): string => git("rev-list", "-1", "HEAD", "--grep=^Generated-from: ");

  git("init", "-q", "-b", "main");
  git("config", "user.email", "replay@example.invalid");
  git("config", "user.name", "replay");
  git("config", "commit.gpgsign", "false");

  ran.push("first generation");
  // 1. First generation.
  commitModel({}, "v0");
  expect(check()).toBe(1);
  expect(merge().status).toBe(0);
  expect(check()).toBe(0);
  const gen0 = lastGenerated();
  const hatchList = JSON.parse(ddd("render", "main.ddd", "--hatches", "--json").stdout) as {
    owner: string;
    path: string;
  }[];
  const hook = `app/${hatchList.find((h) => h.owner === "C.Order")!.path}`;

  // Which generated files the second hook changes, so the user can edit one
  // of them: probe v1 on a throwaway branch.
  git("checkout", "-q", "-b", "probe");
  commitModel({ ops: `${CONFIRM}\n        ${FLAG}` }, "v1 probe");
  expect(merge().status).toBe(0);
  const gen1 = lastGenerated();
  const hatchPaths = new Set(hatchList.map((h) => `app/${h.path}`));
  const touched = git("diff", "--name-only", "--diff-filter=M", gen0, gen1)
    .split("\n")
    // A backend source file, not a derived document.
    .filter((p) => p.startsWith("app/api/") && !hatchPaths.has(p));
  const head3 = (rev: string, p: string) =>
    git("show", `${rev}:${p}`).split("\n").slice(0, 3).join("\n");
  const edited = touched.find((p) => head3(gen0, p) === head3(gen1, p));
  expect(
    edited,
    `no generated file changes below its first lines: ${touched.join(", ")}`,
  ).toBeTruthy();
  git("checkout", "-q", "main");
  git("branch", "-q", "-D", "probe");

  ran.push("edits and a second hook");
  // 2. The user implements the hook and edits a generated file.
  const body = read(hook).split("\n");
  const at = body.findIndex((l) => /^\s*(=>\s*)?(throw |raise )/.test(l));
  expect(at).toBeGreaterThan(0);
  body[at] = `${body[at]!.match(/^\s*/)![0]}USER-BODY`;
  fs.writeFileSync(path.join(repo, hook), body.join("\n"));
  fs.writeFileSync(path.join(repo, edited!), `USER-TOP\n${read(edited!)}`);
  git("commit", "-q", "-am", "user edits");
  const userEdits = git("rev-parse", "HEAD");

  commitModel({ ops: `${CONFIRM}\n        ${FLAG}` }, "v1: second hook");
  expect(check()).toBe(1);
  const second = merge();
  expect(second.status, second.out).toBe(0);
  expect(read(hook)).toContain("USER-BODY");
  expect(read(hook)).toMatch(/flag/i);
  expect(read(edited!)).toBe(`USER-TOP\n${show(gen1, edited!)}`);
  expect(check()).toBe(0);
  const v1 = git("rev-parse", "HEAD");

  ran.push("pinned file");
  // 3. `.loomignore` forks a file: the branch's version survives the merge.
  git("checkout", "-q", "-b", "pinned", userEdits);
  fs.writeFileSync(path.join(repo, "app/.loomignore"), `${edited!.slice("app/".length)}\n`);
  git("add", "-A");
  git("commit", "-q", "-m", "pin");
  commitModel({ ops: `${CONFIRM}\n        ${FLAG}` }, "v1 on the pinned branch");
  expect(merge().status).toBe(0);
  expect(read(edited!)).toBe(show(userEdits, edited!));
  git("checkout", "-q", "main");

  ran.push("removed construct");
  // 4. Removing a construct deletes its untouched generated files.
  git("checkout", "-q", "-b", "removal", v1);
  commitModel({ ops: `${CONFIRM}\n        ${FLAG}`, noQuote: true }, "drop GetQuote");
  expect(merge().status).toBe(0);
  const removed = git("diff", "--name-only", "--diff-filter=D", gen1, lastGenerated())
    .split("\n")
    .filter(Boolean);
  expect(removed.length).toBeGreaterThan(0);
  for (const p of removed) expect(fs.existsSync(path.join(repo, p)), p).toBe(false);
  git("checkout", "-q", "main");

  ran.push("rename");
  // 5. Renaming a hook: one conflict, in the hatch file.
  git("checkout", "-q", "-b", "rename", v1);
  commitModel({ ops: `${CONFIRM.replace("confirm", "approve")}\n        ${FLAG}` }, "rename");
  expect(merge().status).toBe(1);
  expect(conflicted()).toEqual([hook]);
  expect(read(hook).match(/^<<<<<<< /gm)).toHaveLength(1);
  git("merge", "--abort");
  git("checkout", "-q", "main");

  ran.push("re-sign");
  // 6. Re-signing a hook.
  git("checkout", "-q", "-b", "resign", v1);
  const before = read(hook);
  commitModel(
    { ops: `${CONFIRM.replace("confirm()", "confirm(note: string)")}\n        ${FLAG}` },
    "re-sign",
  );
  const resigned = merge();
  if (RESIGN[platform] === "conflict") {
    expect(resigned.status).toBe(1);
    expect(conflicted()).toEqual([hook]);
    expect(read(hook).match(/^<<<<<<< /gm)).toHaveLength(1);
    git("merge", "--abort");
  } else {
    expect(resigned.status, resigned.out).toBe(0);
    expect(read(hook)).toContain("USER-BODY");
    if (RESIGN[platform] === "clean") expect(read(hook)).toMatch(/\bnote\b/);
    else expect(read(hook)).toBe(before);
  }
  git("checkout", "-q", "main");

  ran.push("two branches");
  // 7. Two branches, each with its own model change and generation.
  git("checkout", "-q", "-b", "a", v1);
  commitModel(
    { top: 'operation archive() { status := "archived" }', ops: `${CONFIRM}\n        ${FLAG}` },
    "a",
  );
  expect(merge().status).toBe(0);
  git("checkout", "-q", "-b", "b", v1);
  commitModel(
    {
      ops: `${CONFIRM}\n        ${FLAG}`,
      ctx: "aggregate Invoice with crudish { amount: int }\n      repository Invoices for Invoice { }",
    },
    "b",
  );
  expect(merge().status).toBe(0);
  git("checkout", "-q", "a");
  const joined = sh("git", ["merge", "--no-edit", "b"]);
  expect(joined.status, joined.out).toBe(0);
  expect(check()).toBe(1);
  expect(merge().status).toBe(0);
  expect(check()).toBe(0);
  // The joining generation's parents are both branches' generated commits.
  expect(git("rev-list", "--parents", "-1", lastGenerated()).split(" ")).toHaveLength(3);
  expect(read(hook)).toContain("USER-BODY");

  ran.push("uncommitted model");
  // A generated commit names the source commit it came from, so an
  // uncommitted model is refused before anything is written.
  fs.appendFileSync(path.join(repo, "main.ddd"), "\n// unsaved thought\n");
  const dirty = merge();
  expect(dirty.status).toBe(1);
  expect(dirty.out).toContain("commit the model first");

  fs.rmSync(repo, { recursive: true, force: true });
  return ran;
}
