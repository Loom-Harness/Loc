#!/usr/bin/env node
// Cancels workflow runs that belong to a merge-queue group that no longer
// exists — `.github/workflows/cancel-dead-queue-runs.yml` runs it on a cron.
//
// WHY: when the merge queue re-forms a group (a PR ahead of it merged, failed
// or left the queue), GitHub deletes that group's
// `gh-readonly-queue/main/pr-<n>-<base>` ref but leaves its runs queued and
// running. Every group ref is unique, so `concurrency: cancel-in-progress`
// never matches one group's runs to the next — nothing else stops them, and
// they hold runners for a verdict nobody reads.
//
// A run is DEAD when it is a `merge_group` run, still queued or in progress,
// older than GRACE_MS, and its head branch is not among the live queue refs.
// The grace covers the gap between the API listing a run and the ref read
// that follows it; a live group's ref exists before its first run does.
//
// Pure core (`deadRuns`) is pinned by test/system/cancel-dead-queue-runs.test.ts;
// only `main()` touches the network.
//
// Usage: GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo node scripts/cancel-dead-queue-runs.mjs [--dry-run]

import { pathToFileURL } from "node:url";

export const QUEUE_REF_PREFIX = "gh-readonly-queue/";
export const GRACE_MS = 2 * 60_000;
const ACTIVE = ["queued", "in_progress"];

/**
 * @param {ReadonlyArray<{id: number, event: string, status: string, head_branch: string, created_at: string}>} runs
 * @param {ReadonlySet<string>} liveBranches  queue branch names that still exist
 * @param {Date} now
 */
export function deadRuns(runs, liveBranches, now = new Date()) {
  return runs.filter(
    (r) =>
      r.event === "merge_group" &&
      ACTIVE.includes(r.status) &&
      r.head_branch?.startsWith(QUEUE_REF_PREFIX) &&
      !liveBranches.has(r.head_branch) &&
      now.getTime() - Date.parse(r.created_at) >= GRACE_MS,
  );
}

async function api(url, token, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      authorization: `Bearer ${token}`,
    },
  });
  return res;
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const dryRun = process.argv.includes("--dry-run");
  if (!repo || !token) throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are required");
  const base = `https://api.github.com/repos/${repo}`;

  /** @type {any[]} */
  const runs = [];
  for (const status of ACTIVE) {
    for (let page = 1; page <= 10; page += 1) {
      const res = await api(
        `${base}/actions/runs?event=merge_group&status=${status}&per_page=100&page=${page}`,
        token,
      );
      if (!res.ok) throw new Error(`${res.status} listing ${status} runs`);
      const batch = (await res.json()).workflow_runs ?? [];
      runs.push(...batch);
      if (batch.length < 100) break;
    }
  }

  // Read the refs AFTER the runs: a group that formed in between has a ref but
  // no listed run, which is harmless; the reverse order could see a run whose
  // ref we never fetched.
  const refsRes = await api(`${base}/git/matching-refs/heads/${QUEUE_REF_PREFIX}`, token);
  if (!refsRes.ok) throw new Error(`${refsRes.status} listing queue refs`);
  const live = new Set(
    (await refsRes.json()).map((/** @type {{ref: string}} */ r) =>
      r.ref.replace(/^refs\/heads\//, ""),
    ),
  );

  const dead = deadRuns(runs, live);
  console.log(
    `${runs.length} active merge_group run(s), ${live.size} live group(s), ${dead.length} dead`,
  );
  for (const r of dead) {
    if (dryRun) {
      console.log(`would cancel ${r.id} ${r.name} (${r.head_branch})`);
      continue;
    }
    const res = await api(`${base}/actions/runs/${r.id}/cancel`, token, { method: "POST" });
    // 409: it finished or was cancelled since the listing — nothing to do.
    console.log(
      `${res.ok ? "cancelled" : `skip (${res.status})`} ${r.id} ${r.name} (${r.head_branch})`,
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
