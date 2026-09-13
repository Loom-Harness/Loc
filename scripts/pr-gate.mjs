// The `pr-gate` aggregate check, v2 — EVENT-DRIVEN (docs/ci-gating.md → "The
// `pr-gate` check").
//
// v1 was a single long-polling job: it waited up to 80 minutes for every other
// check on the head SHA. Under real load that design fed on itself — each open
// PR's pr-gate PARKED a runner slot while polling (6 parked gates ≈ a third of
// the ~20-slot pool), which starved the very jobs it was waiting for, which
// burned its timeout, which required manual label re-arms.
//
// v2 is event-driven. `pr-gate.yml` triggers on `workflow_run: completed` of
// every other workflow (list pinned by test/system/pr-gate.test.ts) plus the
// pull_request / merge_group events, and each run is one seconds-long
// EVALUATION that publishes the check run named `pr-gate` on the head SHA via
// the Checks API — ONE run per SHA, updated in place (see `publishCheck`):
//
//   - any triggered check failed        -> completed/failure (culprits named);
//   - checks still running / none yet   -> in_progress — BLOCKS merge without
//     claiming failure;
//   - all triggered checks completed OK -> completed/success.
//
// v2 originally added: "the last workflow to complete always fires one final
// evaluation, so the verdict flips green with no polling".  Two measurements
// taken on 2026-09-10 disagree on how true that is, and BOTH are kept here
// until the owner rules (docs/ci-gating.md → "The `pr-gate` check"):
//
//   * #2859: a `workflow_run`-triggered run is attributed to the DEFAULT
//     branch, so any branch-filtered count of evaluations is an artifact and
//     cannot show a dropped dispatch.  Under load the verdict flips LATE, not
//     never: the per-SHA concurrency group holds one running plus one pending
//     evaluation, so a burst of ~40 completions advances it about twice
//     (last-check-green to terminal: 14m18s on #2846, 11m48s on #2847).
//   * Wave C0 packet 0.3 (#2863), listing this workflow's runs UNFILTERED and
//     matching by time: 178 eligible completions in six hours produced 172
//     `PR gate` runs of any event; 13 produced no run at all (~7%), in
//     multi-minute windows.  A drop on a SHA's LAST completion parks it until
//     a human re-runs something — ten of 22 measured merged PRs parked ≥5 min
//     fully green, three of them 43–58 min.
//
// What this file does about it is bounded either way: an evaluation that finds
// the SHA NEAR-GREEN watches it out in-run rather than trusting the next
// dispatch — `shouldWatchTail` / `watchTail` below, where the sizing of both
// knobs is written out in full.  If the second measurement is wrong the watch
// costs one runner for ≤15 min on a SHA about to go terminal; if it is right,
// it is what closes the park.
//
// A re-run of a red CHECK fires `workflow_run: completed` again, but that is
// NOT a reliable way to recover a parked gate — measured three times, most
// recently #2773.  The cheap lever is re-running this workflow's own
// `pull_request`-event run for the head; see the lever table in `pr-gate.yml`.
//
// The API-posted check (not this job's own check) is what branch protection
// requires: `workflow_run`-triggered jobs don't surface in the PR's checks UI,
// so the job is named `pr-gate-eval` and the posted check carries the
// canonical `pr-gate` name on every event path. Both names are excluded from
// the verdict.
//
// Fail-closed invariants, unchanged from v1: an unknown/future conclusion or
// a cancelled run counts as FAILED — but only ever the NEWEST run of a given
// check name (`latestPerName`), and never a cancelled run from a suite a newer
// suite supersedes (`liveRuns`), so a superseded suite's corpse never condemns
// a SHA whose live suite is green OR has not created that job yet;
// zero other checks reporting blocks (the
// unfiltered test.yml guarantees at least one always comes); pending is never
// green. The decision core (`evaluate`, `verdict`) is pure and pinned by
// test/system/pr-gate.test.ts.

