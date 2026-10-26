#!/usr/bin/env node
// Before/after proof for a toolchain change: does it move any diagnostic, or
// any byte of generated output, on the models the repo already has?
//
//   node scripts/compare-toolchains.mjs [--base <ref>] [--jobs <n>]
//        [--only diagnostics|generate] [--match <path-substring>] [--out <dir>] [--keep]
//
// The BASE toolchain is a detached worktree at `--base` (default: the merge
// base of HEAD and origin/main), built with `npx tsc -b`. The HEAD toolchain is
// this checkout, built the same way, so uncommitted edits ARE compared.
//
// Two legs, over every tracked `.ddd`:
//   - diagnostics: `ddd parse --json`, compared as a set of
//     (severity, code, message, range, node) per model;
//   - generate:    `ddd generate system` for each model the base validates,
//     compared file by file, plus exit code and log (paths normalised).
//
// Each side reads its OWN copy of the sources: `generate system` writes
// `<dir>/.loom/<model>.migration-history.json` next to the model and the next
// run reads it back, so two toolchains pointed at one tree would compare a
// first generation with a second. The base side reads the base worktree; the
// head side reads a second worktree at HEAD (committed sources — a codemod
// still has to be committed to be compared). Both worktrees are removed at the
// end unless `--keep`.
//
// Exit code: 0 when both legs are identical, 1 on any difference, 2 on a
// harness failure. The full report is written to `<out>/report.json`.

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A model's diagnostics as a comparable set of keys; the model path itself is
 *  dropped (the two sides read different copies). */
export function diagnosticKeys(json) {
  const out = new Set();
  for (const d of json?.diagnostics ?? []) {
    out.add(
      JSON.stringify({
        severity: d.severity,
        code: d.code,
        message: d.message,
        range: d.range,
        node: d.node,
      }),
    );
  }
  return out;
}

/** Keys in `a` but not `b`, and in `b` but not `a`. */
export function setDiff(a, b) {
  return { removed: [...a].filter((k) => !b.has(k)), added: [...b].filter((k) => !a.has(k)) };
}

/** Every file under `dir`, relative to it, sorted. */
export function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(path.relative(dir, p));
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out.sort();
}

/** Files that differ between two generated trees: present on one side only,
 *  or different bytes. */
export function diffTrees(a, b) {
  const fa = listFiles(a);
  const fb = listFiles(b);
  const sb = new Set(fb);
  const sa = new Set(fa);
  const out = [];
  for (const f of fa) {
    if (!sb.has(f)) out.push(`- ${f}`);
    else if (!fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f))))
      out.push(`~ ${f}`);
  }
  for (const f of fb) if (!sa.has(f)) out.push(`+ ${f}`);
  return { files: fa.length, differing: out };
}

function git(...args) {
  return execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8" }).trim();
}

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    child.stdout.on("data", (d) => (text += d));
    child.stderr.on("data", (d) => (text += d));
    child.on("close", (code) => resolve({ code, text }));
  });
}

async function pool(items, jobs, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, items.length) }, worker));
  return results;
}

