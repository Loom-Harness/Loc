#!/usr/bin/env node
// Two lanes, two new corpus fixtures, one merge: do they collide?
//
//   node scripts/ledger-collision-dryrun.mjs [--base <ref>] [--gates] [--keep]
//
// Builds two branches from <base> (default `origin/main`) in a throwaway
// worktree.  Each adds one new corpus fixture — a copy of `cache-by-id` under a
// new id, with its wire golden — together with every per-fixture fact the
// gates ask of such a fixture: its authz gate pins, its typing-differential
// allowance, its api-caller pins and a behavioural expected-failure row.  Each
// fact is written where the base's gates read it: the fixture's sidecar when
// the base's manifest knows the sidecar key, the shared ledger otherwise.
// Then it merges the second branch into the first and prints the conflicted
// files.  With `--gates` it runs the gates that read those facts on the merged
// tree.
//
// Exit 0: clean merge (and, with `--gates`, green gates).  Exit 1: a conflict
// or a red gate.  The worktree and branches are removed unless `--keep`.

import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const BASE = opt("--base") ?? "origin/main";
const RUN_GATES = args.includes("--gates");
const KEEP = args.includes("--keep");

const TEMPLATE = "cache-by-id";
const LANES = ["dryrun-lane-a", "dryrun-lane-b"];
const XFAIL_LEG = "dotnet";
const XFAIL_ROW = {
  issue: "#5994",
  expect: "wire",
  reason: "a dry-run row: the collision proof adds it and never boots the case",
};
const GATES = [
  "test/ir/authz-gate-census.test.ts",
  "test/ir/api-caller-census.test.ts",
  "test/system/typing-differential.test.ts",
  "test/conformance/corpus-manifest-integrity.test.ts",
  "test/behavioral/expected-failures.test.ts",
  "test/system/gate-ledger.test.ts",
  "test/conformance/wire-golden-coverage.test.ts",
];

const git = (cwd, ...a) =>
  execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const read = (wt, rel) => fs.readFileSync(path.join(wt, rel), "utf8");
const write = (wt, rel, text) => fs.writeFileSync(path.join(wt, rel), text);
const CORPUS = "test/fixtures/corpus";

/** The sidecar keys the base's manifest accepts. */
function sidecarKeys(wt) {
  const m = /const SIDECAR_KEYS = new Set\(\[([\s\S]*?)\]\)/.exec(
    read(wt, `${CORPUS}/manifest.ts`),
  );
  return new Set([...(m?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1]));
}

/** Insert `text` before the `};` that closes `export const <name> … = {`. */
function insertIntoObject(src, name, text) {
  const at = src.indexOf(`export const ${name}`);
  if (at < 0) throw new Error(`${name} not found`);
  const end = src.indexOf("\n};\n", at);
  return `${src.slice(0, end)}\n${text}${src.slice(end)}`;
}

/** The template's authz gate pins as surface → R class name, from wherever the base keeps them. */
function templatePins(wt, keys) {
  if (keys.has("authzGate")) {
    const side = JSON.parse(read(wt, `${CORPUS}/${TEMPLATE}.corpus.json`));
    return Object.fromEntries(Object.entries(side.authzGate ?? {}).filter(([k]) => k !== "//"));
  }
  const src = read(wt, "test/ir/authz-gate-census-pins.ts");
  const at = src.indexOf(`  "corpus/${TEMPLATE}": {`);
  const block = src.slice(at, src.indexOf("\n  },", at));
  return Object.fromEntries(
    [...block.matchAll(/^\s*"([^"]+)": R\.(\w+),$/gm)].map((m) => [m[1], m[2]]),
  );
}

function templateTyping(wt, keys) {
  if (keys.has("typing"))
    return JSON.parse(read(wt, `${CORPUS}/${TEMPLATE}.corpus.json`)).typing ?? {};
  const allowance = JSON.parse(read(wt, "test/system/typing-differential.allowance.json"));
  const prefix = `${CORPUS}/${TEMPLATE}.ddd :: `;
  return Object.fromEntries(
    Object.entries(allowance)
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, v]) => [k.slice(prefix.length), v]),
  );
}