import { pathToFileURL } from "node:url";

/** Check-run names this gate itself produces — never part of the verdict.
 *
 *  `pr-gate-sweep` is here even though the sweep job never runs on a
 *  `pull_request` or `merge_group` event: on those it is SKIPPED, and a
 *  skipped job still surfaces as a check run on the PR's head SHA.  `skipped`
 *  passes, so leaving it out would not turn a PR red — it would just put the
 *  gate's own plumbing into the count it reports ("waiting on 3/41"). */
export const SELF_NAMES = new Set(["pr-gate", "pr-gate-eval", "pr-gate-sweep"]);

/** Conclusions that count as "did not break the PR". Everything else —
 *  including conclusions this script has never heard of — fails closed. */
const PASSING_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

/**
 * Collapse a check-run list to ONE run per NAME, keeping the newest.
 *
 * The API's `filter=latest` is per NAME **per CHECK SUITE**, not per name — a
 * distinction that is invisible until a SHA carries two suites, and then it is
 * a permanent red.  A PR opened as a draft and later marked ready (the flow
 * CLAUDE.md prescribes) fires a second event on the SAME head SHA; the second
 * suite's `concurrency: cancel-in-progress` CANCELS the first, and the gate's
 * fail-closed rule ("a cancelled run counts as FAILED") then condemns the PR
 * on the corpse of a superseded suite.  Nothing clears it: re-evaluation
 * re-reads the same cancelled run and the sweep re-derives the same verdict,
 * so the PR is unmergeable until it is force-pushed to a fresh SHA.
 *
 * Ordering is by check-run `id`, which GitHub assigns monotonically at
 * creation: the newer suite's jobs are created later, so they win — and a
 * re-run also wins over the attempt it replaces, the same answer
 * `filter=latest` already gives within a suite.  Runs with no `id` (only the
 * hand-built snapshots in the tests) fall back to "last one in the list wins",
 * so array order stays meaningful rather than silently preferring the head.
 *
 * @template {{name: string, id?: number}} T
 * @param {ReadonlyArray<T>} runs
 * @returns {T[]}
 */
export function latestPerName(runs) {
  /** @type {Map<string, T>} */
  const byName = new Map();
  for (const r of runs) {
    const prev = byName.get(r.name);
    if (!prev || (r.id ?? 0) >= (prev.id ?? 0)) byName.set(r.name, r);
  }
  return [...byName.values()];
}

/**
 * Drop the CANCELLED runs of a check suite that a newer suite on the same SHA
 * supersedes.
 *
 * `latestPerName` collapses by NAME, and that rescue needs the live suite to
 * have materialised a run of the same name.  For the four `*-passed` rollups it
 * has not: they sit behind a dynamic matrix (`configure` emits it, the rollup
 * `needs:` it), and GitHub does not create the rollup job until `configure`
 * runs.  With the runner pool saturated, the superseded suite's cancelled
 * corpse is the ONLY bearer of each name, so the fail-closed rule condemns a
 * SHA on which nothing has failed and nothing has even started (#2787).
 *
 * The rule is deliberately narrow, because the gate's value is that it fails
 * closed:
 *
 *   * only `cancelled` is dropped.  A superseded suite's genuine `failure`
 *     still condemns the SHA — a job that ran and failed before its suite was
 *     cancelled reported a real verdict, and this must not launder it.
 *   * only from a STRICTLY OLDER suite.  A cancelled run in the newest suite
 *     still fails, and a SHA carrying nothing but corpses (no newer suite
 *     present at all) still fails — there is no live suite to defer to, so
 *     deferring would be inventing one.
 *
 * The effect on the motivating SHA is `failure` -> `in_progress`: blocking,
 * but honest.  A name whose only bearer was a corpse simply stops reporting,
 * and the live suite's queued jobs keep the verdict pending until they finish.
 *
 * Runs with no `suite` sort as 0 (only the hand-built snapshots in the tests —
 * every API-returned run carries `check_suite.id`), so an all-suiteless
 * snapshot has `newestSuite === 0`, nothing is dropped, and the pre-existing
 * behaviour is byte-identical.
 *
 * @template {{conclusion: string | null, suite?: number}} T
 * @param {ReadonlyArray<T>} runs
 * @returns {T[]}
 */
