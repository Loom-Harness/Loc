#!/usr/bin/env node
// Which gated workflows a pull request's diff reaches — the `changes` job of
// the `ci-build.yml` / `ci-runtime.yml` orchestrators.
//
// A reusable workflow cannot filter on `paths:` (that key exists only on
// `push` / `pull_request`), so the per-workflow filters live in
// `.github/ci-paths.json` — `{ "<workflow stem>": ["glob", "!glob", …] }` —
// and this script evaluates them against the PR's changed files. The
// orchestrator calls a workflow on a pull request only when its entry here
// says `true`.
//
// SEMANTICS match GitHub's own `on.pull_request.paths`: patterns are read in
// order and the LAST one that matches a file decides it (`!` excludes), so
// `src/**` followed by `!src/generator/java/**` watches everything under
// `src/` except the java generator. A workflow runs when ANY changed file is
// included. That ordering is why this is not `dorny/paths-filter`, whose
// negation is a per-pattern predicate, not an ordered override.
//
// FAILS OPEN on everything it cannot answer: a non-PR event, a missing token,
// an API error, or a diff at the API's 3000-file ceiling marks every workflow
// `true`. Running a gate needlessly costs runner time; skipping one that the
// diff reached would let a regression through a green check.
//
// Usage (in the job): node scripts/ci-changes.mjs   → writes `matched=<json>`
// to $GITHUB_OUTPUT.  Pure core (`globToRegExp`, `included`, `match`) is
// pinned by test/system/ci-orchestrator.test.ts.

import { appendFileSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The files API answers at most this many files for one pull request. */
export const API_FILE_CEILING = 3000;

/**
 * GitHub filter-pattern glob → anchored RegExp. `**` crosses directories,
 * `*` and `?` do not; everything else is literal. That is the whole subset
 * `.github/ci-paths.json` uses (pinned by the test).
 *
 * @param {string} glob
 */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      // `**/` may stand for zero directories (`**/x.ts` matches `x.ts`).
      if (glob[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/**
 * Is `file` watched by an ordered pattern list? The last matching pattern
 * decides; no match means not watched.
 *
 * @param {readonly string[]} patterns
 * @param {string} file
 */
export function included(patterns, file) {
  let verdict = false;
  for (const p of patterns) {
    const negated = p.startsWith("!");
    if (globToRegExp(negated ? p.slice(1) : p).test(file)) verdict = !negated;
  }
  return verdict;
}

/**
 * Per workflow stem: does any changed file reach it?
 *
 * @param {Record<string, readonly string[]>} filters
 * @param {readonly string[] | null} files  `null` = unknown → every stem true
 * @returns {Record<string, boolean>}
 */
export function match(filters, files) {
  /** @type {Record<string, boolean>} */
  const out = {};
  for (const [stem, patterns] of Object.entries(filters)) {
    out[stem] = files === null || files.some((f) => included(patterns, f));
  }
  return out;
}

async function changedFiles(repo, pr, token) {
  const files = [];
  for (let page = 1; page <= API_FILE_CEILING / 100; page += 1) {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/pulls/${pr}/files?per_page=100&page=${page}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          authorization: `Bearer ${token}`,
        },
      },
    );
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} listing PR files`);
    const batch = await res.json();
    for (const f of batch) {
      files.push(f.filename);
      // A rename moves a file OUT of a watched path too.
      if (f.previous_filename) files.push(f.previous_filename);
    }
    if (batch.length < 100) return files;
  }
  return null; // at the ceiling: the list may be truncated
}

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const filters = JSON.parse(readFileSync(path.resolve(here, "../.github/ci-paths.json"), "utf8"));
  const event = process.env.GITHUB_EVENT_NAME;
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  let files = null;
  if (event === "pull_request" && repo && token) {
    const payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8"));
    try {
      files = await changedFiles(repo, payload.pull_request.number, token);
    } catch (err) {
      console.log(`::warning::could not list PR files, running every gate: ${err.message}`);
    }
  }
  const matched = match(filters, files);
  console.log(files === null ? "files: unknown — every gate on" : `files: ${files.length}`);
  for (const [stem, on] of Object.entries(matched)) console.log(`${on ? "run " : "skip"} ${stem}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `matched=${JSON.stringify(matched)}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
