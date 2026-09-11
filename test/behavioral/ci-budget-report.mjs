// Measure the behavioral tier's CI job durations and print the budget each leg
// should carry under the rule in docs/ci-gating.md § "Sizing a job's
// `timeout-minutes`".
//
// WHY THIS IS A SCRIPT AND NOT PROSE.  The seven behavioral legs carried four
// different `timeout-minutes` values, none of them derived from a measurement
// on record, and one of them (java, 20m) was killing ~18 % of its own runs.
// A budget picked by eye drifts back to a round number the moment someone
// re-touches the workflow; a budget with a one-command re-derivation does not.
// Re-run this when a leg starts getting killed, when the corpus case list grows
// materially, or when a backend's build changes.
//
// Usage:
//   GITHUB_TOKEN=<token> node test/behavioral/ci-budget-report.mjs [--runs 20]
//
// Reads the Actions API. Needs a token with `actions:read` on the repo.

import { fileURLToPath } from "node:url";

const REPO = process.env.LOOM_CI_REPO ?? "Loom-Harness/Loc";
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
const RUNS = Number(process.argv.includes("--runs") ? process.argv[process.argv.indexOf("--runs") + 1] : 20);

/** The behavioral tier, and the budget each workflow currently declares. */
const LEGS = [
  ["behavioral-e2e.yml", 10],
  ["behavioral-e2e-python.yml", 10],
  ["behavioral-e2e-java.yml", 30],
  ["behavioral-e2e-dotnet.yml", 15],
  ["behavioral-e2e-dapper.yml", 15],
  ["behavioral-e2e-mikroorm.yml", 20],
  ["behavioral-e2e-elixir.yml", 20],
];

const api = async (path) => {
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions${path}`, {
    headers: { authorization: `Bearer ${TOKEN}`, accept: "application/vnd.github+json" },
  });
  if (r.status === 401 || r.status === 403) {
    // Worth naming, because the obvious reading ("my token is wrong") is often
    // wrong: node's built-in fetch does NOT honour HTTPS_PROXY, so in a sandbox
    // that injects credentials at an egress proxy this request goes out
    // DIRECT and arrives unauthenticated. Node 24 has NODE_USE_ENV_PROXY=1;
    // before that, run the report outside the sandbox or use a real token.
    const proxied = process.env.HTTPS_PROXY ?? process.env.https_proxy;
    throw new Error(
      `${r.status} ${r.statusText} on ${path}` +
        (proxied
          ? "\nHTTPS_PROXY is set but node's fetch ignores it — the request went out direct and unauthenticated." +
            "\nRetry with NODE_USE_ENV_PROXY=1 (node >= 24), or run this outside the proxied environment."
          : ""),
    );
  }
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} on ${path}`);
  return r.json();
};

const secs = (a, b) => (new Date(b).getTime() - new Date(a).getTime()) / 1000;
const fmt = (s) => `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, "0")}s`;

/** Linear-interpolated percentile over a sorted copy. */
function pctl(vals, q) {
  const v = [...vals].sort((a, b) => a - b);
  if (v.length < 2) return v[0] ?? 0;
  const k = (v.length - 1) * q;
  const f = Math.floor(k);
  return v[f] + (v[Math.min(f + 1, v.length - 1)] - v[f]) * (k - f);
}

/** The rule: 50 % margin over the observed p95, rounded up to 5 minutes, floor 10. */
export const budgetFor = (p95Seconds) => Math.max(10, Math.ceil((p95Seconds * 1.5) / 60 / 5) * 5);

/**
 * Job EXECUTION seconds = the sum of the job's step durations. Exported so the
 * ratchet can exercise it on recorded API payloads without a network call.
 */
export const jobExecSeconds = (job) =>
  (job.steps ?? [])
    .filter((s) => s.started_at && s.completed_at)
    .reduce((n, s) => n + secs(s.started_at, s.completed_at), 0);

async function report() {
  for (const [wf, declared] of LEGS) {
    // Successful runs only: a run killed by the cap has no honest duration, and
    // including its truncated time would drag the p95 DOWN — the exact
    // direction that hides the problem.
    const ok = await api(`/workflows/${wf}/runs?status=success&per_page=${RUNS}`);
    // Cap kills, counted separately: they are what makes a p95 a lower bound.
    const bad = await api(`/workflows/${wf}/runs?per_page=100`);

    const execs = [];
    for (const run of ok.workflow_runs) {
      const { jobs } = await api(`/runs/${run.id}/jobs?per_page=20`);
      for (const j of jobs) {
        if (j.conclusion !== "success") continue;
        const total = jobExecSeconds(j);
        if (total > 0) execs.push(total);
      }
    }

    let kills = 0;
    for (const run of bad.workflow_runs) {
      if (!["cancelled", "failure", "timed_out"].includes(run.conclusion)) continue;
      const { jobs } = await api(`/runs/${run.id}/jobs?per_page=20`);
      // A cap kill lands within a couple of minutes of the declared budget; a
      // concurrency cancel lands anywhere. Only the former censors the sample.
      for (const j of jobs) {
        if (j.conclusion === "success" || !j.started_at || !j.completed_at) continue;
        const w = secs(j.started_at, j.completed_at);
        if (w >= declared * 60 && w < declared * 60 + 120) kills++;
      }
    }

    if (execs.length === 0) {
      console.log(`${wf}: no successful runs sampled`);
      continue;
    }
    const p95 = pctl(execs, 0.95);
    const headroom = declared * 60 - Math.max(...execs);
    console.log(
      [
        wf.replace("behavioral-e2e", "").replace(/^-|\.yml$/g, "") || "node",
        `n=${execs.length}`,
        `median=${fmt(pctl(execs, 0.5))}`,
        `p95=${fmt(p95)}`,
        `max=${fmt(Math.max(...execs))}`,
        `budget=${declared}m`,
        `headroom=${fmt(headroom)} (${((headroom / (declared * 60)) * 100).toFixed(0)}%)`,
        `rule-says=${budgetFor(p95)}m`,
        kills > 0 ? `!! ${kills} CAP KILLS — p95 is a LOWER BOUND, raise and re-measure` : "",
      ]
        .filter(Boolean)
        .join("  "),
    );
  }
}

// Importing this module must not fire ~700 API calls — the ratchet imports it
// for `budgetFor`/`jobExecSeconds`. Only run the report when invoked directly.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!TOKEN) {
    console.error("GITHUB_TOKEN (or GH_TOKEN) required — the Actions API needs actions:read.");
    process.exit(2);
  }
  await report();
}