export function liveRuns(runs) {
  if (runs.length === 0) return [];
  const newestSuite = Math.max(...runs.map((r) => r.suite ?? 0));
  return runs.filter((r) => !(r.conclusion === "cancelled" && (r.suite ?? 0) < newestSuite));
}

/**
 * Classify one snapshot of the head SHA's check runs.
 *
 * @param {ReadonlyArray<{name: string, status: string, conclusion: string | null, suite?: number}>} runs
 * @param {ReadonlySet<string>} selfNames - this gate's own check names, excluded
 * @returns {{total: number, pending: string[], failed: string[]}}
 */
export function evaluate(runs, selfNames) {
  // Corpses go BEFORE the per-name collapse: a name the live suite has not
  // created a job for yet must vanish entirely rather than be represented by
  // the superseded suite's cancelled run.
  const others = latestPerName(liveRuns(runs)).filter((r) => !selfNames.has(r.name));
  const pending = others.filter((r) => r.status !== "completed").map((r) => r.name);
  const failed = others
    .filter((r) => r.status === "completed" && !PASSING_CONCLUSIONS.has(r.conclusion ?? ""))
    .map((r) => r.name);
  return { total: others.length, pending, failed };
}

/**
 * One snapshot -> one verdict.  `pending` maps to a BLOCKING-but-not-failed
 * check (`in_progress`), so the PR shows "waiting", not a spurious red,
 * between completion events.
 *
 * @param {{total: number, pending: string[], failed: string[]}} snapshot
 * @returns {{state: "success" | "failure" | "pending", summary: string}}
 */
export function verdict({ total, pending, failed }) {
  if (failed.length > 0) {
    return { state: "failure", summary: `check(s) failed: ${failed.join(", ")}` };
  }
  if (total === 0) {
    return {
      state: "pending",
      summary:
        "no other check has reported on this SHA yet — waiting (test.yml runs unfiltered on every PR, so at least one always comes)",
    };
  }
  if (pending.length > 0) {
    const head = pending.slice(0, 10).join(", ");
    return {
      state: "pending",
      summary: `waiting on ${pending.length}/${total}: ${head}${pending.length > 10 ? ", …" : ""} — re-evaluates on the next completion; near-green tails are watched in-run`,
    };
  }
  return { state: "success", summary: `all ${total} triggered check(s) passed` };
}