/** Add lane `id`'s fixture and every per-fixture fact, each where the base reads it. */
function addFixture(wt, id) {
  const keys = sidecarKeys(wt);
  const pins = templatePins(wt, keys);
  const typing = templateTyping(wt, keys);
  const where = {};
  fs.copyFileSync(path.join(wt, `${CORPUS}/${TEMPLATE}.ddd`), path.join(wt, `${CORPUS}/${id}.ddd`));
  fs.copyFileSync(
    path.join(wt, `test/behavioral/wire-golden/${TEMPLATE}.json`),
    path.join(wt, `test/behavioral/wire-golden/${id}.json`),
  );
  const side = JSON.parse(read(wt, `${CORPUS}/${TEMPLATE}.corpus.json`));
  side.title = `collision dry run: ${id}`;
  for (const k of ["authzGate", "typing", "behavioural", "inherits"]) delete side[k];

  // authz gate pins
  if (keys.has("authzGate")) {
    side.authzGate = pins;
    where.authzPins = `${id}.corpus.json`;
  } else {
    const p = "test/ir/authz-gate-census-pins.ts";
    let src = insertIntoObject(
      read(wt, p),
      "AUTHZ_GATE_PINS",
      `  "corpus/${id}": {\n${Object.entries(pins)
        .map(([s, c]) => `    "${s}": R.${c},`)
        .join("\n")}\n  },`,
    );
    const counts = {};
    for (const c of Object.values(pins)) counts[c] = (counts[c] ?? 0) + 1;
    for (const [c, n] of Object.entries(counts))
      src = src.replace(
        new RegExp(`^(  ${c}: )(\\d+),$`, "m"),
        (_m, h, v) => `${h}${Number(v) + n},`,
      );
    write(wt, p, src);
    where.authzPins = p;
  }

  // typing allowance
  if (keys.has("typing")) {
    side.typing = typing;
    where.typing = `${id}.corpus.json`;
  } else {
    const p = "test/system/typing-differential.allowance.json";
    const all = JSON.parse(read(wt, p));
    for (const [cls, row] of Object.entries(typing)) all[`${CORPUS}/${id}.ddd :: ${cls}`] = row;
    const ks = Object.keys(all).sort();
    const line = (v) =>
      `{${Object.entries(v)
        .map(([f, x]) => `${JSON.stringify(f)}: ${JSON.stringify(x)}`)
        .join(", ")}}`;
    write(wt, p, `{\n${ks.map((k) => `  ${JSON.stringify(k)}: ${line(all[k])}`).join(",\n")}\n}\n`);
    where.typing = p;
  }

  // expected-failure row
  if (keys.has("behavioural")) {
    side.behavioural = { xfail: { [XFAIL_LEG]: XFAIL_ROW } };
    where.xfail = `${id}.corpus.json`;
  } else {
    const p = "test/behavioral/registers.mjs";
    const src = read(wt, p);
    const at = src.indexOf("export const BEHAVIOURAL_XFAIL");
    const leg = src.indexOf(`  ${XFAIL_LEG}: {`, at);
    const close = src.indexOf("\n  },", leg);
    write(
      wt,
      p,
      `${src.slice(0, close)}\n    "${id}": ${JSON.stringify(XFAIL_ROW)},${src.slice(close)}`,
    );
    where.xfail = p;
  }

  write(wt, `${CORPUS}/${id}.corpus.json`, `${JSON.stringify(side, null, 2)}\n`);
  return where;
}

function main() {
  const baseSha = git(REPO, "rev-parse", BASE);
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-dryrun-"));
  const branches = LANES.map((l) => `ledger-dryrun/${l}-${process.pid}`);
  let code = 1;
  try {
    git(REPO, "worktree", "add", "--quiet", "--detach", wt, baseSha);
    const where = {};
    for (const [i, id] of LANES.entries()) {
      git(wt, "switch", "--quiet", "-c", branches[i], baseSha);
      where[id] = addFixture(wt, id);
      git(wt, "add", "-A");
      git(
        wt,
        "-c",
        "user.name=dryrun",
        "-c",
        "user.email=dryrun@invalid",
        "commit",
        "--quiet",
        "-m",
        `dry run: add ${id}`,
      );
    }
    git(wt, "switch", "--quiet", branches[0]);
    const merge = spawnSync(
      "git",
      [
        "-c",
        "user.name=dryrun",
        "-c",
        "user.email=dryrun@invalid",
        "merge",
        "--no-edit",
        branches[1],
      ],
      { cwd: wt, encoding: "utf8" },
    );
    const conflicted = git(wt, "diff", "--name-only", "--diff-filter=U")
      .split("\n")
      .filter(Boolean);
    console.log(`base ${BASE} (${baseSha.slice(0, 9)})`);
    for (const [id, w] of Object.entries(where))
      console.log(
        `  ${id}: authz pins → ${w.authzPins}; typing → ${w.typing}; expected failure → ${w.xfail}`,
      );
    if (merge.status !== 0 || conflicted.length > 0) {
      console.log(`merge: CONFLICT in ${conflicted.length} file(s):\n  ${conflicted.join("\n  ")}`);
      return;
    }
    console.log("merge: clean");
    if (RUN_GATES) {
      fs.symlinkSync(path.join(REPO, "node_modules"), path.join(wt, "node_modules"));
      const r = spawnSync("npx", ["vitest", "run", ...GATES], { cwd: wt, encoding: "utf8" });
      const tail = `${r.stdout}${r.stderr}`
        .split("\n")
        .filter((l) => /Test Files|Tests |FAIL|×/.test(l));
      console.log(`gates on the merged tree (${GATES.length} files):\n  ${tail.join("\n  ")}`);
      if (r.status !== 0) return;
    }
    code = 0;
  } finally {
    process.exitCode = code;
    if (KEEP) console.log(`kept: ${wt} (branches ${branches.join(", ")})`);
    else {
      spawnSync("git", ["worktree", "remove", "--force", wt], { cwd: REPO });
      for (const b of branches) spawnSync("git", ["branch", "-D", b], { cwd: REPO });
    }
  }
}

main();