function parseArgs(argv) {
  const o = { jobs: Math.max(1, os.cpus().length), keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base") o.base = argv[++i];
    else if (a === "--jobs") o.jobs = Number(argv[++i]);
    else if (a === "--only") o.only = argv[++i];
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--match") o.match = argv[++i];
    else if (a === "--keep") o.keep = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const base = o.base ?? git("merge-base", "HEAD", "origin/main");
  const out = o.out ?? fs.mkdtempSync(path.join(os.tmpdir(), "loom-compare-"));
  fs.mkdirSync(out, { recursive: true });
  const baseTree = path.join(out, "base-tree");
  const headSrc = path.join(out, "head-src");
  const log = (m) => process.stderr.write(`${m}\n`);

  log(`base ${base} → ${baseTree}; head sources → ${headSrc}`);
  git("worktree", "add", "--detach", baseTree, base);
  git("worktree", "add", "--detach", headSrc, "HEAD");
  const cleanup = () => {
    if (o.keep) return;
    for (const t of [baseTree, headSrc]) {
      try {
        git("worktree", "remove", "--force", t);
      } catch {
        /* already gone */
      }
    }
  };
  try {
    fs.symlinkSync(path.join(REPO, "node_modules"), path.join(baseTree, "node_modules"));
    for (const root of [baseTree, REPO]) {
      log(`building ${root}`);
      execFileSync("npx", ["tsc", "-b"], { cwd: root, stdio: "inherit" });
    }
    const models = git("ls-files", "*.ddd")
      .split("\n")
      .filter((m) => m && (!o.match || m.includes(o.match)));
    const sides = [
      { name: "base", cli: path.join(baseTree, "bin/cli.js"), src: baseTree },
      { name: "head", cli: path.join(REPO, "bin/cli.js"), src: headSrc },
    ];
    const key = (m) => m.replaceAll("/", "_");
    const report = { base, models: models.length };

    log(`diagnostics: ${models.length} models × 2`);
    const parsed = {};
    for (const s of sides) {
      parsed[s.name] = await pool(models, o.jobs, async (m) => {
        const r = await run("node", [s.cli, "parse", "--json", path.join(s.src, m)], s.src);
        try {
          return JSON.parse(r.text);
        } catch {
          return { harnessError: r.text.slice(0, 500) };
        }
      });
    }
    if (o.only !== "generate") {
      const diffs = [];
      let compared = 0;
      models.forEach((m, i) => {
        const a = parsed.base[i];
        const b = parsed.head[i];
        if (a.harnessError || b.harnessError) {
          diffs.push({ model: m, harness: a.harnessError ?? b.harnessError });
          return;
        }
        const ka = diagnosticKeys(a);
        compared += ka.size;
        const d = setDiff(ka, diagnosticKeys(b));
        if (d.removed.length || d.added.length) diffs.push({ model: m, ...d });
      });
      report.diagnostics = { compared, differingModels: diffs.length, diffs };
      log(`diagnostics: ${compared} compared, ${diffs.length} models differ`);
    }

    if (o.only !== "diagnostics") {
      const ok = models.filter((_, i) => parsed.base[i].ok === true);
      log(`generate: ${ok.length} models that validate × 2`);
      const gen = {};
      for (const s of sides) {
        gen[s.name] = await pool(ok, o.jobs, async (m) => {
          const dest = path.join(out, `gen-${s.name}`, key(m));
          const r = await run(
            "node",
            [s.cli, "generate", "system", path.join(s.src, m), "-o", dest],
            s.src,
          );
          const norm = r.text.replaceAll(s.src, "<src>").replaceAll(dest, "<out>");
          return { code: r.code, log: norm.replaceAll(REPO, "<src>") };
        });
      }
      const diffs = [];
      let files = 0;
      ok.forEach((m, i) => {
        const a = gen.base[i];
        const b = gen.head[i];
        const t = diffTrees(path.join(out, "gen-base", key(m)), path.join(out, "gen-head", key(m)));
        files += t.files;
        if (a.code !== b.code || a.log !== b.log || t.differing.length)
          diffs.push({
            model: m,
            exit: [a.code, b.code],
            logDiffers: a.log !== b.log,
            files: t.differing,
          });
      });
      report.generate = { models: ok.length, files, differingModels: diffs.length, diffs };
      log(`generate: ${files} files compared, ${diffs.length} models differ`);
    }

    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 1));
    log(`report: ${path.join(out, "report.json")}`);
    const differs =
      (report.diagnostics?.differingModels ?? 0) + (report.generate?.differingModels ?? 0);
    process.exitCode = differs === 0 ? 0 : 1;
  } finally {
    cleanup();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    process.stderr.write(`${e?.stack ?? e}\n`);
    process.exitCode = 2;
  });
}