// ---------------------------------------------------------------------------
// THE TAIL WATCH — the one mechanism that keeps a green SHA from parking.
//
// MEASURED (2026-09-10, over the last 30 merged PRs and a 6-hour completion
// census; the numbers are in docs/ci-gating.md and M-T9.57):
//
//   * `workflow_run` dispatch is delivered for ~93% of eligible completions.
//     In the window 2026-09-10T10:00–16:00Z, 178 completions of listed
//     workflows on non-`main` branches produced 172 `PR gate` runs, and 13
//     completions produced NO run at all — not a cancelled one, not a skipped
//     one: none was ever created.
//   * A drop that lands on a SHA's LAST completion parks the gate, because
//     nothing else re-evaluates that SHA.  Ten of the 22 measurable merged PRs
//     parked ≥5 minutes with every check green; three parked 43, 46 and 58
//     minutes.  Each park traces to exactly one missing dispatch (#2819's
//     05:49:11 completion, #2845's 13:18:17, #2846's 15:36:35, #2674's
//     14:11:17 — verified against the repo-wide run list, with no branch
//     filter).
//   * Nothing else explains a park.  Cancellation does not: 479 of 759
//     `workflow_run` evaluations in 21 hours are still `cancelled` AFTER
//     #2822's `cancel-in-progress: false`, because GitHub cancels the
//     superseded PENDING run of a concurrency group unconditionally — but a
//     cancelled pending run never claimed a runner, and the NEWEST arrival
//     always survives, so the tail evaluation is never the cancelled one.
//     A read-after-write race does not either: an evaluation dispatched by a
//     completion reads the check-runs API strictly after it.
//
// So the gate must not depend on any single future dispatch.  An evaluation
// that finds the SHA NEAR-GREEN (`shouldWatchTail`) stops being an event
// handler and becomes a short watcher: it re-reads the SHA every
// `TAIL_POLL_MS` until the verdict is terminal or `TAIL_BUDGET_MS` runs out,
// publishing every change.  The dropped dispatch then costs nothing — the
// evaluation that is already running observes the completion itself.
//
// The two knobs are sized from the same measurement, not guessed:
//
//   TAIL_PENDING_MAX  outstanding checks at the last DELIVERED evaluation, over
//                     the ten measured parks: median 1, max 7.  8 covers all
//                     ten.  It is also the cost brake — the watch must not arm
//                     on a PR that has barely started.
//   TAIL_BUDGET_MS    minutes from that evaluation to the last completion:
//                     median 1.2, and 9 of 10 within 5.  15 min covers nine
//                     outright; the tenth (#2721, 16.9 min) re-arms from the
//                     next completion instead.
//
// Cost: the workflow-level concurrency group is keyed per SHA and serialises,
// so at most ONE watcher runs per SHA, for at most `TAIL_BUDGET_MS`, and it
// exits the moment the verdict goes terminal (median ~1 min).  That is the
// bounded version of v1's parked poller, which waited up to 80 minutes for
// EVERY PR from the moment it opened.
// ---------------------------------------------------------------------------

/** Outstanding checks at or below which an evaluation watches instead of exiting. */
export const TAIL_PENDING_MAX = 8;
/** Re-read cadence inside the watch. */
export const TAIL_POLL_MS = 30_000;
/** Hard cap on one watch.  `pr-gate.yml`'s `timeout-minutes` must exceed it. */
export const TAIL_BUDGET_MS = 15 * 60_000;

/**
 * Is this snapshot near-green — few enough checks outstanding that this run
 * should watch them out rather than trust the next dispatch to arrive?
 *
 * Every conjunct is a cost brake or a correctness brake:
 *
 *   * `failed.length === 0` — a failure is terminal.  Watching it would hold a
 *     runner to re-publish a verdict that cannot change without a re-run, and a
 *     re-run creates a fresh completion (and a fresh evaluation) anyway.
 *   * `pending.length > 0` — nothing to wait for otherwise.
 *   * `pending.length <= TAIL_PENDING_MAX` — the near-green bound above.
 *   * `pending.length < total` — at least one check has REPORTED.  Without it
 *     the `pull_request`-event evaluation, which fires when every check is
 *     still queued, would arm the watch at PR-open time and park a slot for the
 *     PR's whole CI cycle.  That is exactly v1's failure mode and this conjunct
 *     is the only thing standing between v2 and it.
 *
 * @param {{total: number, pending: string[], failed: string[]}} snapshot
 * @returns {boolean}
 */
export function shouldWatchTail({ total, pending, failed }) {
  return (
    failed.length === 0 &&
    pending.length > 0 &&
    pending.length <= TAIL_PENDING_MAX &&
    pending.length < total
  );
}

const API_HEADERS = (token) => ({
  authorization: `Bearer ${token}`,
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
});

/** Attempts per API call (1 try + 3 retries). */
export const API_MAX_ATTEMPTS = 4;

/**
 * Is this response status worth trying again?
 *
 * github.com is not a reliable dependency at this repo's request volume: an
 * evaluation that hit a transient `503 No server is currently available to
 * service your request` failed the whole job (observed 2026-08-17 on the
 * scheduled sweep, which died on PR 6 of 12 and left the rest unreconciled) —
 * a red that says nothing about the PRs it gates.  Retrying the CALL is the
 * fix; failing the JOB is not, because the job IS the recovery mechanism for
 * every other check.
 *
 * Retryable: 5xx (server-side, always transient here), 429 (secondary
 * rate-limit, which GitHub explicitly asks callers to back off on).  NOT
 * retryable: 4xx — a 401/403/404/422 is a real defect (bad token, missing
 * permission, malformed body) and repeating it three times only delays the
 * honest failure.
 *
 * @param {number} status
 * @returns {boolean}
 */
export function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

/**
 * Backoff before attempt N+1: 1s, 2s, 4s.  Bounded on purpose — the whole
 * point of v2 is that an evaluation is seconds long and never parks a runner
 * slot, so the retry ladder tops out at ~7s of waiting, not minutes.
 *
 * @param {number} attempt - 1-based number of the attempt that just failed
 * @returns {number} milliseconds to wait
 */
export function retryDelayMs(attempt) {
  return 1000 * 2 ** (attempt - 1);
}

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `fetch` with the retry ladder above.  Returns the LAST response whatever it
 * says — callers keep their own `res.ok` check and error message, so a
 * non-retryable failure still throws exactly what it threw before.  A rejected
 * fetch (DNS, reset socket) is retried on the same ladder and rethrown after
 * the final attempt.
 *
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {{fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>, attempts?: number, onRetry?: (msg: string) => void}} [opts]
 * @returns {Promise<Response>}
 */
export async function apiFetch(url, init = {}, opts = {}) {
  const {
    fetchImpl = fetch,
    sleep = sleepMs,
    attempts = API_MAX_ATTEMPTS,
    onRetry = (msg) => console.log(msg),
  } = opts;
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const last = attempt === attempts;
    try {
      const res = await fetchImpl(url, init);
      if (res.ok || !isRetryableStatus(res.status) || last) return res;
      onRetry(`  pr-gate: ${res.status} from ${url} — retry ${attempt}/${attempts - 1}`);
    } catch (err) {
      if (last) throw err;
      lastErr = err;
      onRetry(`  pr-gate: ${lastErr} from ${url} — retry ${attempt}/${attempts - 1}`);
    }
    await sleep(retryDelayMs(attempt));
  }
  /* c8 ignore next -- unreachable: the loop always returns or throws on `last` */
  throw lastErr;
}

/** Fetch every check run on `sha` (paginated).  `filter=latest` narrows to the
 *  newest attempt per name WITHIN EACH CHECK SUITE — a SHA carrying two suites
 *  still yields two runs per name, so `latestPerName` does the cross-suite
 *  collapse the verdict actually needs.  `id` is carried for that ordering, and
 *  `suite` for `liveRuns`' cross-suite one — a projection that is only useful if
 *  it actually reaches the verdict, so `opts` (the same injection `apiFetch`
 *  takes) exists to let the test drive THIS mapping rather than a hand-built
 *  copy of it.  Without that, dropping `suite` here would leave every unit test
 *  green and `liveRuns` a no-op in production. */
export async function fetchCheckRuns(repo, sha, token, opts = {}) {
  const runs = [];
  for (let page = 1; ; page += 1) {
    const res = await apiFetch(
      `https://api.github.com/repos/${repo}/commits/${sha}/check-runs?filter=latest&per_page=100&page=${page}`,
      { headers: API_HEADERS(token) },
      opts,
    );
    if (!res.ok)
      throw new Error(`GitHub API ${res.status} listing check runs: ${await res.text()}`);
    const body = await res.json();
    runs.push(...body.check_runs);
    if (runs.length >= body.total_count || body.check_runs.length === 0) break;
  }
  return runs.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
    // The suite this run belongs to — what `latestPerName` cannot infer from a
    // name alone.  See `liveRuns`.
    suite: r.check_suite?.id,
  }));
}

/**
 * The id of the newest `pr-gate` check run on this SHA, or null when the gate
 * has never published here.  Same cross-suite collapse `evaluate` needs: the
 * API lists every run, and the one worth reusing is the newest.
 *
 * @param {ReadonlyArray<{id?: number, name: string}>} runs
 * @returns {number | null}
 */
export function existingGateRunId(runs) {
  const gate = latestPerName(runs).find((r) => r.name === "pr-gate");
  return gate?.id ?? null;
}

/** The check-run body for a verdict.  `head_sha` is create-only — PATCH
 *  rejects it — so it is added by the caller on the POST path. */
function checkBody(v) {
  return {
    name: "pr-gate",
    output: {
      title: v.state === "success" ? "all triggered checks passed" : v.summary.slice(0, 120),
      summary: v.summary,
    },
    ...(v.state === "pending"
      ? { status: "in_progress" }
      : { status: "completed", conclusion: v.state }),
  };
}

/**
 * Publish the verdict as the check run named `pr-gate` on the head SHA — the
 * check branch protection requires — by UPDATING the run already on this SHA,
 * and creating one only the first time.
 *
 * v2 created a new run per evaluation on the theory that "GitHub surfaces the
 * latest run per check name".  That holds within one check suite and fails
 * across two, and a SHA gets a second suite from the exact flow CLAUDE.md
 * prescribes (open a draft, mark it ready).  Every intermediate "waiting on
 * N/M" verdict is then a run that stays `in_progress` FOREVER, and the
 * required-check evaluation reads one of those instead of the newest success:
 *
 *   405 Repository rule violations found
 *   Required status check "pr-gate" is expected.
 *
 * — an unmergeable PR whose every component check is green (observed on #2593,
 * which had three `pr-gate` runs on one SHA: two stuck at "waiting on …" and
 * one "all 8 triggered check(s) passed").  Reusing the run means a SHA carries
 * exactly ONE `pr-gate`, so there is no stale sibling to read.
 *
 * The PATCH can legitimately fail if the run was created by a different app
 * (only its author may update it), so a failed update falls back to creating
 * one — noisily, because that path resurrects the bug above.
 */
export async function publishCheck(repo, sha, token, v, existingId, opts = {}) {
  const send = (method, url, body) =>
    apiFetch(
      url,
      {
        method,
        headers: { ...API_HEADERS(token), "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      opts,
    );

  const create = () =>
    send("POST", `https://api.github.com/repos/${repo}/check-runs`, {
      ...checkBody(v),
      head_sha: sha,
    });

  let res;
  if (existingId) {
    res = await send(
      "PATCH",
      `https://api.github.com/repos/${repo}/check-runs/${existingId}`,
      checkBody(v),
    );
    if (!res.ok) {
      console.log(
        `  pr-gate: ${res.status} updating check run ${existingId} — creating a new one instead`,
      );
      res = await create();
    }
  } else {
    res = await create();
  }
  if (!res.ok) throw new Error(`GitHub API ${res.status} posting check run: ${await res.text()}`);
}

/**
 * One read → classify → publish cycle for a single SHA.
 *
 * The publish is CONDITIONAL on the verdict having changed, so the tail watch
 * below can re-read every 30 seconds without PATCHing an identical body 30
 * times.  `previous` is null on the first cycle, which always publishes — the
 * gate must put a verdict on the SHA even when nothing has moved.
 *
 * @returns {Promise<{snapshot: {total: number, pending: string[], failed: string[]},
 *                    verdict: {state: string, summary: string}, published: boolean}>}
 */
export async function evaluateOnce(repo, sha, token, opts = {}, previous = null) {
  const runs = await fetchCheckRuns(repo, sha, token, opts);
  const snapshot = evaluate(runs, SELF_NAMES);
  const v = verdict(snapshot);
  const changed = !previous || previous.state !== v.state || previous.summary !== v.summary;
  if (changed) await publishCheck(repo, sha, token, v, existingGateRunId(runs), opts);
  return { snapshot, verdict: v, published: changed };
}

/**
 * Watch a near-green SHA to its terminal verdict instead of waiting for a
 * dispatch that is dropped ~7% of the time (see the block above `shouldWatchTail`).
 *
 * Returns the last verdict it published or observed.  It stops at the FIRST
 * terminal state — success and failure are both final for this SHA, and a
 * re-run that changes either produces its own completion and its own
 * evaluation.
 *
 * The clock and the sleep are injectable so the test can replay a measured
 * timeline (#2819's 05:48:26 evaluation and 05:49:10 completion) without
 * spending 44 seconds on it.
 *
 * @param {{sleep?: (ms: number) => Promise<void>, now?: () => number,
 *          budgetMs?: number, pollMs?: number, log?: (m: string) => void}} [opts]
 */
export async function watchTail(repo, sha, token, initial, opts = {}) {
  const {
    sleep = sleepMs,
    now = () => Date.now(),
    budgetMs = TAIL_BUDGET_MS,
    pollMs = TAIL_POLL_MS,
    log = (m) => console.log(m),
  } = opts;
  const deadline = now() + budgetMs;
  let last = initial;
  log(
    `  pr-gate: near-green — watching this SHA for up to ${Math.round(budgetMs / 60_000)}m rather than waiting for the next dispatch`,
  );
  while (now() < deadline) {
    await sleep(pollMs);
    const { verdict: v, published } = await evaluateOnce(repo, sha, token, opts, last);
    if (published) log(`  pr-gate tail: ${v.state.toUpperCase()} — ${v.summary}`);
    last = v;
    if (v.state !== "pending") return last;
  }
  log("  pr-gate: tail watch budget spent — the next completion re-arms it");
  return last;
}

/**
 * The state of the currently-published `pr-gate` check in a snapshot, so the
 * sweep can tell whether a fresh verdict would CHANGE anything.  Uses the same
 * fetched list the verdict uses, collapsed by `latestPerName` — the gate posts
 * a new check run per evaluation, so this SHA has many `pr-gate` runs.
 *
 * @param {ReadonlyArray<{name: string, status: string, conclusion: string | null}>} runs
 * @returns {"success" | "failure" | "pending" | "absent"}
 */
export function currentGateState(runs) {
  // Deduped for the same reason `evaluate` is.  `publishCheck` now keeps one
  // run per SHA, but a SHA from before that change (or one whose PATCH fell
  // back to a create) still carries several, and a bare `find` would answer
  // from whichever the API happened to list first.
  const gate = latestPerName(runs).find((r) => r.name === "pr-gate");
  if (!gate) return "absent";
  if (gate.status !== "completed") return "pending";
  return gate.conclusion === "success" ? "success" : "failure";
}

/** Sweep-mode posting rule: publish only when the fresh verdict DISAGREES with
 *  what is already on the SHA.  The sweep is a safety net for a SHA whose
 *  evaluations stopped arriving, not a second event stream — re-publishing an
 *  identical verdict every cycle is churn with no information. */
export function sweepShouldPost(current, fresh) {
  return current !== fresh.state;
}

async function fetchOpenPrHeads(repo, token) {
  const res = await apiFetch(`https://api.github.com/repos/${repo}/pulls?state=open&per_page=100`, {
    headers: API_HEADERS(token),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} listing open PRs: ${await res.text()}`);
  const prs = await res.json();
  return prs.map((p) => ({ number: p.number, sha: p.head.sha }));
}

/** The SECOND line of defence, behind the tail watch.  It re-derives the
 *  verdict for every OPEN PR and posts only where it differs from what is
 *  already published.
 *
 *  What it is a net FOR is contested (see the header of this file): #2859
 *  showed that the branch-filtered evaluation counts this comment used to
 *  cite (#2464) cannot demonstrate a dropped dispatch, and the C0 unfiltered
 *  census counted 13 of 178 eligible completions producing no run.  What IS
 *  observed either way is a green PR whose published verdict stays
 *  non-terminal long after its last check finished, and the net is worth
 *  having.  It is not the primary answer, because it rides the SAME event
 *  stream: an outage that swallows a SHA's tail dispatch swallows the sweeps
 *  too.  The tail watch is what closes a park in-run; this reconciles a SHA
 *  whose watcher had already exited — a re-run landing hours later, a verdict
 *  posted by an older revision of this script, an evaluation that died on a
 *  5xx.
 *
 *  It does NOT cap an outage at one sweep interval — that claim was here, in
 *  `pr-gate.yml` and in `docs/ci-gating.md`, and none of the three had been
 *  measured.  GitHub runs the every-15-minutes schedule far slower than
 *  requested: re-measured 2026-09-10, the 30 most recent `schedule` runs span
 *  100.9 HOURS (mean gap 3.48 h, median 3.49 h, shortest gap in that window
 *  91 min) — and five of the 30 are outright failures, from the window where
 *  the scheduled sweep collided with its own concurrency group.  Treat the
 *  sweep as an eventual backstop on the order of hours, not a 15-minute cap;
 *  when a green PR is parked, force a fresh evaluation instead of waiting.
 *
 *  Open PRs are the whole reach: a head INSIDE the merge queue is not an open
 *  PR's head, so nothing here ever reconciles it.  In-queue, event-driven
 *  evaluation plus the tail watch (a merge-group head takes the same
 *  single-SHA path) are the only mechanisms; the queue's checks timeout ejects
 *  rather than heals.
 *
 *  (Spell that cadence out in words, never as the cron literal — the slash-star
 *  sequence closes this block comment and breaks the file.  Which is how this
 *  paragraph was first written, and what `test/system/pr-gate.test.ts` caught.) */
async function sweep(repo, token) {
  const prs = await fetchOpenPrHeads(repo, token);
  console.log(`pr-gate sweep: ${prs.length} open PR(s)`);
  for (const pr of prs) {
    const runs = await fetchCheckRuns(repo, pr.sha, token);
    const v = verdict(evaluate(runs, SELF_NAMES));
    const current = currentGateState(runs);
    if (sweepShouldPost(current, v)) {
      await publishCheck(repo, pr.sha, token, v, existingGateRunId(runs));
      console.log(`  #${pr.number} ${pr.sha.slice(0, 8)}: ${current} -> ${v.state} — ${v.summary}`);
    } else {
      console.log(`  #${pr.number} ${pr.sha.slice(0, 8)}: ${current} (unchanged)`);
    }
  }
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const sha = process.env.HEAD_SHA;
  if (!token || !repo) {
    console.error("pr-gate: GITHUB_TOKEN and GITHUB_REPOSITORY are required");
    process.exit(2);
  }

  // No HEAD_SHA = sweep mode (schedule / workflow_dispatch): reconcile every
  // open PR instead of evaluating one SHA.
  if (!sha) {
    await sweep(repo, token);
    return;
  }

  const { snapshot, verdict: v } = await evaluateOnce(repo, sha, token);
  console.log(`pr-gate: ${v.state.toUpperCase()} — ${v.summary}`);
  // A non-terminal verdict on a near-green SHA is the park: the dispatch that
  // would clear it is the one that gets dropped.  Watch it out here instead.
  if (shouldWatchTail(snapshot)) await watchTail(repo, sha, token, v);
  // The verdict lives in the posted `pr-gate` check; this job succeeds as long
  // as it evaluated and published (an API failure above exits non-zero).
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
